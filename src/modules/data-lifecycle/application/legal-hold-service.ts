/**
 * Legal hold service (ported from awcms-micro Issue #745, ADR-0037). Thin
 * persistence + audit wrapper around `domain/legal-hold.ts`'s pure rules —
 * every write here is audited `critical` ("audit" is an explicit legal-hold
 * requirement, and both create/release are high-risk actions).
 *
 * Not-found / invalid-state convention: a write against a hold that doesn't
 * exist (or, for release, isn't `active`) returns a discriminated-union failure
 * rather than throwing — the caller (API route) maps that to the appropriate
 * HTTP status. Column lists are spelled out per-query (not composed via
 * `tx.unsafe()` inside a tagged template — that method is for building a whole
 * raw SQL STRING, it does not compose as an interpolated fragment inside
 * `` tx`...` ``), the same convention every other repository file in this repo
 * follows.
 */
import { recordAuditEvent } from "../../logging/application/audit-log";
import {
  validateCreateLegalHoldInput,
  validateReleaseLegalHoldInput,
  type CreateLegalHoldInput,
  type LegalHoldRecord,
  type LegalHoldValidationError,
  type ReleaseLegalHoldInput
} from "../domain/legal-hold";
import { DATA_LIFECYCLE_MODULE_KEY } from "../domain/data-lifecycle-permissions";

export type LegalHoldRow = {
  id: string;
  tenantId: string;
  descriptorKey: string | null;
  scopeDescription: string;
  reason: string;
  authorityReference: string;
  authorityMetadata: Record<string, unknown>;
  status: "active" | "released";
  startsAt: Date;
  endsAt: Date | null;
  requestedBy: string;
  approvedBy: string | null;
  approvedAt: Date | null;
  releasedBy: string | null;
  releasedAt: Date | null;
  releaseReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type LegalHoldDbRow = {
  id: string;
  tenant_id: string;
  descriptor_key: string | null;
  scope_description: string;
  reason: string;
  authority_reference: string;
  authority_metadata: Record<string, unknown>;
  status: "active" | "released";
  starts_at: Date;
  ends_at: Date | null;
  requested_by: string;
  approved_by: string | null;
  approved_at: Date | null;
  released_by: string | null;
  released_at: Date | null;
  release_reason: string | null;
  created_at: Date;
  updated_at: Date;
};

function toRow(row: LegalHoldDbRow): LegalHoldRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    descriptorKey: row.descriptor_key,
    scopeDescription: row.scope_description,
    reason: row.reason,
    authorityReference: row.authority_reference,
    authorityMetadata: row.authority_metadata,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    requestedBy: row.requested_by,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    releasedBy: row.released_by,
    releasedAt: row.released_at,
    releaseReason: row.release_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export type CreateLegalHoldResult =
  | { ok: true; hold: LegalHoldRow }
  | { ok: false; errors: LegalHoldValidationError[] };

export async function createLegalHold(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  input: CreateLegalHoldInput,
  correlationId?: string
): Promise<CreateLegalHoldResult> {
  const errors = validateCreateLegalHoldInput(input);
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const rows = (await tx`
    INSERT INTO awcms_data_lifecycle_legal_holds
      (tenant_id, descriptor_key, scope_description, reason, authority_reference,
       authority_metadata, status, ends_at, requested_by, approved_by, approved_at)
    VALUES (
      ${tenantId}, ${input.descriptorKey}, ${input.scopeDescription}, ${input.reason},
      ${input.authorityReference}, '{}'::jsonb, 'active', ${input.endsAt},
      ${actorTenantUserId}, ${actorTenantUserId}, now()
    )
    RETURNING id, tenant_id, descriptor_key, scope_description, reason, authority_reference,
      authority_metadata, status, starts_at, ends_at, requested_by, approved_by,
      approved_at, released_by, released_at, release_reason, created_at, updated_at
  `) as LegalHoldDbRow[];

  const hold = toRow(rows[0]!);

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId,
    moduleKey: DATA_LIFECYCLE_MODULE_KEY,
    action: "create",
    resourceType: "legal_hold",
    resourceId: hold.id,
    severity: "critical",
    message: `Legal hold created${hold.descriptorKey ? ` for descriptor "${hold.descriptorKey}"` : " (tenant-wide)"}.`,
    attributes: {
      descriptorKey: hold.descriptorKey,
      authorityReference: hold.authorityReference
    },
    correlationId
  });

  return { ok: true, hold };
}

export type ReleaseLegalHoldResult =
  | { ok: true; hold: LegalHoldRow }
  | { ok: false; reason: "not_found" | "already_released" }
  | { ok: false; reason: "validation"; errors: LegalHoldValidationError[] };

export async function releaseLegalHold(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  holdId: string,
  input: ReleaseLegalHoldInput,
  correlationId?: string
): Promise<ReleaseLegalHoldResult> {
  const errors = validateReleaseLegalHoldInput(input);
  if (errors.length > 0) {
    return { ok: false, reason: "validation", errors };
  }

  const existingRows = (await tx`
    SELECT id, status
    FROM awcms_data_lifecycle_legal_holds
    WHERE tenant_id = ${tenantId} AND id = ${holdId}
  `) as { id: string; status: "active" | "released" }[];

  const existing = existingRows[0];
  if (!existing) {
    return { ok: false, reason: "not_found" };
  }
  if (existing.status !== "active") {
    return { ok: false, reason: "already_released" };
  }

  const rows = (await tx`
    UPDATE awcms_data_lifecycle_legal_holds
    SET status = 'released', released_by = ${actorTenantUserId}, released_at = now(),
        release_reason = ${input.releaseReason}, updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${holdId} AND status = 'active'
    RETURNING id, tenant_id, descriptor_key, scope_description, reason, authority_reference,
      authority_metadata, status, starts_at, ends_at, requested_by, approved_by,
      approved_at, released_by, released_at, release_reason, created_at, updated_at
  `) as LegalHoldDbRow[];

  if (!rows[0]) {
    // Lost a race against a concurrent release between the SELECT and UPDATE
    // above — report the same outcome a sequential caller would have seen,
    // rather than a confusing empty success.
    return { ok: false, reason: "already_released" };
  }

  const hold = toRow(rows[0]);

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId,
    moduleKey: DATA_LIFECYCLE_MODULE_KEY,
    action: "release",
    resourceType: "legal_hold",
    resourceId: hold.id,
    severity: "critical",
    message: `Legal hold released${hold.descriptorKey ? ` for descriptor "${hold.descriptorKey}"` : " (tenant-wide)"}.`,
    attributes: {
      descriptorKey: hold.descriptorKey,
      releaseReason: hold.releaseReason
    },
    correlationId
  });

  return { ok: true, hold };
}

export type ListLegalHoldsFilter = {
  status?: "active" | "released";
  descriptorKey?: string;
};

/** `LIMIT 200`, newest first — bounded-list convention, no cursor pagination for what is expected to be a low-volume compliance record. */
export async function listLegalHolds(
  tx: Bun.SQL,
  tenantId: string,
  filter: ListLegalHoldsFilter = {}
): Promise<LegalHoldRow[]> {
  const rows = (await tx`
    SELECT id, tenant_id, descriptor_key, scope_description, reason, authority_reference,
      authority_metadata, status, starts_at, ends_at, requested_by, approved_by,
      approved_at, released_by, released_at, release_reason, created_at, updated_at
    FROM awcms_data_lifecycle_legal_holds
    WHERE tenant_id = ${tenantId}
      AND (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
      AND (
        ${filter.descriptorKey ?? null}::text IS NULL
        OR descriptor_key = ${filter.descriptorKey ?? null}
        OR descriptor_key IS NULL
      )
    ORDER BY created_at DESC
    LIMIT 200
  `) as LegalHoldDbRow[];

  return rows.map(toRow);
}

/** Fetches every currently-`active` hold for the tenant, in the shape `domain/legal-hold.ts`'s `evaluateLegalHoldForDescriptor` expects — used by the dry-run planner and the archive/purge job, both of which must check EVERY registered descriptor against the SAME hold set within one run. */
export async function fetchActiveLegalHoldsForPlanning(
  tx: Bun.SQL,
  tenantId: string
): Promise<LegalHoldRecord[]> {
  const rows = (await tx`
    SELECT id, tenant_id, descriptor_key, status
    FROM awcms_data_lifecycle_legal_holds
    WHERE tenant_id = ${tenantId} AND status = 'active'
  `) as {
    id: string;
    tenant_id: string;
    descriptor_key: string | null;
    status: "active" | "released";
  }[];

  return rows.map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    descriptorKey: row.descriptor_key,
    status: row.status
  }));
}
