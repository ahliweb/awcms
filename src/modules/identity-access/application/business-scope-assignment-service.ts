/**
 * Business-scope assignment service (Issue #180, epic #177 Wave 2
 * authorization). Persistence + audit around
 * `domain/business-scope-assignment.ts`'s pure rules. Ported from awcms-mini
 * (`identity-access/application/business-scope-assignment-service.ts`, Issue
 * #746) but with the segregation-of-duties (SoD) conflict evaluation STRIPPED
 * — see the SoD SEAM comment in `createBusinessScopeAssignment` below; that
 * enforcement lands with #181. "not-found/invalid-state is a discriminated
 * union, never a thrown error" — the convention the rest of this repo's
 * application services use.
 *
 * CREATE validates the scope through `BusinessScopeHierarchyPort` (never
 * trusts `scopeType`/`scopeId` from the request alone — issue #180 security
 * model) and denies self-grant (grantor === subject). The grant is persisted
 * and audited WITHOUT any conflict detection (that is #181's job).
 */
import { recordAuditEvent } from "../../logging/application/audit-log";
import { recordCounter } from "../../../lib/observability/metrics-port";
import type { BusinessScopeHierarchyPort } from "../../_shared/ports/business-scope-hierarchy-port";
import {
  validateCreateBusinessScopeAssignmentInput,
  validateRevokeBusinessScopeAssignmentInput,
  type CreateBusinessScopeAssignmentInput,
  type BusinessScopeAssignmentValidationError,
  type RevokeBusinessScopeAssignmentInput
} from "../domain/business-scope-assignment";

const IDENTITY_ACCESS_MODULE_KEY = "identity_access";

export type BusinessScopeAssignmentRow = {
  id: string;
  tenantId: string;
  tenantUserId: string;
  roleId: string | null;
  scopeType: string;
  scopeId: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  isTemporary: boolean;
  reason: string | null;
  grantedByTenantUserId: string;
  approvedByTenantUserId: string | null;
  status: "active" | "expired" | "revoked";
  revokedAt: Date | null;
  revokedByTenantUserId: string | null;
  revokeReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type BusinessScopeAssignmentDbRow = {
  id: string;
  tenant_id: string;
  tenant_user_id: string;
  role_id: string | null;
  scope_type: string;
  scope_id: string;
  effective_from: Date;
  effective_to: Date | null;
  is_temporary: boolean;
  reason: string | null;
  granted_by_tenant_user_id: string;
  approved_by_tenant_user_id: string | null;
  status: BusinessScopeAssignmentRow["status"];
  revoked_at: Date | null;
  revoked_by_tenant_user_id: string | null;
  revoke_reason: string | null;
  created_at: Date;
  updated_at: Date;
};

function toRow(row: BusinessScopeAssignmentDbRow): BusinessScopeAssignmentRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    tenantUserId: row.tenant_user_id,
    roleId: row.role_id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    isTemporary: row.is_temporary,
    reason: row.reason,
    grantedByTenantUserId: row.granted_by_tenant_user_id,
    approvedByTenantUserId: row.approved_by_tenant_user_id,
    status: row.status,
    revokedAt: row.revoked_at,
    revokedByTenantUserId: row.revoked_by_tenant_user_id,
    revokeReason: row.revoke_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export type CreateBusinessScopeAssignmentResult =
  | { ok: true; assignment: BusinessScopeAssignmentRow }
  | {
      ok: false;
      reason: "validation";
      errors: BusinessScopeAssignmentValidationError[];
    }
  | { ok: false; reason: "tenant_user_not_found" }
  | { ok: false; reason: "role_not_found" }
  | { ok: false; reason: "scope_unresolved" }
  | { ok: false; reason: "self_grant_denied" };

export async function createBusinessScopeAssignment(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  input: CreateBusinessScopeAssignmentInput,
  deps: {
    hierarchyPort: BusinessScopeHierarchyPort;
  },
  now: Date,
  correlationId?: string
): Promise<CreateBusinessScopeAssignmentResult> {
  const errors = validateCreateBusinessScopeAssignmentInput(input);
  if (errors.length > 0) {
    return { ok: false, reason: "validation", errors };
  }

  // Self-grant denial — granting yourself a business-scope assignment is
  // always denied (issue #180: "Self-grant ... is denied"): a scope assignment
  // that narrows/extends the subject's own effective access is treated as
  // high-risk by construction. Checked FIRST (issue #180 review F3), BEFORE any
  // DB read or the hierarchy-port I/O below — a pure identity guard precedes
  // external I/O, and this makes `SELF_GRANT_DENIED` reachable even in a
  // pure-base deployment (where the no-op resolver would otherwise short the
  // request to `SCOPE_UNRESOLVED` first).
  if (actorTenantUserId === input.tenantUserId) {
    return { ok: false, reason: "self_grant_denied" };
  }

  // Tenant-membership + role-existence check (the same explicit
  // `WHERE tenant_id = ... AND id = ...` lookups the sibling role-assignment
  // endpoint does before granting a role). Not directly exploitable (RLS +
  // the composite tenant-scoped FKs already prevent a cross-tenant row from
  // being inserted), but a clean 404 beats a raw FK violation, and this also
  // rejects a soft-deleted role — something no FK can express.
  const tenantUserRows = (await tx`
    SELECT id FROM awcms_tenant_users
    WHERE tenant_id = ${tenantId} AND id = ${input.tenantUserId}
  `) as { id: string }[];
  if (!tenantUserRows[0]) {
    return { ok: false, reason: "tenant_user_not_found" };
  }

  if (input.roleId) {
    const roleRows = (await tx`
      SELECT id FROM awcms_roles
      WHERE tenant_id = ${tenantId} AND id = ${input.roleId} AND deleted_at IS NULL
    `) as { id: string }[];
    if (!roleRows[0]) {
      return { ok: false, reason: "role_not_found" };
    }
  }

  // "Scope derived dari request harus diverifikasi terhadap resource
  // server-side; jangan percaya scopeId dari klien sebagai fakta otorisasi"
  // (issue #180 security model). The base default adapter resolves every
  // scope to `resolved: false`, so in a pure-base deployment this always
  // denies — a derived application injects a real resolver.
  const resolution = await deps.hierarchyPort.resolveScope(
    tx,
    tenantId,
    input.scopeType,
    input.scopeId
  );
  if (!resolution.resolved) {
    // Best-effort operational signal — `resolved: false` conflates "unknown
    // scope type", "scope id does not exist", and "scope belongs to a
    // different tenant" (the hierarchy port's own contract does not
    // distinguish these, to avoid leaking cross-tenant existence), so this
    // counter is a proxy for all three, not a precise cross-tenant-only
    // signal.
    recordCounter("business_scope_cross_tenant_denied_total");
    return { ok: false, reason: "scope_unresolved" };
  }

  // SoD SEAM (#181): mini evaluated segregation-of-duties conflicts HERE —
  // detecting whether the requested role's permission keys, at the requested
  // scope (and its resolved ancestors/descendants), conflict with the
  // subject's other active assignments, recording an append-only decision to
  // `awcms_mini_sod_conflict_evaluations`, and returning a `sod_conflict`
  // result. That whole block is DELIBERATELY omitted for #180 (the generic
  // scope foundation): the grant below persists and audits WITHOUT conflict
  // detection. #181 (segregation of duties) re-inserts the conflict check at
  // exactly this point, adding its own `sod_conflict` result variant and the
  // `resolution.ancestorScopes`/`.descendantScopes` are already available
  // above for its hierarchy-aware `same_scope_only` matching.

  const rows = (await tx`
    INSERT INTO awcms_business_scope_assignments
      (tenant_id, tenant_user_id, role_id, scope_type, scope_id, effective_from, effective_to,
       is_temporary, reason, granted_by_tenant_user_id, status)
    VALUES (
      ${tenantId}, ${input.tenantUserId}, ${input.roleId}, ${input.scopeType}, ${input.scopeId},
      ${input.effectiveFrom}, ${input.effectiveTo}, ${input.isTemporary}, ${input.reason},
      ${actorTenantUserId}, 'active'
    )
    RETURNING id, tenant_id, tenant_user_id, role_id, scope_type, scope_id, effective_from,
      effective_to, is_temporary, reason, granted_by_tenant_user_id, approved_by_tenant_user_id,
      status, revoked_at, revoked_by_tenant_user_id, revoke_reason, created_at, updated_at
  `) as BusinessScopeAssignmentDbRow[];

  const assignment = toRow(rows[0]!);

  await tx`
    INSERT INTO awcms_business_scope_assignment_events
      (tenant_id, assignment_id, event_type, actor_tenant_user_id, reason)
    VALUES (${tenantId}, ${assignment.id}, 'granted', ${actorTenantUserId}, ${input.reason})
  `;

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId,
    moduleKey: IDENTITY_ACCESS_MODULE_KEY,
    action: "create",
    resourceType: "business_scope_assignment",
    resourceId: assignment.id,
    severity: "warning",
    message: `Business-scope assignment granted for subject to scope "${assignment.scopeType}".`,
    attributes: {
      tenantUserId: assignment.tenantUserId,
      scopeType: assignment.scopeType,
      isTemporary: assignment.isTemporary
    },
    correlationId
  });

  return { ok: true, assignment };
}

export type RevokeBusinessScopeAssignmentResult =
  | { ok: true; assignment: BusinessScopeAssignmentRow }
  | {
      ok: false;
      reason: "validation";
      errors: BusinessScopeAssignmentValidationError[];
    }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "already_revoked" };

export async function revokeBusinessScopeAssignment(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  assignmentId: string,
  input: RevokeBusinessScopeAssignmentInput,
  correlationId?: string
): Promise<RevokeBusinessScopeAssignmentResult> {
  const errors = validateRevokeBusinessScopeAssignmentInput(input);
  if (errors.length > 0) {
    return { ok: false, reason: "validation", errors };
  }

  const existingRows = (await tx`
    SELECT id, status FROM awcms_business_scope_assignments
    WHERE tenant_id = ${tenantId} AND id = ${assignmentId}
  `) as { id: string; status: string }[];

  const existing = existingRows[0];
  if (!existing) {
    return { ok: false, reason: "not_found" };
  }
  if (existing.status !== "active") {
    return { ok: false, reason: "already_revoked" };
  }

  const rows = (await tx`
    UPDATE awcms_business_scope_assignments
    SET status = 'revoked', revoked_at = now(), revoked_by_tenant_user_id = ${actorTenantUserId},
        revoke_reason = ${input.revokeReason}, updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${assignmentId} AND status = 'active'
    RETURNING id, tenant_id, tenant_user_id, role_id, scope_type, scope_id, effective_from,
      effective_to, is_temporary, reason, granted_by_tenant_user_id, approved_by_tenant_user_id,
      status, revoked_at, revoked_by_tenant_user_id, revoke_reason, created_at, updated_at
  `) as BusinessScopeAssignmentDbRow[];

  if (!rows[0]) {
    // Lost a race against a concurrent revoke between the SELECT and UPDATE
    // above — the status-guarded UPDATE returned zero rows.
    return { ok: false, reason: "already_revoked" };
  }

  const assignment = toRow(rows[0]);

  await tx`
    INSERT INTO awcms_business_scope_assignment_events
      (tenant_id, assignment_id, event_type, actor_tenant_user_id, reason)
    VALUES (${tenantId}, ${assignment.id}, 'revoked', ${actorTenantUserId}, ${input.revokeReason})
  `;

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId,
    moduleKey: IDENTITY_ACCESS_MODULE_KEY,
    action: "revoke",
    resourceType: "business_scope_assignment",
    resourceId: assignment.id,
    severity: "critical",
    message: `Business-scope assignment revoked for subject at scope "${assignment.scopeType}".`,
    attributes: {
      tenantUserId: assignment.tenantUserId,
      scopeType: assignment.scopeType,
      revokeReason: input.revokeReason
    },
    correlationId
  });

  return { ok: true, assignment };
}

export type ListBusinessScopeAssignmentsFilter = {
  status?: BusinessScopeAssignmentRow["status"];
  tenantUserId?: string;
  scopeType?: string;
};

/** `LIMIT 200`, newest first — a bounded management list, not a keyset feed. */
export async function listBusinessScopeAssignments(
  tx: Bun.SQL,
  tenantId: string,
  filter: ListBusinessScopeAssignmentsFilter = {}
): Promise<BusinessScopeAssignmentRow[]> {
  const rows = (await tx`
    SELECT id, tenant_id, tenant_user_id, role_id, scope_type, scope_id, effective_from,
      effective_to, is_temporary, reason, granted_by_tenant_user_id, approved_by_tenant_user_id,
      status, revoked_at, revoked_by_tenant_user_id, revoke_reason, created_at, updated_at
    FROM awcms_business_scope_assignments
    WHERE tenant_id = ${tenantId}
      AND (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
      AND (${filter.tenantUserId ?? null}::uuid IS NULL OR tenant_user_id = ${filter.tenantUserId ?? null})
      AND (${filter.scopeType ?? null}::text IS NULL OR scope_type = ${filter.scopeType ?? null})
    ORDER BY created_at DESC
    LIMIT 200
  `) as BusinessScopeAssignmentDbRow[];

  return rows.map(toRow);
}
