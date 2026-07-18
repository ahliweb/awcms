import { recordAuditEvent } from "../../logging/application/audit-log";
import {
  encodeKeysetCursor,
  type KeysetCursor
} from "../../_shared/keyset-pagination";
import type {
  CreateOfficeInput,
  UpdateOfficeInput
} from "../domain/office-validation";

const AUDIT_MODULE_KEY = "tenant_admin";
const AUDIT_RESOURCE_TYPE = "office";

/**
 * Page size for `GET /api/v1/offices`. Matches the workflow inbox (100) — an
 * office list is small per page but unbounded in total for a retail tenant
 * with thousands of outlets, which is exactly why the endpoint must not
 * return the whole set (Issue #149).
 */
export const OFFICE_LIST_LIMIT = 100;

/**
 * `officeCode` is unique per tenant among live offices
 * (`awcms_offices_tenant_code_key`, sql/002:43). That uniqueness is a rule the
 * CALLER can act on — pick another code — so a collision must surface as 409,
 * not as an unhandled `PostgresError` (500).
 */
export class DuplicateOfficeCodeError extends Error {
  constructor(officeCode: string) {
    super(
      `An office with code "${officeCode}" already exists for this tenant.`
    );
    this.name = "DuplicateOfficeCodeError";
  }
}

/**
 * `parentOfficeId` did not resolve to a live office IN THE CALLER'S TENANT.
 * Deliberately one error for three distinct causes — no such office, an office
 * belonging to another tenant (GHSA-r7cx-c4jh-cvvw), or a soft-deleted one
 * (Issue #149 §3) — because telling them apart in the response is precisely
 * the existence oracle the advisory is about: a caller must not be able to
 * learn that an id exists somewhere else on the platform.
 */
export class ParentOfficeNotFoundError extends Error {
  constructor() {
    super("parentOfficeId does not reference a live office in this tenant.");
    this.name = "ParentOfficeNotFoundError";
  }
}

const POSTGRES_UNIQUE_VIOLATION = "23505";

export type OfficeRecord = {
  id: string;
  officeCode: string;
  officeName: string;
  officeType: string;
  parentOfficeId: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

type OfficeRow = {
  id: string;
  office_code: string;
  office_name: string;
  office_type: string;
  parent_office_id: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
};

function toRecord(row: OfficeRow): OfficeRecord {
  return {
    id: row.id,
    officeCode: row.office_code,
    officeName: row.office_name,
    officeType: row.office_type,
    parentOfficeId: row.parent_office_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export type OfficeListPage = {
  items: OfficeRecord[];
  nextCursor: string | null;
};

/**
 * One keyset-paginated page of live offices, newest first.
 *
 * Ordering flipped from `created_at ASC` to newest-first (Issue #149): the
 * shared cursor helper compares `(created_at, id) < (cursor)`, so DESC is the
 * direction it encodes, and it is what every other paginated list here already
 * returns (workflow inbox, object sync queue). Callers that relied on
 * oldest-first must now page through or re-sort client-side; this is a
 * breaking read-order change, recorded as such in the changeset.
 *
 * The `id` tiebreaker is not decorative: `created_at` is not unique, and two
 * offices created in the same transaction share it exactly. Without the
 * tiebreaker in both the comparison and the ORDER BY, such rows would be
 * skipped or repeated across a page boundary.
 *
 * PRECISION (Issue #158): the cursor must round-trip `created_at` at the SAME
 * precision it is compared on, or the keyset silently loses rows. A JS `Date`
 * holds only milliseconds while `timestamptz` holds MICROSECONDS (the driver
 * floors them on the way out — `...:45.029058+00` arrives as `...:45.029Z`),
 * so a cursor built from a `Date` denotes an instant strictly EARLIER than
 * the row it came from and `(created_at, id) < (cursor)` would skip every row
 * sharing that millisecond. Measured before the fix: 105 offices → page 1
 * returned 100, page 2 returned 4; one office silently unreachable.
 *
 * The fix is central (`_shared/keyset-pagination.ts`): `created_at_cursor`
 * carries the FULL microsecond precision as UTC ISO-8601 text, the cursor
 * stores it verbatim, and the WHERE clause binds it back with `::timestamptz`.
 * This keeps `ORDER BY (created_at, id)` on the bare column — index-friendly
 * (`(tenant_id, created_at DESC)`) — instead of an expression the planner
 * might not match. This replaced an earlier local `date_trunc('milliseconds',
 * ...)` guard, removed here now that the shared helper carries microseconds.
 */
export async function listOffices(
  tx: Bun.SQL,
  tenantId: string,
  cursor: KeysetCursor | null = null
): Promise<OfficeListPage> {
  const cursorCreatedAt = cursor?.createdAt ?? null;
  const cursorId = cursor?.id ?? null;

  const rows = (await tx`
    SELECT id, office_code, office_name, office_type, parent_office_id, status, created_at, updated_at,
           to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"') AS created_at_cursor
    FROM awcms_offices
    WHERE tenant_id = ${tenantId}
      AND deleted_at IS NULL
      AND (
        ${cursorCreatedAt}::timestamptz IS NULL
        OR (created_at, id) < (${cursorCreatedAt}, ${cursorId})
      )
    ORDER BY created_at DESC, id DESC
    LIMIT ${OFFICE_LIST_LIMIT}
  `) as (OfficeRow & { created_at_cursor: string })[];

  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === OFFICE_LIST_LIMIT && last
      ? encodeKeysetCursor(last.created_at_cursor, last.id)
      : null;

  return { items: rows.map(toRecord), nextCursor };
}

export async function fetchOfficeById(
  tx: Bun.SQL,
  tenantId: string,
  officeId: string
): Promise<OfficeRecord | null> {
  const rows = (await tx`
    SELECT id, office_code, office_name, office_type, parent_office_id, status, created_at, updated_at
    FROM awcms_offices
    WHERE tenant_id = ${tenantId} AND id = ${officeId} AND deleted_at IS NULL
  `) as OfficeRow[];

  return rows[0] ? toRecord(rows[0]) : null;
}

/**
 * @throws {ParentOfficeNotFoundError} `parentOfficeId` is not a live office in
 *   this tenant. Raised BEFORE the INSERT — see the ordering note below.
 * @throws {DuplicateOfficeCodeError} `officeCode` is already taken in this
 *   tenant.
 */
export async function createOffice(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  input: CreateOfficeInput,
  correlationId?: string
): Promise<OfficeRecord> {
  // ORDERING IS LOAD-BEARING: this check must stay ahead of every write in
  // this function. `withTenant` COMMITs when its callback returns normally, so
  // a route that catches this error inside the transaction and returns 4xx
  // would PERSIST anything written before the throw. A 4xx that commits its
  // own side effects is the bug class that bit `reassignWorkflowTask` — the
  // rule is that any throw mapped to 4xx precedes the first write.
  //
  // Resolving through `fetchOfficeById` (tenant-scoped, `deleted_at IS NULL`)
  // is what makes the three bad-parent cases — absent, other tenant, soft
  // deleted — all fail identically and cheaply, before anything happens.
  if (input.parentOfficeId !== null) {
    const parent = await fetchOfficeById(tx, tenantId, input.parentOfficeId);
    if (!parent) throw new ParentOfficeNotFoundError();
  }

  let rows: OfficeRow[];

  try {
    rows = (await tx`
      INSERT INTO awcms_offices (tenant_id, office_code, office_name, office_type, parent_office_id, created_by, updated_by)
      VALUES (
        ${tenantId}, ${input.officeCode}, ${input.officeName}, ${input.officeType},
        ${input.parentOfficeId}, ${actorTenantUserId}, ${actorTenantUserId}
      )
      RETURNING id, office_code, office_name, office_type, parent_office_id, status, created_at, updated_at
    `) as OfficeRow[];
  } catch (error) {
    if (
      error instanceof Bun.SQL.PostgresError &&
      String(error.errno) === POSTGRES_UNIQUE_VIOLATION
    ) {
      throw new DuplicateOfficeCodeError(input.officeCode);
    }

    // Anything else — including a 23503 from the composite parent FK, which
    // means the parent was concurrently moved or hard-deleted between the
    // check above and this INSERT — propagates. That is deliberate: the FK
    // firing here is a race, not caller error, and it has already aborted the
    // transaction. Letting it out of `withTenant` rolls back and reports 500,
    // which is the honest answer.
    throw error;
  }

  const record = toRecord(rows[0]!);

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId,
    moduleKey: AUDIT_MODULE_KEY,
    action: "create",
    resourceType: AUDIT_RESOURCE_TYPE,
    resourceId: record.id,
    message: `Office created: ${record.officeCode}.`,
    attributes: { officeType: record.officeType },
    correlationId
  });

  return record;
}

export async function updateOffice(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  officeId: string,
  input: UpdateOfficeInput,
  correlationId?: string
): Promise<OfficeRecord | null> {
  const existing = await fetchOfficeById(tx, tenantId, officeId);
  if (!existing) return null;

  const rows = (await tx`
    UPDATE awcms_offices
    SET
      office_name = ${input.officeName ?? existing.officeName},
      office_type = ${input.officeType ?? existing.officeType},
      status = ${input.status ?? existing.status},
      updated_by = ${actorTenantUserId},
      updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${officeId} AND deleted_at IS NULL
    RETURNING id, office_code, office_name, office_type, parent_office_id, status, created_at, updated_at
  `) as OfficeRow[];

  if (rows.length === 0) return null;

  const record = toRecord(rows[0]!);

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId,
    moduleKey: AUDIT_MODULE_KEY,
    action: "update",
    resourceType: AUDIT_RESOURCE_TYPE,
    resourceId: record.id,
    message: "Office updated.",
    attributes: { fields: Object.keys(input) },
    correlationId
  });

  return record;
}

/**
 * One page of SOFT-DELETED offices, most-recently-deleted first, so the admin
 * screen can offer a restore control. The active-office `listOffices` filters
 * `deleted_at IS NULL`, so deleted rows are otherwise unreachable from the UI;
 * this is their only read path. Bounded by the same page limit — the deleted
 * set is expected to be small, and an unbounded scan is exactly what Issue #149
 * forbids.
 */
export async function listDeletedOffices(
  tx: Bun.SQL,
  tenantId: string
): Promise<OfficeRecord[]> {
  const rows = (await tx`
    SELECT id, office_code, office_name, office_type, parent_office_id, status, created_at, updated_at
    FROM awcms_offices
    WHERE tenant_id = ${tenantId} AND deleted_at IS NOT NULL
    ORDER BY deleted_at DESC, id DESC
    LIMIT ${OFFICE_LIST_LIMIT}
  `) as OfficeRow[];

  return rows.map(toRecord);
}

/**
 * Soft-deletes a live office: stamps `deleted_at`/`deleted_by`/`delete_reason`
 * and audits the removal (severity `warning`, a high-risk lifecycle action).
 * Returns `false` when the id is absent, in another tenant, or ALREADY
 * soft-deleted (`deleted_at IS NULL` guard) — the route maps that to 404.
 * Soft delete, never a hard `DELETE`: the row must remain restorable, and the
 * partial unique index (`WHERE deleted_at IS NULL`) frees the office code for
 * reuse the instant it is deleted.
 */
export async function softDeleteOffice(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  officeId: string,
  reason: string | null,
  correlationId?: string
): Promise<boolean> {
  const rows = await tx`
    UPDATE awcms_offices
    SET deleted_at = now(), deleted_by = ${actorTenantUserId},
        delete_reason = ${reason}, updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${officeId} AND deleted_at IS NULL
    RETURNING id
  `;

  if (rows.length === 0) return false;

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId,
    moduleKey: AUDIT_MODULE_KEY,
    action: "delete",
    resourceType: AUDIT_RESOURCE_TYPE,
    resourceId: officeId,
    severity: "warning",
    message: "Office soft-deleted.",
    attributes: { reason },
    correlationId
  });

  return true;
}

/**
 * Restores a soft-deleted office: clears the delete stamps, records
 * `restored_at`/`restored_by`, and audits it (`warning`). Returns `null` when
 * the id is absent, in another tenant, or NOT currently soft-deleted
 * (`deleted_at IS NOT NULL` guard) → 404 at the route. Restoring is idempotent-
 * safe: a second restore is a 404, not a duplicate.
 *
 * @throws {DuplicateOfficeCodeError} restoring would resurrect a code that a
 *   DIFFERENT live office has taken while this one was deleted. The partial
 *   unique index (`awcms_offices_tenant_code_key WHERE deleted_at IS NULL`)
 *   raises 23505 on the UPDATE; that is caller-actionable (rename or delete the
 *   conflicting office) so it must surface as 409, not 500.
 */
export async function restoreOffice(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  officeId: string,
  correlationId?: string
): Promise<OfficeRecord | null> {
  // Read the deleted row's code first: it names the DuplicateOfficeCodeError
  // precisely AND is the existence check (a live/absent id yields no row → the
  // caller gets a 404 before any write is attempted).
  const deletedRows = (await tx`
    SELECT office_code FROM awcms_offices
    WHERE tenant_id = ${tenantId} AND id = ${officeId} AND deleted_at IS NOT NULL
  `) as { office_code: string }[];

  if (deletedRows.length === 0) return null;
  const officeCode = deletedRows[0]!.office_code;

  let rows: OfficeRow[];

  try {
    rows = (await tx`
      UPDATE awcms_offices
      SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL,
          restored_at = now(), restored_by = ${actorTenantUserId}, updated_at = now()
      WHERE tenant_id = ${tenantId} AND id = ${officeId} AND deleted_at IS NOT NULL
      RETURNING id, office_code, office_name, office_type, parent_office_id, status, created_at, updated_at
    `) as OfficeRow[];
  } catch (error) {
    if (
      error instanceof Bun.SQL.PostgresError &&
      String(error.errno) === POSTGRES_UNIQUE_VIOLATION
    ) {
      // The 23505 has already ABORTED this transaction. The route catches this
      // and returns 409 on `withTenant`'s normal path, whose commit degrades
      // to a rollback — and NO audit event may be written past this point, or
      // it would fail 25P02 and turn the 409 into a 500 (same rule as
      // createOffice's duplicate handling).
      throw new DuplicateOfficeCodeError(officeCode);
    }

    throw error;
  }

  if (rows.length === 0) return null;

  const record = toRecord(rows[0]!);

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId,
    moduleKey: AUDIT_MODULE_KEY,
    action: "restore",
    resourceType: AUDIT_RESOURCE_TYPE,
    resourceId: record.id,
    severity: "warning",
    message: `Office restored: ${record.officeCode}.`,
    correlationId
  });

  return record;
}
