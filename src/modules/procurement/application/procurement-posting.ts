/**
 * Finalise and reverse a procurement document — the two operations that move
 * stock (Issue #888, ADR-0128).
 *
 * ## The contract with the inventory ledger
 *
 * Procurement is a CONSUMER of `InventoryLedgerPort` and therefore owns what the
 * port documents as the consumer's duty:
 *
 *   * it VERIFIES the source document — the ledger trusts the `(type, id, line)`
 *     it is given, so this file posts only lines it just read from a document it
 *     locked `FOR UPDATE`, in the caller's tenant, in the one state that may post;
 *   * its composition root (the route) AUTHORIZES the actor with
 *     `procurement.documents.finalise` / `.reverse` through
 *     `authorizeInTransaction` BEFORE calling here, and this file AUDITS and
 *     passes the request's `correlationId` onto every ledger row so the two halves
 *     of one business action can be joined;
 *   * it NEVER writes a balance. There is no `awcms_inventory_*` write in this
 *     module; stock changes only through the port.
 *
 * ## All lines or none
 *
 * The lines are posted inside one SAVEPOINT. A ledger refusal on line 3
 * (`INSUFFICIENT_STOCK`, an inactive location, a unit mismatch) is RETURNED by
 * the port, and a handler that returns a 4xx would COMMIT whatever lines 1-2
 * already wrote. So a refusal is converted to a throw INSIDE the savepoint,
 * which rolls lines 1-2 back, and converted back to a value outside it.
 *
 * ## Idempotency
 *
 * Finalising a document that is already `finalised` returns it (`replayed`), so
 * a retry — with the same Idempotency-Key, a different one, or none — posts
 * nothing twice. Underneath, each movement carries the identity
 * `(procurement_receipt | …, document id, line no, operation)`, which the ledger
 * itself de-duplicates. A concurrent finalise of one document queues on the
 * `FOR UPDATE` lock and then takes the replay path.
 *
 * ## Deadlock avoidance
 *
 * Lines are posted in `(item_type, item_ref, line_no)` order so two documents
 * touching overlapping items lock the ledger's balance rows in the same order.
 */
import type {
  InventoryLedgerPort,
  InventoryPostOutcome,
  InventoryPostRequest
} from "../../_shared/ports/inventory-ledger-port";
import { appendDomainEvent } from "../../domain-event-runtime/application/append-domain-event";
import { recordAuditEvent } from "../../logging/application/audit-log";
import {
  PROCUREMENT_DOCUMENT_AGGREGATE_TYPE,
  PROCUREMENT_DOCUMENT_FINALISED_EVENT_TYPE,
  PROCUREMENT_DOCUMENT_REVERSED_EVENT_TYPE,
  PROCUREMENT_EVENT_VERSION
} from "../domain/procurement-events";
import { PROCUREMENT_MODULE_KEY } from "../domain/procurement-permissions";
import {
  LEDGER_SOURCE_TYPE,
  type DocumentMode,
  type DocumentStatus
} from "../domain/procurement-types";
import {
  checkSupplierForMode,
  getDocument,
  loadDocumentRow,
  loadLines,
  recordDocumentEvent,
  type Actor,
  type SupplierGateFailure
} from "./procurement-document-directory";
import type {
  DocumentDetail,
  DocumentLine,
  DocumentRow
} from "./procurement-rows";

type Operation = "post" | "reversal";

export type LedgerRefusal = Exclude<
  InventoryPostOutcome,
  { outcome: "posted" | "replayed" }
>;

export type PostingFailure =
  | { outcome: "not_found" }
  | { outcome: "invalid_state"; status: DocumentStatus }
  | { outcome: "approval_pending" }
  | { outcome: "approval_rejected" }
  | SupplierGateFailure
  | { outcome: "ledger_refused"; lineNo: number; refusal: LedgerRefusal };

export type PostingOutcome =
  | { outcome: "ok"; replayed: boolean; document: DocumentDetail }
  | PostingFailure;

/** Carries a ledger refusal out of the savepoint so everything before it rolls back. */
class LedgerRefusedError extends Error {
  readonly lineNo: number;
  readonly refusal: LedgerRefusal;

  constructor(lineNo: number, refusal: LedgerRefusal) {
    super(`ledger refused line ${lineNo}: ${refusal.outcome}`);
    this.name = "LedgerRefusedError";
    this.lineNo = lineNo;
    this.refusal = refusal;
  }
}

/** Byte-wise (code-unit) comparison: locale-independent, so every process agrees. */
function compareBytes(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Posting order for the lines of ONE document: `(item_type, item_ref, line_no)`,
 * compared byte-wise (never `localeCompare`, whose answer depends on the
 * process locale).
 *
 * Why this is a total lock order. The ledger takes balance-row locks as lines
 * are posted and holds them to the end of the transaction, so two documents that
 * touch the same balances must reach them in the same global order or they
 * deadlock (40P01). A balance row is `(location, item)`. Within ONE document
 * the location (or, for a transfer, the location PAIR) is the same for every
 * line, and an item may appear on a document once, so ordering by item orders
 * the rows; for a transfer line the ledger itself locks its two rows in
 * `locationId` order (`legKey`), the same in either direction and for a
 * reversal. Item-major, location-minor is therefore one global order across
 * documents — pinned by the opposite-order concurrency tests. `line_no` only
 * makes the sort total.
 */
function sortedForPosting(lines: DocumentLine[]): DocumentLine[] {
  return [...lines].sort(
    (a, b) =>
      compareBytes(a.itemType, b.itemType) ||
      compareBytes(a.itemRef, b.itemRef) ||
      a.lineNo - b.lineNo
  );
}

async function postLine(
  tx: Bun.SQL,
  ledger: InventoryLedgerPort,
  tenantId: string,
  actor: Actor,
  doc: DocumentRow,
  line: DocumentLine,
  operation: Operation
): Promise<InventoryPostOutcome> {
  const mode = doc.mode as DocumentMode;
  const base = {
    itemType: line.itemType,
    itemRef: line.itemRef,
    unitCode: line.unitCode,
    quantity: line.quantity,
    source: {
      type: LEDGER_SOURCE_TYPE[mode][operation],
      id: doc.id,
      line: String(line.lineNo)
    },
    reasonCode: "procurement",
    // The document number is the only free text, and it is system-generated.
    note: doc.document_no,
    correlationId: actor.correlationId
  };
  const stockRequest: InventoryPostRequest = {
    ...base,
    locationId: doc.location_id
  };

  switch (mode) {
    case "receive":
      return operation === "post"
        ? ledger.postReceipt(
            tx,
            tenantId,
            actor.actorTenantUserId,
            stockRequest
          )
        : ledger.postSupplierReturn(
            tx,
            tenantId,
            actor.actorTenantUserId,
            stockRequest
          );
    case "supplier_return":
      return operation === "post"
        ? ledger.postSupplierReturn(
            tx,
            tenantId,
            actor.actorTenantUserId,
            stockRequest
          )
        : ledger.postReceipt(
            tx,
            tenantId,
            actor.actorTenantUserId,
            stockRequest
          );
    case "requisition":
    case "transfer": {
      // `location_id` is where stock ARRIVES on the original posting and
      // `source_location_id` where it LEAVES; a reversal sends it back.
      const from =
        operation === "post" ? doc.source_location_id! : doc.location_id;
      const to =
        operation === "post" ? doc.location_id : doc.source_location_id!;

      return ledger.postTransfer(tx, tenantId, actor.actorTenantUserId, {
        ...base,
        fromLocationId: from,
        toLocationId: to
      });
    }
  }
}

/** Posts every line through the port inside the caller's savepoint, linking each movement. */
async function postAllLines(
  tx: Bun.SQL,
  ledger: InventoryLedgerPort,
  tenantId: string,
  actor: Actor,
  doc: DocumentRow,
  lines: DocumentLine[],
  operation: Operation
): Promise<number> {
  let movementCount = 0;

  for (const line of sortedForPosting(lines)) {
    const result = await postLine(
      tx,
      ledger,
      tenantId,
      actor,
      doc,
      line,
      operation
    );

    if (result.outcome !== "posted" && result.outcome !== "replayed") {
      throw new LedgerRefusedError(line.lineNo, result as LedgerRefusal);
    }

    for (const movement of result.movements) {
      await tx`
        INSERT INTO awcms_procurement_document_movements
          (tenant_id, document_id, line_no, operation, movement_id)
        VALUES (${tenantId}, ${doc.id}, ${line.lineNo}, ${operation},
                ${movement.id})
        ON CONFLICT (tenant_id, movement_id) DO NOTHING
      `;
      movementCount += 1;
    }
  }

  return movementCount;
}

async function refreshApproval(
  tx: Bun.SQL,
  tenantId: string,
  doc: DocumentRow
): Promise<"not_required" | "pending" | "approved" | "rejected"> {
  if (doc.approval_status !== "pending" || !doc.approval_instance_id) {
    return doc.approval_status as "not_required" | "approved" | "rejected";
  }

  // The workflow engine is the sole approval authority; this only READS its
  // verdict.
  const rows = (await tx`
    SELECT status FROM awcms_workflow_instances
    WHERE tenant_id = ${tenantId} AND id = ${doc.approval_instance_id}
  `) as { status: string }[];
  const status = rows[0]?.status ?? "pending";

  if (status === "pending") {
    return "pending";
  }

  const next = status === "approved" ? "approved" : "rejected";

  await tx`
    UPDATE awcms_procurement_documents
    SET approval_status = ${next}, updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${doc.id} AND status = 'submitted'
  `;

  return next;
}

async function guarded<T>(
  tx: Bun.TransactionSQL,
  work: (sp: Bun.SQL) => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; error: LedgerRefusedError }> {
  try {
    return { ok: true, value: await tx.savepoint((sp) => work(sp)) };
  } catch (error) {
    if (error instanceof LedgerRefusedError) {
      return { ok: false, error };
    }

    throw error;
  }
}

async function publishEvent(
  tx: Bun.SQL,
  tenantId: string,
  eventType: string,
  doc: DocumentRow,
  actor: Actor,
  lineCount: number,
  movementCount: number
): Promise<void> {
  await appendDomainEvent(tx, tenantId, {
    eventType,
    eventVersion: PROCUREMENT_EVENT_VERSION,
    aggregateType: PROCUREMENT_DOCUMENT_AGGREGATE_TYPE,
    aggregateId: doc.id,
    correlationId: actor.correlationId ?? null,
    producerModule: PROCUREMENT_MODULE_KEY,
    actorTenantUserId: actor.actorTenantUserId,
    payload: {
      documentId: doc.id,
      documentNo: doc.document_no,
      mode: doc.mode,
      supplierId: doc.supplier_id,
      locationId: doc.location_id,
      sourceLocationId: doc.source_location_id,
      currencyCode: doc.currency_code,
      totalCost: doc.total_cost,
      lineCount,
      movementCount
    }
  });
}

export async function finaliseDocument(
  tx: Bun.TransactionSQL,
  ledger: InventoryLedgerPort,
  tenantId: string,
  documentId: string,
  actor: Actor
): Promise<PostingOutcome> {
  const doc = await loadDocumentRow(tx, tenantId, documentId, true);

  if (!doc) {
    return { outcome: "not_found" };
  }

  if (doc.status === "finalised") {
    // The natural-key replay: already done, nothing is posted again.
    return {
      outcome: "ok",
      replayed: true,
      document: (await getDocument(tx, tenantId, documentId))!
    };
  }

  if (doc.status !== "submitted") {
    return { outcome: "invalid_state", status: doc.status as DocumentStatus };
  }

  const approval = await refreshApproval(tx, tenantId, doc);

  if (approval === "pending") {
    return { outcome: "approval_pending" };
  }

  if (approval === "rejected") {
    return { outcome: "approval_rejected" };
  }

  if (doc.supplier_id) {
    const gate = await checkSupplierForMode(
      tx,
      tenantId,
      doc.supplier_id,
      doc.mode as DocumentMode
    );

    if (!gate.ok) {
      const { ok: _ok, ...failure } = gate;

      return failure;
    }
  }

  const lines = await loadLines(tx, tenantId, documentId);
  const posted = await guarded(tx, (sp) =>
    postAllLines(sp, ledger, tenantId, actor, doc, lines, "post")
  );

  if (!posted.ok) {
    return {
      outcome: "ledger_refused",
      lineNo: posted.error.lineNo,
      refusal: posted.error.refusal
    };
  }

  await tx`
    UPDATE awcms_procurement_documents
    SET status = 'finalised', finalised_at = now(),
        finalised_by = ${actor.actorTenantUserId},
        updated_at = now(), updated_by = ${actor.actorTenantUserId}
    WHERE tenant_id = ${tenantId} AND id = ${documentId} AND status = 'submitted'
  `;

  await recordDocumentEvent(
    tx,
    tenantId,
    doc,
    "finalised",
    doc.total_cost,
    actor
  );
  await publishEvent(
    tx,
    tenantId,
    PROCUREMENT_DOCUMENT_FINALISED_EVENT_TYPE,
    doc,
    actor,
    lines.length,
    posted.value
  );
  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId ?? undefined,
    moduleKey: PROCUREMENT_MODULE_KEY,
    action: "procurement.document.finalised",
    resourceType: "procurement_document",
    resourceId: documentId,
    severity: "warning",
    message: "Procurement document finalised; inventory movements posted.",
    attributes: {
      mode: doc.mode,
      lineCount: lines.length,
      movementCount: posted.value,
      totalCost: doc.total_cost
    },
    correlationId: actor.correlationId
  });

  return {
    outcome: "ok",
    replayed: false,
    document: (await getDocument(tx, tenantId, documentId))!
  };
}

export async function reverseDocument(
  tx: Bun.TransactionSQL,
  ledger: InventoryLedgerPort,
  tenantId: string,
  documentId: string,
  actor: Actor,
  reason: string
): Promise<PostingOutcome> {
  const doc = await loadDocumentRow(tx, tenantId, documentId, true);

  if (!doc) {
    return { outcome: "not_found" };
  }

  if (doc.status === "reversed") {
    return {
      outcome: "ok",
      replayed: true,
      document: (await getDocument(tx, tenantId, documentId))!
    };
  }

  if (doc.status !== "finalised") {
    return { outcome: "invalid_state", status: doc.status as DocumentStatus };
  }

  const lines = await loadLines(tx, tenantId, documentId);
  const posted = await guarded(tx, (sp) =>
    postAllLines(sp, ledger, tenantId, actor, doc, lines, "reversal")
  );

  if (!posted.ok) {
    return {
      outcome: "ledger_refused",
      lineNo: posted.error.lineNo,
      refusal: posted.error.refusal
    };
  }

  await tx`
    UPDATE awcms_procurement_documents
    SET status = 'reversed', reversed_at = now(),
        reversed_by = ${actor.actorTenantUserId}, reverse_reason = ${reason},
        updated_at = now(), updated_by = ${actor.actorTenantUserId}
    WHERE tenant_id = ${tenantId} AND id = ${documentId} AND status = 'finalised'
  `;

  await recordDocumentEvent(
    tx,
    tenantId,
    doc,
    "reversed",
    doc.total_cost,
    actor
  );
  await publishEvent(
    tx,
    tenantId,
    PROCUREMENT_DOCUMENT_REVERSED_EVENT_TYPE,
    doc,
    actor,
    lines.length,
    posted.value
  );
  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId ?? undefined,
    moduleKey: PROCUREMENT_MODULE_KEY,
    action: "procurement.document.reversed",
    resourceType: "procurement_document",
    resourceId: documentId,
    severity: "critical",
    message: "Procurement document reversed; compensating movements posted.",
    attributes: {
      mode: doc.mode,
      lineCount: lines.length,
      movementCount: posted.value,
      reasonProvided: true
    },
    correlationId: actor.correlationId
  });

  return {
    outcome: "ok",
    replayed: false,
    document: (await getDocument(tx, tenantId, documentId))!
  };
}
