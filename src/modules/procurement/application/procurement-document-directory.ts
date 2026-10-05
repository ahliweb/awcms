/**
 * Procurement documents: draft authoring, listing, submit and cancel (Issue
 * #888, ADR-0128). Finalise and reverse — the two operations that move stock —
 * live in `procurement-posting.ts`.
 *
 * ## The lifecycle is enforced twice
 *
 * Here with a `FOR UPDATE` row lock and an explicit status check, which answers
 * a 409 with the real reason; and in the database by the BEFORE UPDATE trigger
 * in `sql/174`, which refuses an illegal transition or an out-of-set column
 * change even if this code were bypassed.
 *
 * ## Transactions
 *
 * `tx` is the caller's tenant transaction. A failed statement aborts a Postgres
 * transaction, so every check that can fail (locations, supplier state,
 * duplicate external reference) is a pre-read — serialised by an advisory lock
 * where a race would otherwise surface as a unique violation.
 */
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  keysetCursorCreatedAtSql,
  type KeysetCursor
} from "../../_shared/keyset-pagination";
import { resolveModuleEnabled } from "../../identity-access/application/auth-context";
import { recordAuditEvent } from "../../logging/application/audit-log";
import {
  startWorkflowInstance,
  InvalidWorkflowFactsError,
  WorkflowDefinitionNotActiveError
} from "../../workflow-approval/application/workflow-instance";
import { cancelWorkflowInstance } from "../../workflow-approval/application/workflow-recovery";
import { PROCUREMENT_MODULE_KEY } from "../domain/procurement-permissions";
import {
  APPROVAL_WORKFLOW_KEY,
  DOCUMENT_NUMBER_PREFIX,
  type DocumentMode,
  type DocumentStatus
} from "../domain/procurement-types";
import type {
  CreateDocumentInput,
  DocumentInput
} from "../domain/procurement-validation";
import {
  DOCUMENT_COLUMNS,
  LINE_COLUMNS,
  canonicalDecimal,
  mapDocument,
  mapLine,
  type DocumentDetail,
  type DocumentLine,
  type DocumentMovementLink,
  type DocumentRow,
  type LineRow,
  type ProcurementDocument
} from "./procurement-rows";

export const DOCUMENT_PAGE_SIZE = 100;

export type Actor = {
  actorTenantUserId: string | null;
  correlationId: string | undefined;
};

// --- Reads --------------------------------------------------------------------

export async function loadDocumentRow(
  tx: Bun.SQL,
  tenantId: string,
  documentId: string,
  lock: boolean
): Promise<DocumentRow | null> {
  const rows = lock
    ? ((await tx`
        SELECT ${tx.unsafe(DOCUMENT_COLUMNS)}
        FROM awcms_procurement_documents
        WHERE tenant_id = ${tenantId} AND id = ${documentId}
        FOR UPDATE
      `) as DocumentRow[])
    : ((await tx`
        SELECT ${tx.unsafe(DOCUMENT_COLUMNS)}
        FROM awcms_procurement_documents
        WHERE tenant_id = ${tenantId} AND id = ${documentId}
      `) as DocumentRow[]);

  return rows[0] ?? null;
}

export async function loadLines(
  tx: Bun.SQL,
  tenantId: string,
  documentId: string
): Promise<DocumentLine[]> {
  const rows = (await tx`
    SELECT ${tx.unsafe(LINE_COLUMNS)}
    FROM awcms_procurement_document_lines
    WHERE tenant_id = ${tenantId} AND document_id = ${documentId}
    ORDER BY line_no
  `) as LineRow[];

  return rows.map(mapLine);
}

export async function loadMovementLinks(
  tx: Bun.SQL,
  tenantId: string,
  documentId: string
): Promise<DocumentMovementLink[]> {
  const rows = (await tx`
    SELECT line_no, operation, movement_id
    FROM awcms_procurement_document_movements
    WHERE tenant_id = ${tenantId} AND document_id = ${documentId}
    ORDER BY operation DESC, line_no, created_at, movement_id
  `) as { line_no: number; operation: string; movement_id: string }[];

  return rows.map((row) => ({
    lineNo: row.line_no,
    operation: row.operation,
    movementId: row.movement_id
  }));
}

export async function getDocument(
  tx: Bun.SQL,
  tenantId: string,
  documentId: string
): Promise<DocumentDetail | null> {
  const row = await loadDocumentRow(tx, tenantId, documentId, false);

  if (!row) {
    return null;
  }

  return {
    ...mapDocument(row),
    lines: await loadLines(tx, tenantId, documentId),
    movements: await loadMovementLinks(tx, tenantId, documentId)
  };
}

export type DocumentListFilters = {
  mode?: string;
  status?: string;
  supplierId?: string;
  locationId?: string;
};

export function parseDocumentCursor(cursor: string): KeysetCursor | null {
  return decodeKeysetCursor(cursor);
}

export async function listDocuments(
  tx: Bun.SQL,
  tenantId: string,
  filters: DocumentListFilters,
  cursor?: KeysetCursor
): Promise<{ documents: ProcurementDocument[]; nextCursor: string | null }> {
  const mode = filters.mode ?? null;
  const status = filters.status ?? null;
  const supplierId = filters.supplierId ?? null;
  const locationId = filters.locationId ?? null;
  const cursorCreatedAt = cursor ? cursor.createdAt : null;
  const cursorId = cursor ? cursor.id : null;

  const rows = (await tx`
    SELECT ${tx.unsafe(DOCUMENT_COLUMNS)},
           ${tx.unsafe(keysetCursorCreatedAtSql())} AS created_at_cursor
    FROM awcms_procurement_documents
    WHERE tenant_id = ${tenantId}
      AND (${mode}::text IS NULL OR mode = ${mode})
      AND (${status}::text IS NULL OR status = ${status})
      AND (${supplierId}::uuid IS NULL OR supplier_id = ${supplierId})
      AND (${locationId}::uuid IS NULL
           OR location_id = ${locationId} OR source_location_id = ${locationId})
      AND (
        ${cursorCreatedAt}::timestamptz IS NULL
        OR (created_at, id) < (${cursorCreatedAt}::timestamptz, ${cursorId}::uuid)
      )
    ORDER BY created_at DESC, id DESC
    LIMIT ${DOCUMENT_PAGE_SIZE}
  `) as DocumentRow[];

  const last = rows[rows.length - 1];

  return {
    documents: rows.map(mapDocument),
    nextCursor:
      rows.length === DOCUMENT_PAGE_SIZE && last && last.created_at_cursor
        ? encodeKeysetCursor(last.created_at_cursor, last.id)
        : null
  };
}

// --- Shared pre-checks ---------------------------------------------------------

export type SupplierGateFailure =
  | { outcome: "supplier_not_found" }
  | {
      outcome: "supplier_unavailable";
      reason: "deleted" | "blocked" | "inactive";
    };

/**
 * Whether a supplier may take part in a document of `mode` right now.
 *
 * The row is read `FOR SHARE` (audit L2): every caller is a write path, and a
 * concurrent `deleteSupplier` takes `FOR UPDATE`, so a document cannot be
 * created or finalised against a supplier that is being deleted at the same
 * moment — one of the two waits for the other and then sees the true state.
 *
 *   * `receive` needs an ACTIVE supplier — stock is only taken in from a vendor
 *     the tenant currently trades with;
 *   * `supplier_return` only needs the supplier to not be blocked or deleted —
 *     sending goods back to a vendor that has since been deactivated is normal.
 */
export async function checkSupplierForMode(
  tx: Bun.SQL,
  tenantId: string,
  supplierId: string,
  mode: DocumentMode
): Promise<
  | { ok: true; code: string; name: string }
  | ({ ok: false } & SupplierGateFailure)
> {
  const rows = (await tx`
    SELECT vendor_code, name, status, deleted_at
    FROM awcms_procurement_suppliers
    WHERE tenant_id = ${tenantId} AND id = ${supplierId}
    FOR SHARE
  `) as {
    vendor_code: string;
    name: string;
    status: string;
    deleted_at: Date | null;
  }[];
  const supplier = rows[0];

  if (!supplier) {
    return { ok: false, outcome: "supplier_not_found" };
  }

  if (supplier.deleted_at) {
    return {
      ok: false,
      outcome: "supplier_unavailable",
      reason: "deleted"
    };
  }

  if (supplier.status === "blocked") {
    return {
      ok: false,
      outcome: "supplier_unavailable",
      reason: "blocked"
    };
  }

  if (mode === "receive" && supplier.status !== "active") {
    return {
      ok: false,
      outcome: "supplier_unavailable",
      reason: "inactive"
    };
  }

  return { ok: true, code: supplier.vendor_code, name: supplier.name };
}

async function locationExists(
  tx: Bun.SQL,
  tenantId: string,
  locationId: string
): Promise<boolean> {
  const rows = (await tx`
    SELECT 1 AS present FROM awcms_inventory_locations
    WHERE tenant_id = ${tenantId} AND id = ${locationId}
  `) as { present: number }[];

  return rows.length > 0;
}

/**
 * Serialises writers of one (tenant, mode, supplier, external reference) so the
 * duplicate pre-check below cannot race another transaction into the unique
 * index.
 */
async function lockExternalReference(
  tx: Bun.SQL,
  tenantId: string,
  mode: string,
  supplierId: string,
  externalReference: string
): Promise<void> {
  const key = `procurement|extref|${tenantId}|${mode}|${supplierId}|${externalReference.toLowerCase()}`;

  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

async function externalReferenceTaken(
  tx: Bun.SQL,
  tenantId: string,
  mode: string,
  supplierId: string,
  externalReference: string,
  exceptDocumentId: string | null
): Promise<boolean> {
  const rows = (await tx`
    SELECT 1 AS present FROM awcms_procurement_documents
    WHERE tenant_id = ${tenantId} AND mode = ${mode}
      AND supplier_id = ${supplierId}
      AND lower(external_reference) = lower(${externalReference})
      AND status NOT IN ('cancelled', 'reversed')
      AND (${exceptDocumentId}::uuid IS NULL OR id <> ${exceptDocumentId})
    LIMIT 1
  `) as { present: number }[];

  return rows.length > 0;
}

export type DocumentWriteFailure =
  | { outcome: "not_found" }
  | { outcome: "invalid_state"; status: DocumentStatus }
  | { outcome: "location_not_found"; field: "locationId" | "sourceLocationId" }
  | SupplierGateFailure
  | { outcome: "duplicate_external_reference" }
  | { outcome: "mode_immutable" };

export type DocumentWriteOutcome =
  { outcome: "ok"; document: DocumentDetail } | DocumentWriteFailure;

async function checkReferences(
  tx: Bun.SQL,
  tenantId: string,
  mode: DocumentMode,
  input: DocumentInput,
  exceptDocumentId: string | null
): Promise<
  | { ok: true; supplier: { code: string; name: string } | null }
  | ({ ok: false } & DocumentWriteFailure)
> {
  if (!(await locationExists(tx, tenantId, input.locationId))) {
    return { ok: false, outcome: "location_not_found", field: "locationId" };
  }

  if (
    input.sourceLocationId &&
    !(await locationExists(tx, tenantId, input.sourceLocationId))
  ) {
    return {
      ok: false,
      outcome: "location_not_found",
      field: "sourceLocationId"
    };
  }

  if (!input.supplierId) {
    return { ok: true, supplier: null };
  }

  const supplier = await checkSupplierForMode(
    tx,
    tenantId,
    input.supplierId,
    mode
  );

  if (!supplier.ok) {
    return supplier;
  }

  if (input.externalReference) {
    await lockExternalReference(
      tx,
      tenantId,
      mode,
      input.supplierId,
      input.externalReference
    );

    if (
      await externalReferenceTaken(
        tx,
        tenantId,
        mode,
        input.supplierId,
        input.externalReference,
        exceptDocumentId
      )
    ) {
      return { ok: false, outcome: "duplicate_external_reference" };
    }
  }

  return { ok: true, supplier: { code: supplier.code, name: supplier.name } };
}

async function insertLines(
  tx: Bun.SQL,
  tenantId: string,
  documentId: string,
  lines: DocumentInput["lines"]
): Promise<void> {
  const rows = lines.map((line, index) => ({
    line_no: index + 1,
    item_type: line.itemType,
    item_ref: line.itemRef,
    sku: line.sku,
    item_name: line.itemName,
    unit_code: line.unitCode,
    quantity: line.quantity,
    unit_cost: line.unitCost
  }));

  // One statement; the rows travel as ONE jsonb parameter (bound directly —
  // never `JSON.stringify(...)::jsonb`, which stores a jsonb string scalar), so a
  // NULL cost stays NULL and the numerics arrive as exact text.
  await tx`
    INSERT INTO awcms_procurement_document_lines
      (tenant_id, document_id, line_no, item_type, item_ref, sku, item_name,
       unit_code, quantity, unit_cost)
    SELECT ${tenantId}::uuid, ${documentId}::uuid, entry.line_no,
           entry.item_type, entry.item_ref, entry.sku, entry.item_name,
           entry.unit_code, entry.quantity::numeric, entry.unit_cost::numeric
    FROM jsonb_to_recordset(${rows}::jsonb) AS entry (
      line_no integer, item_type text, item_ref text, sku text,
      item_name text, unit_code text, quantity text, unit_cost text
    )
  `;
}

// --- Draft authoring ------------------------------------------------------------

export async function createDocument(
  tx: Bun.SQL,
  tenantId: string,
  actor: Actor,
  input: CreateDocumentInput
): Promise<DocumentWriteOutcome> {
  const checked = await checkReferences(tx, tenantId, input.mode, input, null);

  if (!checked.ok) {
    const { ok: _ok, ...failure } = checked;

    return failure;
  }

  const prefix = DOCUMENT_NUMBER_PREFIX[input.mode];
  const rows = (await tx`
    INSERT INTO awcms_procurement_documents
      (tenant_id, document_no, mode, supplier_id, supplier_code_snapshot,
       supplier_name_snapshot, location_id, source_location_id,
       external_reference, document_date, notes, currency_code, line_count,
       created_by, updated_by)
    VALUES (
      ${tenantId},
      ${prefix} || '-' || to_char(now(), 'YYYYMMDD') || '-'
        || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
      ${input.mode}, ${input.supplierId},
      ${checked.supplier ? checked.supplier.code : null},
      ${checked.supplier ? checked.supplier.name : null},
      ${input.locationId}, ${input.sourceLocationId},
      ${input.externalReference},
      COALESCE(${input.documentDate}::date, current_date),
      ${input.notes}, ${input.currencyCode}, ${input.lines.length},
      ${actor.actorTenantUserId}, ${actor.actorTenantUserId}
    )
    RETURNING id
  `) as { id: string }[];
  const id = rows[0]!.id;

  await insertLines(tx, tenantId, id, input.lines);

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId ?? undefined,
    moduleKey: PROCUREMENT_MODULE_KEY,
    action: "procurement.document.created",
    resourceType: "procurement_document",
    resourceId: id,
    message: "Procurement draft created.",
    attributes: { mode: input.mode, lineCount: input.lines.length },
    correlationId: actor.correlationId
  });

  return { outcome: "ok", document: (await getDocument(tx, tenantId, id))! };
}

export async function replaceDraft(
  tx: Bun.SQL,
  tenantId: string,
  documentId: string,
  actor: Actor,
  input: DocumentInput,
  expectedMode: DocumentMode
): Promise<DocumentWriteOutcome> {
  const row = await loadDocumentRow(tx, tenantId, documentId, true);

  if (!row) {
    return { outcome: "not_found" };
  }

  if (row.status !== "draft") {
    return {
      outcome: "invalid_state",
      status: row.status as DocumentStatus
    };
  }

  if (row.mode !== expectedMode) {
    return { outcome: "mode_immutable" };
  }

  const mode = expectedMode;
  const checked = await checkReferences(tx, tenantId, mode, input, documentId);

  if (!checked.ok) {
    const { ok: _ok, ...failure } = checked;

    return failure;
  }

  await tx`
    UPDATE awcms_procurement_documents
    SET supplier_id = ${input.supplierId},
        supplier_code_snapshot = ${checked.supplier ? checked.supplier.code : null},
        supplier_name_snapshot = ${checked.supplier ? checked.supplier.name : null},
        location_id = ${input.locationId},
        source_location_id = ${input.sourceLocationId},
        external_reference = ${input.externalReference},
        document_date = COALESCE(${input.documentDate}::date, document_date),
        notes = ${input.notes},
        currency_code = ${input.currencyCode},
        line_count = ${input.lines.length},
        updated_at = now(), updated_by = ${actor.actorTenantUserId}
    WHERE tenant_id = ${tenantId} AND id = ${documentId}
  `;
  await tx`
    DELETE FROM awcms_procurement_document_lines
    WHERE tenant_id = ${tenantId} AND document_id = ${documentId}
  `;
  await insertLines(tx, tenantId, documentId, input.lines);

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId ?? undefined,
    moduleKey: PROCUREMENT_MODULE_KEY,
    action: "procurement.document.updated",
    resourceType: "procurement_document",
    resourceId: documentId,
    message: "Procurement draft updated.",
    attributes: { mode, lineCount: input.lines.length },
    correlationId: actor.correlationId
  });

  return {
    outcome: "ok",
    document: (await getDocument(tx, tenantId, documentId))!
  };
}

// --- Policy ---------------------------------------------------------------------

export async function readApprovalThreshold(
  tx: Bun.SQL,
  tenantId: string
): Promise<string | null> {
  const rows = (await tx`
    SELECT approval_threshold::text AS approval_threshold
    FROM awcms_procurement_settings WHERE tenant_id = ${tenantId}
  `) as { approval_threshold: string | null }[];
  const value = rows[0]?.approval_threshold ?? null;

  return value === null ? null : canonicalDecimal(value);
}

export async function writeApprovalThreshold(
  tx: Bun.SQL,
  tenantId: string,
  actor: Actor,
  threshold: string | null
): Promise<string | null> {
  await tx`
    INSERT INTO awcms_procurement_settings
      (tenant_id, approval_threshold, updated_by)
    VALUES (${tenantId}, ${threshold}::numeric, ${actor.actorTenantUserId})
    ON CONFLICT (tenant_id) DO UPDATE
    SET approval_threshold = EXCLUDED.approval_threshold,
        updated_at = now(), updated_by = EXCLUDED.updated_by
  `;

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId ?? undefined,
    moduleKey: PROCUREMENT_MODULE_KEY,
    action: "procurement.policy.updated",
    resourceType: "procurement_settings",
    severity: "warning",
    message: "Procurement approval threshold changed.",
    attributes: {
      approvalEnabled: threshold !== null,
      approvalThreshold: threshold
    },
    correlationId: actor.correlationId
  });

  return readApprovalThreshold(tx, tenantId);
}

// --- Submit ---------------------------------------------------------------------

export type SubmitOutcome =
  | { outcome: "ok"; document: DocumentDetail }
  | DocumentWriteFailure
  | { outcome: "approval_workflow_not_configured" }
  | { outcome: "approval_facts_invalid"; errors: unknown };

export async function submitDocument(
  tx: Bun.SQL,
  tenantId: string,
  documentId: string,
  actor: Actor,
  now: Date
): Promise<SubmitOutcome> {
  const row = await loadDocumentRow(tx, tenantId, documentId, true);

  if (!row) {
    return { outcome: "not_found" };
  }

  if (row.status !== "draft") {
    return {
      outcome: "invalid_state",
      status: row.status as DocumentStatus
    };
  }

  if (row.supplier_id) {
    const gate = await checkSupplierForMode(
      tx,
      tenantId,
      row.supplier_id,
      row.mode as DocumentMode
    );

    if (!gate.ok) {
      const { ok: _ok, ...failure } = gate;

      return failure;
    }
  }

  const totals = (await tx`
    SELECT COALESCE(sum(line_total), 0)::text AS total, count(*)::int AS lines,
           count(unit_cost)::int AS costed
    FROM awcms_procurement_document_lines
    WHERE tenant_id = ${tenantId} AND document_id = ${documentId}
  `) as { total: string; lines: number; costed: number }[];
  const total = canonicalDecimal(totals[0]!.total);
  const threshold = await readApprovalThreshold(tx, tenantId);
  // `numeric` comparison in SQL, not a JS float comparison.
  const needsApproval =
    threshold !== null &&
    (
      (await tx`SELECT (${total}::numeric >= ${threshold}::numeric) AS yes`) as {
        yes: boolean;
      }[]
    )[0]!.yes;

  let approvalStatus: "not_required" | "pending" | "approved" | "rejected" =
    "not_required";
  let approvalInstanceId: string | null = null;

  if (needsApproval) {
    // Optional, soft integration (see module.ts): with `workflow` disabled for
    // the tenant, or no actor to attribute the request to, the submit is REFUSED
    // rather than treated as approved.
    if (
      !actor.actorTenantUserId ||
      !(await resolveModuleEnabled(tx, tenantId, "workflow"))
    ) {
      return { outcome: "approval_workflow_not_configured" };
    }

    try {
      const workflow = await startWorkflowInstance(tx, {
        tenantId,
        workflowKey: APPROVAL_WORKFLOW_KEY,
        resourceType: "procurement_document",
        resourceId: documentId,
        requestedByTenantUserId: actor.actorTenantUserId,
        facts: {
          mode: row.mode,
          totalCost: Number(total),
          currencyCode: row.currency_code
        },
        now,
        correlationId: actor.correlationId
      });

      approvalInstanceId = workflow.instanceId;
      approvalStatus = workflow.finished
        ? workflow.status === "approved"
          ? "approved"
          : "rejected"
        : "pending";
    } catch (error) {
      if (error instanceof WorkflowDefinitionNotActiveError) {
        return { outcome: "approval_workflow_not_configured" };
      }

      if (error instanceof InvalidWorkflowFactsError) {
        return { outcome: "approval_facts_invalid", errors: error.errors };
      }

      throw error;
    }
  }

  await tx`
    UPDATE awcms_procurement_documents
    SET status = 'submitted', total_cost = ${total}::numeric,
        line_count = ${totals[0]!.lines},
        approval_status = ${approvalStatus},
        approval_instance_id = ${approvalInstanceId},
        submitted_at = now(), submitted_by = ${actor.actorTenantUserId},
        updated_at = now(), updated_by = ${actor.actorTenantUserId}
    WHERE tenant_id = ${tenantId} AND id = ${documentId} AND status = 'draft'
  `;

  await recordDocumentEvent(tx, tenantId, row, "submitted", total, actor);
  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId ?? undefined,
    moduleKey: PROCUREMENT_MODULE_KEY,
    action: "procurement.document.submitted",
    resourceType: "procurement_document",
    resourceId: documentId,
    message: "Procurement document submitted.",
    attributes: {
      mode: row.mode,
      totalCost: total,
      approvalStatus,
      approvalInstanceId
    },
    correlationId: actor.correlationId
  });

  return {
    outcome: "ok",
    document: (await getDocument(tx, tenantId, documentId))!
  };
}

export async function recordDocumentEvent(
  tx: Bun.SQL,
  tenantId: string,
  row: Pick<DocumentRow, "id" | "mode" | "supplier_id" | "line_count">,
  kind: "submitted" | "finalised" | "cancelled" | "reversed",
  totalCost: string | null,
  actor: Actor
): Promise<void> {
  await tx`
    INSERT INTO awcms_procurement_document_events
      (tenant_id, document_id, mode, event_kind, supplier_id, total_cost,
       line_count, actor_tenant_user_id)
    VALUES (${tenantId}, ${row.id}, ${row.mode}, ${kind}, ${row.supplier_id},
            ${totalCost}::numeric, ${row.line_count}, ${actor.actorTenantUserId})
  `;
}

// --- Cancel ---------------------------------------------------------------------

export async function cancelDocument(
  tx: Bun.SQL,
  tenantId: string,
  documentId: string,
  actor: Actor,
  reason: string
): Promise<
  | { outcome: "ok"; document: DocumentDetail }
  | { outcome: "not_found" }
  | { outcome: "invalid_state"; status: DocumentStatus }
> {
  const row = await loadDocumentRow(tx, tenantId, documentId, true);

  if (!row) {
    return { outcome: "not_found" };
  }

  if (row.status !== "draft" && row.status !== "submitted") {
    return {
      outcome: "invalid_state",
      status: row.status as DocumentStatus
    };
  }

  // A pending approval for a document nobody wants any more must not stay in
  // an approver's inbox.
  if (
    row.approval_status === "pending" &&
    row.approval_instance_id &&
    actor.actorTenantUserId
  ) {
    await cancelWorkflowInstance(tx, {
      tenantId,
      instanceId: row.approval_instance_id,
      cancelledByTenantUserId: actor.actorTenantUserId,
      reason: "The procurement document was cancelled.",
      correlationId: actor.correlationId
    });
  }

  await tx`
    UPDATE awcms_procurement_documents
    SET status = 'cancelled', cancelled_at = now(),
        cancelled_by = ${actor.actorTenantUserId}, cancel_reason = ${reason},
        updated_at = now(), updated_by = ${actor.actorTenantUserId}
    WHERE tenant_id = ${tenantId} AND id = ${documentId}
      AND status IN ('draft', 'submitted')
  `;

  await recordDocumentEvent(
    tx,
    tenantId,
    row,
    "cancelled",
    row.total_cost,
    actor
  );
  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId ?? undefined,
    moduleKey: PROCUREMENT_MODULE_KEY,
    action: "procurement.document.cancelled",
    resourceType: "procurement_document",
    resourceId: documentId,
    severity: "warning",
    message: "Procurement document cancelled; no stock was moved.",
    attributes: { mode: row.mode, previousStatus: row.status },
    correlationId: actor.correlationId
  });

  return {
    outcome: "ok",
    document: (await getDocument(tx, tenantId, documentId))!
  };
}
