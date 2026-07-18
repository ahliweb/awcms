/**
 * Tenant-user administration writes (Issue #171) — the write counterpart to the
 * read-only `access-directory.ts`. Three high-risk mutations behind the admin
 * Users screen and its JSON endpoints:
 *
 * - `setTenantUserStatus` — activate / deactivate a tenant user. There is no
 *   `deleted_at` on `awcms_tenant_users`, so a "soft delete" is `status =
 *   'inactive'` (deactivate) and a "restore" is `status = 'active'`
 *   (reactivate). Deactivating revokes all of a user's access at once.
 * - `assignRole` — grant a role to a tenant user. Idempotent at the DB via the
 *   `(tenant_id, tenant_user_id, role_id)` unique index: a repeat assign raises
 *   23505, mapped to `DuplicateAssignmentError` (→ 409) by the caller.
 * - `unassignRole` — revoke a role from a tenant user.
 *
 * ALL are gated by the caller's ABAC guard and run inside `withTenant` (RLS
 * FORCE is the real boundary); every query is additionally tenant-filtered as
 * defence-in-depth. Every mutation writes an audit event (high-risk actions,
 * doc 03/10). Login identifiers are PII and are NEVER logged here — the audit
 * row references the stable `tenant_user_id`, not the identifier.
 */
import { recordAuditEvent } from "../../logging/application/audit-log";

const AUDIT_MODULE_KEY = "identity_access";
const POSTGRES_UNIQUE_VIOLATION = "23505";

export const TENANT_USER_STATUSES = ["active", "inactive"] as const;
export type TenantUserStatus = (typeof TENANT_USER_STATUSES)[number];

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ValidationError = { field: string; message: string };
type ValidationResult<T> =
  { valid: true; value: T } | { valid: false; errors: ValidationError[] };

/**
 * The tenant user or role referenced by an assignment does not exist in this
 * tenant. Deliberately ONE error for both causes so the response cannot be used
 * as an existence oracle for ids belonging to another tenant (same posture as
 * `ParentOfficeNotFoundError`). Raised BEFORE any write.
 */
export class AssignmentTargetNotFoundError extends Error {
  constructor() {
    super(
      "tenantUserId or roleId does not reference a live record in this tenant."
    );
    this.name = "AssignmentTargetNotFoundError";
  }
}

/** The role is already assigned to the tenant user (unique-index 23505). */
export class DuplicateAssignmentError extends Error {
  constructor() {
    super("The role is already assigned to this tenant user.");
    this.name = "DuplicateAssignmentError";
  }
}

/**
 * Assigning or unassigning an `is_system` role (e.g. the seeded `owner`) is
 * refused. The `assign` permission reads as "attach ordinary roles"; letting it
 * grant `owner` would be a self-escalation to full tenant admin, and letting it
 * strip `owner` from the sole owner would lock the tenant out. Root-role
 * membership is an invariant set at bootstrap, not an admin-surface mutation.
 * The caller maps it to 409.
 */
export class SystemRoleAssignmentError extends Error {
  constructor() {
    super("System roles cannot be assigned or unassigned through this API.");
    this.name = "SystemRoleAssignmentError";
  }
}

export type SetStatusInput = { status: TenantUserStatus };

export function validateSetStatusInput(
  body: unknown
): ValidationResult<SetStatusInput> {
  const record = (body ?? {}) as Record<string, unknown>;
  const errors: ValidationError[] = [];

  if (
    typeof record.status !== "string" ||
    !TENANT_USER_STATUSES.includes(record.status as TenantUserStatus)
  ) {
    errors.push({
      field: "status",
      message: `status must be one of: ${TENANT_USER_STATUSES.join(", ")}.`
    });
  }

  if (errors.length > 0) return { valid: false, errors };

  return { valid: true, value: { status: record.status as TenantUserStatus } };
}

export type AssignmentInput = { tenantUserId: string; roleId: string };

export function validateAssignmentInput(
  body: unknown
): ValidationResult<AssignmentInput> {
  const record = (body ?? {}) as Record<string, unknown>;
  const errors: ValidationError[] = [];

  if (
    typeof record.tenantUserId !== "string" ||
    !UUID_PATTERN.test(record.tenantUserId)
  ) {
    errors.push({
      field: "tenantUserId",
      message: "tenantUserId must be a valid UUID."
    });
  }

  if (typeof record.roleId !== "string" || !UUID_PATTERN.test(record.roleId)) {
    errors.push({ field: "roleId", message: "roleId must be a valid UUID." });
  }

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    value: {
      tenantUserId: record.tenantUserId as string,
      roleId: record.roleId as string
    }
  };
}

export type TenantUserStatusRecord = {
  id: string;
  status: string;
  updatedAt: Date;
};

type TenantUserStatusRow = {
  id: string;
  status: string;
  updated_at: Date;
};

/**
 * Outcome of {@link setTenantUserStatus}. `updated` carries the new record;
 * `not_found` → 404; `self_blocked`/`last_admin_blocked` → 409 lockout guards.
 */
export type SetStatusResult =
  | { outcome: "updated"; record: TenantUserStatusRecord }
  | { outcome: "not_found" }
  | { outcome: "self_blocked" }
  | { outcome: "last_admin_blocked" };

/**
 * Sets a tenant user's status.
 *
 * Deactivation (`status = 'inactive'`) revokes all of a user's access (login
 * reads this status), so two lockout foot-guns are blocked BEFORE the write —
 * mirroring `softDeleteRole`'s `is_system` guard:
 *  - `self_blocked` — an actor cannot deactivate themselves.
 *  - `last_admin_blocked` — the last active member of an `is_system` (owner)
 *    role cannot be deactivated, or no active administrator would remain and
 *    the tenant would be locked out with no in-app recovery.
 *
 * Activation carries no such guard. `not_found` (no live user in this tenant) is
 * detected by the UPDATE itself (no oracle-leaking pre-read). Audits on success.
 */
export async function setTenantUserStatus(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  tenantUserId: string,
  status: TenantUserStatus,
  correlationId?: string
): Promise<SetStatusResult> {
  if (status === "inactive") {
    if (actorTenantUserId === tenantUserId) {
      return { outcome: "self_blocked" };
    }

    const adminState = (await tx`
      SELECT
        EXISTS (
          SELECT 1 FROM awcms_access_assignments aa
          JOIN awcms_roles r
            ON r.id = aa.role_id AND r.tenant_id = aa.tenant_id
          WHERE aa.tenant_id = ${tenantId}
            AND aa.tenant_user_id = ${tenantUserId}
            AND r.is_system = true AND r.deleted_at IS NULL
        ) AS target_is_admin,
        EXISTS (
          SELECT 1 FROM awcms_access_assignments aa
          JOIN awcms_roles r
            ON r.id = aa.role_id AND r.tenant_id = aa.tenant_id
          JOIN awcms_tenant_users tu
            ON tu.id = aa.tenant_user_id AND tu.tenant_id = aa.tenant_id
          WHERE aa.tenant_id = ${tenantId}
            AND aa.tenant_user_id <> ${tenantUserId}
            AND r.is_system = true AND r.deleted_at IS NULL
            AND tu.status = 'active'
        ) AS other_active_admin_exists
    `) as Array<{
      target_is_admin: boolean;
      other_active_admin_exists: boolean;
    }>;

    if (
      adminState[0]!.target_is_admin &&
      !adminState[0]!.other_active_admin_exists
    ) {
      return { outcome: "last_admin_blocked" };
    }
  }

  const rows = (await tx`
    UPDATE awcms_tenant_users
    SET status = ${status}, updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${tenantUserId}
    RETURNING id, status, updated_at
  `) as TenantUserStatusRow[];

  if (rows.length === 0) return { outcome: "not_found" };

  const record: TenantUserStatusRecord = {
    id: rows[0]!.id,
    status: rows[0]!.status,
    updatedAt: rows[0]!.updated_at
  };

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId,
    moduleKey: AUDIT_MODULE_KEY,
    action: "update",
    resourceType: "tenant_user",
    resourceId: record.id,
    severity: "warning",
    // No identifier in the message — `tenant_user_id` (resourceId) is the
    // stable reference; the login identifier is PII and is never logged.
    message: `Tenant user status set to ${record.status}.`,
    attributes: { status: record.status },
    correlationId
  });

  return { outcome: "updated", record };
}

export type AssignmentRecord = {
  id: string;
  tenantUserId: string;
  roleId: string;
};

/**
 * Assigns a role to a tenant user.
 *
 * @throws {AssignmentTargetNotFoundError} the tenant user or role is not a live
 *   record in this tenant. Checked BEFORE the INSERT: `withTenant` COMMITs on a
 *   normal return, so any 4xx-mapped throw must precede the first write, and the
 *   composite FKs would otherwise surface as an opaque 500.
 * @throws {DuplicateAssignmentError} the role is already assigned (23505). This
 *   follows the unique violation that already aborted the transaction, so the
 *   caller must NOT write anything further (e.g. an audit row) before returning
 *   409 — that write would fail with 25P02 and turn the 409 into a 500.
 */
export async function assignRole(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  tenantUserId: string,
  roleId: string,
  correlationId?: string
): Promise<AssignmentRecord> {
  const targets = (await tx`
    SELECT
      EXISTS (
        SELECT 1 FROM awcms_tenant_users
        WHERE tenant_id = ${tenantId} AND id = ${tenantUserId}
      ) AS user_exists,
      EXISTS (
        SELECT 1 FROM awcms_roles
        WHERE tenant_id = ${tenantId} AND id = ${roleId} AND deleted_at IS NULL
      ) AS role_exists,
      EXISTS (
        SELECT 1 FROM awcms_roles
        WHERE tenant_id = ${tenantId} AND id = ${roleId}
          AND deleted_at IS NULL AND is_system = true
      ) AS role_is_system
  `) as Array<{
    user_exists: boolean;
    role_exists: boolean;
    role_is_system: boolean;
  }>;

  if (!targets[0]!.user_exists || !targets[0]!.role_exists) {
    throw new AssignmentTargetNotFoundError();
  }
  // Refuse before any write: `withTenant` COMMITs on a normal return, so the
  // guard must precede the INSERT.
  if (targets[0]!.role_is_system) {
    throw new SystemRoleAssignmentError();
  }

  let rows: Array<{ id: string }>;
  try {
    rows = (await tx`
      INSERT INTO awcms_access_assignments (tenant_id, tenant_user_id, role_id, assigned_by)
      VALUES (${tenantId}, ${tenantUserId}, ${roleId}, ${actorTenantUserId})
      RETURNING id
    `) as Array<{ id: string }>;
  } catch (error) {
    if (
      error instanceof Bun.SQL.PostgresError &&
      String(error.errno) === POSTGRES_UNIQUE_VIOLATION
    ) {
      throw new DuplicateAssignmentError();
    }
    throw error;
  }

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId,
    moduleKey: AUDIT_MODULE_KEY,
    action: "assign",
    resourceType: "tenant_user",
    resourceId: tenantUserId,
    severity: "warning",
    message: "Role assigned to tenant user.",
    attributes: { roleId },
    correlationId
  });

  return { id: rows[0]!.id, tenantUserId, roleId };
}

/**
 * Revokes a role from a tenant user. Returns `false` when no matching
 * assignment existed (→ 404 at the caller); audits only a real revocation.
 */
export async function unassignRole(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  tenantUserId: string,
  roleId: string,
  correlationId?: string
): Promise<boolean> {
  // Refuse to unassign a system role (e.g. `owner`) — stripping it from the
  // sole owner locks the tenant out. Scoped to this tenant, so a foreign
  // `roleId` finds nothing and falls through to the DELETE (→ 404), leaking no
  // cross-tenant existence.
  const systemRole = (await tx`
    SELECT 1 FROM awcms_roles
    WHERE tenant_id = ${tenantId} AND id = ${roleId}
      AND deleted_at IS NULL AND is_system = true
  `) as Array<{ "?column?": number }>;
  if (systemRole.length > 0) {
    throw new SystemRoleAssignmentError();
  }

  const rows = (await tx`
    DELETE FROM awcms_access_assignments
    WHERE tenant_id = ${tenantId}
      AND tenant_user_id = ${tenantUserId}
      AND role_id = ${roleId}
    RETURNING id
  `) as Array<{ id: string }>;

  if (rows.length === 0) return false;

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId,
    moduleKey: AUDIT_MODULE_KEY,
    action: "revoke",
    resourceType: "tenant_user",
    resourceId: tenantUserId,
    severity: "warning",
    message: "Role revoked from tenant user.",
    attributes: { roleId },
    correlationId
  });

  return true;
}
