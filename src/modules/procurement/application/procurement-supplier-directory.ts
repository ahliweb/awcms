/**
 * Suppliers, their labels and their SENSITIVE identifiers (Issue #888,
 * ADR-0128).
 *
 * ## Identity ownership
 *
 * A supplier is a BUSINESS ROLE of a party; the party's identity belongs to
 * `profile_identity`. `profile_id` is a validated reference and nothing here
 * copies the party's name or identifiers.
 *
 * ## Sensitive data
 *
 * `listIdentifiers` and every other read return `maskedValue` only — the
 * `SupplierIdentifier` type has no field that could carry a value. The single
 * function that returns a value is `revealIdentifier`, called only by the
 * `suppliers.reveal` endpoint, which audits it. No audit row, log line or event
 * ever carries a value (the audit redactor is a backstop, not the control).
 *
 * ## Transactions
 *
 * `tx` is the caller's tenant transaction. A failed statement aborts a Postgres
 * transaction, so every "already exists" case is handled with `ON CONFLICT ...
 * DO NOTHING RETURNING` rather than by catching a unique violation.
 */
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  keysetCursorCreatedAtSql,
  type KeysetCursor
} from "../../_shared/keyset-pagination";
import { recordAuditEvent } from "../../logging/application/audit-log";
import { prepareIdentifier } from "../domain/procurement-identifier";
import { PROCUREMENT_MODULE_KEY } from "../domain/procurement-permissions";
import { classifyIdentifier } from "../domain/procurement-types";
import type {
  AddIdentifierInput,
  CreateSupplierInput,
  UpdateSupplierInput
} from "../domain/procurement-validation";
import {
  IDENTIFIER_COLUMNS,
  SUPPLIER_COLUMNS,
  mapIdentifier,
  mapSupplier,
  type IdentifierRow,
  type Supplier,
  type SupplierIdentifier,
  type SupplierRow
} from "./procurement-rows";

export const SUPPLIER_PAGE_SIZE = 100;

type Actor = {
  actorTenantUserId: string | null;
  correlationId: string | undefined;
};

/** Correlated label aggregates: bounded by the page size, no extra round trip. */
const LABEL_SELECT = `
  COALESCE((SELECT jsonb_agg(l.label ORDER BY l.label)
            FROM awcms_procurement_supplier_labels l
            WHERE l.tenant_id = s.tenant_id AND l.supplier_id = s.id
              AND l.label_kind = 'category'), '[]'::jsonb) AS categories,
  COALESCE((SELECT jsonb_agg(l.label ORDER BY l.label)
            FROM awcms_procurement_supplier_labels l
            WHERE l.tenant_id = s.tenant_id AND l.supplier_id = s.id
              AND l.label_kind = 'tag'), '[]'::jsonb) AS tags
`;

const SUPPLIER_SELECT = SUPPLIER_COLUMNS.split(",")
  .map((column) => `s.${column.trim()}`)
  .join(", ");

type SupplierRowWithLabels = SupplierRow & {
  categories: string[];
  tags: string[];
};

function toSupplier(row: SupplierRowWithLabels): Supplier {
  return mapSupplier(row, { categories: row.categories, tags: row.tags });
}

async function replaceLabels(
  tx: Bun.SQL,
  tenantId: string,
  supplierId: string,
  kind: "category" | "tag",
  labels: readonly string[]
): Promise<void> {
  await tx`
    DELETE FROM awcms_procurement_supplier_labels
    WHERE tenant_id = ${tenantId} AND supplier_id = ${supplierId}
      AND label_kind = ${kind}
  `;

  // One statement per label: the set is capped at 20 per kind, and an array
  // parameter would arrive as comma-joined text.
  for (const label of labels) {
    await tx`
      INSERT INTO awcms_procurement_supplier_labels
        (tenant_id, supplier_id, label_kind, label)
      VALUES (${tenantId}, ${supplierId}, ${kind}, ${label})
    `;
  }
}

async function profileExists(
  tx: Bun.SQL,
  tenantId: string,
  profileId: string
): Promise<boolean> {
  const rows = (await tx`
    SELECT 1 AS present FROM awcms_profiles
    WHERE tenant_id = ${tenantId} AND id = ${profileId} AND deleted_at IS NULL
  `) as { present: number }[];

  return rows.length > 0;
}

export type SupplierWriteOutcome =
  | { outcome: "ok"; supplier: Supplier }
  | { outcome: "not_found" }
  | { outcome: "duplicate_code" }
  | { outcome: "profile_not_found" }
  | { outcome: "deleted" };

export async function getSupplier(
  tx: Bun.SQL,
  tenantId: string,
  supplierId: string,
  options: { includeDeleted?: boolean } = {}
): Promise<Supplier | null> {
  const includeDeleted = options.includeDeleted ?? false;
  const rows = (await tx`
    SELECT ${tx.unsafe(SUPPLIER_SELECT)}, ${tx.unsafe(LABEL_SELECT)}
    FROM awcms_procurement_suppliers s
    WHERE s.tenant_id = ${tenantId} AND s.id = ${supplierId}
      AND (${includeDeleted} OR s.deleted_at IS NULL)
  `) as SupplierRowWithLabels[];

  return rows[0] ? toSupplier(rows[0]) : null;
}

export type SupplierListFilters = {
  status?: string;
  category?: string;
  tag?: string;
  includeDeleted?: boolean;
};

export function parseSupplierCursor(cursor: string): KeysetCursor | null {
  return decodeKeysetCursor(cursor);
}

export async function listSuppliers(
  tx: Bun.SQL,
  tenantId: string,
  filters: SupplierListFilters,
  cursor?: KeysetCursor
): Promise<{ suppliers: Supplier[]; nextCursor: string | null }> {
  const status = filters.status ?? null;
  const category = filters.category ?? null;
  const tag = filters.tag ?? null;
  const includeDeleted = filters.includeDeleted ?? false;
  const cursorCreatedAt = cursor ? cursor.createdAt : null;
  const cursorId = cursor ? cursor.id : null;

  const rows = (await tx`
    SELECT ${tx.unsafe(SUPPLIER_SELECT)}, ${tx.unsafe(LABEL_SELECT)},
           ${tx.unsafe(keysetCursorCreatedAtSql("s"))} AS created_at_cursor
    FROM awcms_procurement_suppliers s
    WHERE s.tenant_id = ${tenantId}
      AND (${includeDeleted} OR s.deleted_at IS NULL)
      AND (${status}::text IS NULL OR s.status = ${status})
      AND (${category}::text IS NULL OR EXISTS (
        SELECT 1 FROM awcms_procurement_supplier_labels l
        WHERE l.tenant_id = s.tenant_id AND l.supplier_id = s.id
          AND l.label_kind = 'category' AND l.label = ${category}))
      AND (${tag}::text IS NULL OR EXISTS (
        SELECT 1 FROM awcms_procurement_supplier_labels l
        WHERE l.tenant_id = s.tenant_id AND l.supplier_id = s.id
          AND l.label_kind = 'tag' AND l.label = ${tag}))
      AND (
        ${cursorCreatedAt}::timestamptz IS NULL
        OR (s.created_at, s.id) < (${cursorCreatedAt}::timestamptz, ${cursorId}::uuid)
      )
    ORDER BY s.created_at DESC, s.id DESC
    LIMIT ${SUPPLIER_PAGE_SIZE}
  `) as (SupplierRowWithLabels & { created_at_cursor: string })[];

  const last = rows[rows.length - 1];

  return {
    suppliers: rows.map(toSupplier),
    nextCursor:
      rows.length === SUPPLIER_PAGE_SIZE && last
        ? encodeKeysetCursor(last.created_at_cursor, last.id)
        : null
  };
}

export async function createSupplier(
  tx: Bun.SQL,
  tenantId: string,
  actor: Actor,
  input: CreateSupplierInput
): Promise<SupplierWriteOutcome> {
  if (
    input.profileId &&
    !(await profileExists(tx, tenantId, input.profileId))
  ) {
    return { outcome: "profile_not_found" };
  }

  const inserted = (await tx`
    INSERT INTO awcms_procurement_suppliers
      (tenant_id, vendor_code, name, status, profile_id, created_by, updated_by)
    VALUES (${tenantId}, ${input.vendorCode}, ${input.name}, ${input.status},
            ${input.profileId}, ${actor.actorTenantUserId}, ${actor.actorTenantUserId})
    ON CONFLICT (tenant_id, lower(vendor_code)) DO NOTHING
    RETURNING id
  `) as { id: string }[];
  const id = inserted[0]?.id;

  if (!id) {
    return { outcome: "duplicate_code" };
  }

  await replaceLabels(tx, tenantId, id, "category", input.categories);
  await replaceLabels(tx, tenantId, id, "tag", input.tags);

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId ?? undefined,
    moduleKey: PROCUREMENT_MODULE_KEY,
    action: "procurement.supplier.created",
    resourceType: "procurement_supplier",
    resourceId: id,
    message: "Supplier registered.",
    attributes: {
      vendorCode: input.vendorCode,
      status: input.status,
      profileLinked: input.profileId !== null
    },
    correlationId: actor.correlationId
  });

  return { outcome: "ok", supplier: (await getSupplier(tx, tenantId, id))! };
}

export async function updateSupplier(
  tx: Bun.SQL,
  tenantId: string,
  supplierId: string,
  actor: Actor,
  input: UpdateSupplierInput
): Promise<SupplierWriteOutcome> {
  const existing = await getSupplier(tx, tenantId, supplierId, {
    includeDeleted: true
  });

  if (!existing) {
    return { outcome: "not_found" };
  }

  if (existing.deletedAt) {
    return { outcome: "deleted" };
  }

  if (
    input.profileId &&
    !(await profileExists(tx, tenantId, input.profileId))
  ) {
    return { outcome: "profile_not_found" };
  }

  const name = input.name ?? null;
  const status = input.status ?? null;
  const touchesProfile = input.profileId !== undefined;
  const profileId = input.profileId ?? null;

  await tx`
    UPDATE awcms_procurement_suppliers
    SET name = COALESCE(${name}::text, name),
        status = COALESCE(${status}::text, status),
        profile_id = CASE WHEN ${touchesProfile} THEN ${profileId}::uuid ELSE profile_id END,
        updated_at = now(),
        updated_by = ${actor.actorTenantUserId}
    WHERE tenant_id = ${tenantId} AND id = ${supplierId}
  `;

  if (input.categories) {
    await replaceLabels(tx, tenantId, supplierId, "category", input.categories);
  }

  if (input.tags) {
    await replaceLabels(tx, tenantId, supplierId, "tag", input.tags);
  }

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId ?? undefined,
    moduleKey: PROCUREMENT_MODULE_KEY,
    action: "procurement.supplier.updated",
    resourceType: "procurement_supplier",
    resourceId: supplierId,
    message: "Supplier updated.",
    attributes: {
      // Which fields changed, never their values.
      changed: Object.keys(input).sort(),
      status: input.status ?? null
    },
    correlationId: actor.correlationId
  });

  return {
    outcome: "ok",
    supplier: (await getSupplier(tx, tenantId, supplierId))!
  };
}

export type SupplierLifecycleOutcome =
  | { outcome: "ok"; supplier: Supplier }
  | { outcome: "not_found" }
  | { outcome: "already_deleted" }
  | { outcome: "not_deleted" }
  | { outcome: "has_open_documents" };

export async function softDeleteSupplier(
  tx: Bun.SQL,
  tenantId: string,
  supplierId: string,
  actor: Actor,
  reason: string | null
): Promise<SupplierLifecycleOutcome> {
  // Lock the row so a document created for this supplier a moment ago and a
  // delete cannot both succeed against a stale read.
  const locked = (await tx`
    SELECT deleted_at FROM awcms_procurement_suppliers
    WHERE tenant_id = ${tenantId} AND id = ${supplierId}
    FOR UPDATE
  `) as { deleted_at: Date | null }[];

  if (!locked[0]) {
    return { outcome: "not_found" };
  }

  if (locked[0].deleted_at) {
    return { outcome: "already_deleted" };
  }

  const open = (await tx`
    SELECT 1 AS present FROM awcms_procurement_documents
    WHERE tenant_id = ${tenantId} AND supplier_id = ${supplierId}
      AND status IN ('draft', 'submitted')
    LIMIT 1
  `) as { present: number }[];

  if (open.length > 0) {
    return { outcome: "has_open_documents" };
  }

  await tx`
    UPDATE awcms_procurement_suppliers
    SET deleted_at = now(), deleted_by = ${actor.actorTenantUserId},
        delete_reason = ${reason}, updated_at = now(),
        updated_by = ${actor.actorTenantUserId}
    WHERE tenant_id = ${tenantId} AND id = ${supplierId}
  `;

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId ?? undefined,
    moduleKey: PROCUREMENT_MODULE_KEY,
    action: "procurement.supplier.deleted",
    resourceType: "procurement_supplier",
    resourceId: supplierId,
    severity: "warning",
    message: "Supplier soft-deleted.",
    attributes: { reasonProvided: reason !== null },
    correlationId: actor.correlationId
  });

  return {
    outcome: "ok",
    supplier: (await getSupplier(tx, tenantId, supplierId, {
      includeDeleted: true
    }))!
  };
}

export async function restoreSupplier(
  tx: Bun.SQL,
  tenantId: string,
  supplierId: string,
  actor: Actor
): Promise<SupplierLifecycleOutcome> {
  const locked = (await tx`
    SELECT deleted_at FROM awcms_procurement_suppliers
    WHERE tenant_id = ${tenantId} AND id = ${supplierId}
    FOR UPDATE
  `) as { deleted_at: Date | null }[];

  if (!locked[0]) {
    return { outcome: "not_found" };
  }

  if (!locked[0].deleted_at) {
    return { outcome: "not_deleted" };
  }

  await tx`
    UPDATE awcms_procurement_suppliers
    SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL,
        restored_at = now(), restored_by = ${actor.actorTenantUserId},
        updated_at = now(), updated_by = ${actor.actorTenantUserId}
    WHERE tenant_id = ${tenantId} AND id = ${supplierId}
  `;

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId ?? undefined,
    moduleKey: PROCUREMENT_MODULE_KEY,
    action: "procurement.supplier.restored",
    resourceType: "procurement_supplier",
    resourceId: supplierId,
    severity: "warning",
    message: "Supplier restored.",
    correlationId: actor.correlationId
  });

  return {
    outcome: "ok",
    supplier: (await getSupplier(tx, tenantId, supplierId))!
  };
}

// --- Identifiers (SENSITIVE) ---------------------------------------------------

export async function listIdentifiers(
  tx: Bun.SQL,
  tenantId: string,
  supplierId: string
): Promise<SupplierIdentifier[] | null> {
  // Same deleted-supplier rule as `getSupplier` (audit L1): a soft-deleted
  // supplier's identifiers are not reachable until it is restored.
  if (!(await getSupplier(tx, tenantId, supplierId))) {
    return null;
  }

  const rows = (await tx`
    SELECT ${tx.unsafe(IDENTIFIER_COLUMNS)}
    FROM awcms_procurement_supplier_identifiers
    WHERE tenant_id = ${tenantId} AND supplier_id = ${supplierId}
    ORDER BY created_at, id
  `) as IdentifierRow[];

  return rows.map(mapIdentifier);
}

export type AddIdentifierOutcome =
  | { outcome: "ok"; acknowledgement: IdentifierAcknowledgement }
  | { outcome: "supplier_not_found" }
  | { outcome: "supplier_deleted" };

/**
 * The UNIFORM response of an identifier add (security audit M1/B1): identical
 * keys and status whether the value was fresh or already held. No `id`, no
 * `createdAt`, no supplier id — anything row-specific would tell a caller who
 * holds `suppliers.update` but not `suppliers.reveal` that the value exists.
 * The caller's OWN label is echoed, never the stored one.
 */
export type IdentifierAcknowledgement = {
  type: string;
  label: string | null;
  maskedValue: string;
  classification: string;
};

export async function addIdentifier(
  tx: Bun.SQL,
  tenantId: string,
  supplierId: string,
  actor: Actor,
  input: AddIdentifierInput
): Promise<AddIdentifierOutcome> {
  const supplier = await getSupplier(tx, tenantId, supplierId, {
    includeDeleted: true
  });

  if (!supplier) {
    return { outcome: "supplier_not_found" };
  }

  if (supplier.deletedAt) {
    return { outcome: "supplier_deleted" };
  }

  const prepared = prepareIdentifier(input.type, input.value);
  const classification = classifyIdentifier(input.type);
  const acknowledgement: IdentifierAcknowledgement = {
    type: input.type,
    label: input.label,
    maskedValue: prepared.maskedValue,
    classification
  };

  // At most two attempts: if the conflicting row vanishes between the INSERT
  // (DO NOTHING) and the existence check (a concurrent remove), insert again
  // rather than ever surfacing a distinguishing 409.
  let rows: IdentifierRow[] = [];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    rows = (await tx`
      INSERT INTO awcms_procurement_supplier_identifiers
        (tenant_id, supplier_id, identifier_type, label, normalized_value,
         value_hash, masked_value, classification, created_by)
      VALUES (${tenantId}, ${supplierId}, ${input.type}, ${input.label},
              ${prepared.normalizedValue}, ${prepared.valueHash},
              ${prepared.maskedValue}, ${classification}, ${actor.actorTenantUserId})
      ON CONFLICT (tenant_id, supplier_id, identifier_type, value_hash) DO NOTHING
      RETURNING ${tx.unsafe(IDENTIFIER_COLUMNS)}
    `) as IdentifierRow[];

    if (rows[0]) {
      break;
    }

    const existing = (await tx`
      SELECT 1 AS present FROM awcms_procurement_supplier_identifiers
      WHERE tenant_id = ${tenantId} AND supplier_id = ${supplierId}
        AND identifier_type = ${input.type}
        AND value_hash = ${prepared.valueHash}
    `) as { present: number }[];

    if (existing.length > 0) {
      // IDEMPOTENT: already held. Same acknowledgement, nothing audited.
      return { outcome: "ok", acknowledgement };
    }
  }

  if (!rows[0]) {
    // Two consecutive races: report the same uniform acknowledgement rather
    // than an error that distinguishes a state.
    return { outcome: "ok", acknowledgement };
  }

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId ?? undefined,
    moduleKey: PROCUREMENT_MODULE_KEY,
    action: "procurement.supplier.identifier.added",
    resourceType: "procurement_supplier",
    resourceId: supplierId,
    message: "Supplier identifier added.",
    // The type and classification identify WHAT was added; the value, its hash
    // and its mask stay out of the audit trail.
    attributes: {
      identifierId: rows[0].id,
      identifierType: input.type,
      classification
    },
    correlationId: actor.correlationId
  });

  return { outcome: "ok", acknowledgement };
}

export async function removeIdentifier(
  tx: Bun.SQL,
  tenantId: string,
  supplierId: string,
  identifierId: string,
  actor: Actor
): Promise<"removed" | "not_found"> {
  if (!(await getSupplier(tx, tenantId, supplierId))) {
    return "not_found";
  }

  const rows = (await tx`
    DELETE FROM awcms_procurement_supplier_identifiers
    WHERE tenant_id = ${tenantId} AND supplier_id = ${supplierId}
      AND id = ${identifierId}
    RETURNING identifier_type, classification
  `) as { identifier_type: string; classification: string }[];

  if (!rows[0]) {
    return "not_found";
  }

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId ?? undefined,
    moduleKey: PROCUREMENT_MODULE_KEY,
    action: "procurement.supplier.identifier.removed",
    resourceType: "procurement_supplier",
    resourceId: supplierId,
    severity: "warning",
    message: "Supplier identifier removed.",
    attributes: {
      identifierId,
      identifierType: rows[0].identifier_type,
      classification: rows[0].classification
    },
    correlationId: actor.correlationId
  });

  return "removed";
}

export type RevealedIdentifier = {
  id: string;
  supplierId: string;
  type: string;
  label: string | null;
  classification: string;
  /** The ONLY place a stored identifier value leaves the database. */
  value: string;
};

/**
 * Returns ONE identifier in clear and writes the disclosure to the audit trail
 * IN THE SAME TRANSACTION — a reveal that cannot be audited does not happen.
 * The audit row names the identifier (id, type, classification), never the value.
 */
export async function revealIdentifier(
  tx: Bun.SQL,
  tenantId: string,
  supplierId: string,
  identifierId: string,
  actor: Actor
): Promise<RevealedIdentifier | null> {
  if (!(await getSupplier(tx, tenantId, supplierId))) {
    return null;
  }

  const rows = (await tx`
    SELECT id, supplier_id, identifier_type, label, classification,
           normalized_value
    FROM awcms_procurement_supplier_identifiers
    WHERE tenant_id = ${tenantId} AND supplier_id = ${supplierId}
      AND id = ${identifierId}
  `) as {
    id: string;
    supplier_id: string;
    identifier_type: string;
    label: string | null;
    classification: string;
    normalized_value: string;
  }[];
  const row = rows[0];

  if (!row) {
    return null;
  }

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId ?? undefined,
    moduleKey: PROCUREMENT_MODULE_KEY,
    action: "procurement.supplier.identifier.revealed",
    resourceType: "procurement_supplier",
    resourceId: supplierId,
    severity: "warning",
    message: "Supplier identifier revealed in clear text.",
    attributes: {
      identifierId: row.id,
      identifierType: row.identifier_type,
      classification: row.classification
    },
    correlationId: actor.correlationId
  });

  return {
    id: row.id,
    supplierId: row.supplier_id,
    type: row.identifier_type,
    label: row.label,
    classification: row.classification,
    value: row.normalized_value
  };
}
