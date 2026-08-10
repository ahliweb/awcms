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
import { revokeAllSessionsForIdentity } from "./session-revocation";
import { activeRoleGrants } from "./grant-source";
import {
  grantGroupRolePolicy,
  grantRolePolicy,
  groupHoldsRole,
  revokeGroupRoleGrants,
  revokeRoleGrants,
  subjectHoldsRole
} from "./access-policy-writer";

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

/**
 * Who a role is being granted to (ADR-0081).
 *
 * A discriminated union rather than two optional ids, so the caller cannot name
 * both and leave the endpoint to pick — the same XOR the database enforces on
 * `awcms_access_policies`, stated once more at the edge where a client can
 * actually get it wrong.
 */
export type AssignmentInput =
  | { subject: "tenant_user"; tenantUserId: string; roleId: string }
  | { subject: "user_group"; userGroupId: string; roleId: string };

export function validateAssignmentInput(
  body: unknown
): ValidationResult<AssignmentInput> {
  const record = (body ?? {}) as Record<string, unknown>;
  const errors: ValidationError[] = [];

  const namesUser = record.tenantUserId !== undefined;
  const namesGroup = record.userGroupId !== undefined;

  if (namesUser === namesGroup) {
    errors.push({
      field: "tenantUserId",
      message:
        "Name exactly one subject: tenantUserId (a person) or userGroupId (a group)."
    });
  }

  if (
    namesUser &&
    (typeof record.tenantUserId !== "string" ||
      !UUID_PATTERN.test(record.tenantUserId))
  ) {
    errors.push({
      field: "tenantUserId",
      message: "tenantUserId must be a valid UUID."
    });
  }

  if (
    namesGroup &&
    (typeof record.userGroupId !== "string" ||
      !UUID_PATTERN.test(record.userGroupId))
  ) {
    errors.push({
      field: "userGroupId",
      message: "userGroupId must be a valid UUID."
    });
  }

  if (typeof record.roleId !== "string" || !UUID_PATTERN.test(record.roleId)) {
    errors.push({ field: "roleId", message: "roleId must be a valid UUID." });
  }

  if (errors.length > 0) return { valid: false, errors };

  if (namesGroup) {
    return {
      valid: true,
      value: {
        subject: "user_group",
        userGroupId: record.userGroupId as string,
        roleId: record.roleId as string
      }
    };
  }

  return {
    valid: true,
    value: {
      subject: "tenant_user",
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
  identity_id: string;
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
 * Deactivation (`status = 'inactive'`) blocks LOGIN, and — since this change —
 * also revokes every session the user already holds. Those are two different
 * things, and the gap between them was real: `resolveTenantContext` never reads
 * `status`, so before this a deactivated user kept working normally until their
 * session happened to expire. "Revoke this person's access" has to mean now,
 * not "in up to a session lifetime".
 *
 * Machine credentials bound to the user need no separate sweep: the machine
 * principal path (`resolveTenantContextForTenantUser`, ADR-0049) requires an
 * ACTIVE tenant user, so they stop resolving at the same instant.
 *
 * Two lockout foot-guns are blocked BEFORE the write —
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
          SELECT 1 FROM (${activeRoleGrants(tx, tenantId)}) g
          JOIN awcms_roles r
            ON r.id = g.role_id AND r.tenant_id = ${tenantId}
          WHERE g.tenant_user_id = ${tenantUserId}
            AND r.is_system = true AND r.deleted_at IS NULL
        ) AS target_is_admin,
        EXISTS (
          SELECT 1 FROM (${activeRoleGrants(tx, tenantId)}) g
          JOIN awcms_roles r
            ON r.id = g.role_id AND r.tenant_id = ${tenantId}
          JOIN awcms_tenant_users tu
            ON tu.id = g.tenant_user_id AND tu.tenant_id = ${tenantId}
          WHERE g.tenant_user_id <> ${tenantUserId}
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
    RETURNING id, identity_id, status, updated_at
  `) as TenantUserStatusRow[];

  if (rows.length === 0) return { outcome: "not_found" };

  if (status === "inactive") {
    // Inside the same transaction as the status write: a deactivation that
    // committed while the revocation failed would leave a live session behind
    // for exactly the account someone just decided to shut out.
    await revokeAllSessionsForIdentity(
      tx,
      tenantId,
      rows[0]!.identity_id,
      new Date()
    );
  }

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

  // ADR-0078 — the duplicate check does not come for free from one unique
  // index any more: the active partial index covers one (role, scope) pair, not
  // "already holds this role". Asked BEFORE the write so "already assigned"
  // stays a clean 409 rather than a unique violation that has already aborted
  // the transaction.
  if (await subjectHoldsRole(tx, tenantId, tenantUserId, roleId)) {
    throw new DuplicateAssignmentError();
  }

  let rows: Array<{ id: string }>;
  try {
    rows = [
      await grantRolePolicy(tx, tenantId, {
        tenantUserId,
        roleId,
        grantedByTenantUserId: actorTenantUserId
      })
    ];
  } catch (error) {
    // Still translated: the check above closes the window it can, and a
    // concurrent grant of the same role can still lose the race at the partial
    // unique index. That is the one case where 23505 is the honest answer.
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
 * Grants a role to a GROUP (ADR-0081).
 *
 * The same three refusals as the per-person path, and deliberately so: an
 * `is_system` role is refused here too, because granting `owner` to a group
 * would hand it to everyone in the group AND to everyone added later — the
 * escalation the per-person guard exists to prevent, with a delayed fuse.
 *
 * The audit row names the GROUP. Who it reached is a membership question, and
 * membership has its own audit trail; naming the members here would record a
 * snapshot that stops being true the next time somebody joins.
 */
export async function assignRoleToGroup(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  userGroupId: string,
  roleId: string,
  correlationId?: string
): Promise<{ id: string; userGroupId: string; roleId: string }> {
  const targets = (await tx`
    SELECT
      EXISTS (
        SELECT 1 FROM awcms_user_groups
        WHERE tenant_id = ${tenantId} AND id = ${userGroupId}
          AND deleted_at IS NULL
      ) AS group_exists,
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
    group_exists: boolean;
    role_exists: boolean;
    role_is_system: boolean;
  }>;

  if (!targets[0]!.group_exists || !targets[0]!.role_exists) {
    throw new AssignmentTargetNotFoundError();
  }
  if (targets[0]!.role_is_system) {
    throw new SystemRoleAssignmentError();
  }
  if (await groupHoldsRole(tx, tenantId, userGroupId, roleId)) {
    throw new DuplicateAssignmentError();
  }

  let granted: { id: string };
  try {
    granted = await grantGroupRolePolicy(tx, tenantId, {
      userGroupId,
      roleId,
      grantedByTenantUserId: actorTenantUserId
    });
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
    resourceType: "user_group",
    resourceId: userGroupId,
    severity: "warning",
    message: "Role assigned to user group.",
    attributes: { roleId },
    correlationId
  });

  return { id: granted.id, userGroupId, roleId };
}

/** Revokes a role from a GROUP. `false` when it held none (→ 404 at the caller). */
export async function unassignRoleFromGroup(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  userGroupId: string,
  roleId: string,
  correlationId?: string
): Promise<boolean> {
  const systemRole = (await tx`
    SELECT 1 FROM awcms_roles
    WHERE tenant_id = ${tenantId} AND id = ${roleId}
      AND deleted_at IS NULL AND is_system = true
  `) as Array<{ "?column?": number }>;
  if (systemRole.length > 0) {
    throw new SystemRoleAssignmentError();
  }

  const revoked = await revokeGroupRoleGrants(
    tx,
    tenantId,
    userGroupId,
    roleId,
    actorTenantUserId,
    new Date()
  );

  if (!revoked) return false;

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId,
    moduleKey: AUDIT_MODULE_KEY,
    action: "assign",
    resourceType: "user_group",
    resourceId: userGroupId,
    severity: "warning",
    message: "Role revoked from user group.",
    attributes: { roleId, revoked: true },
    correlationId
  });

  return true;
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

  // Looks in BOTH tables (ADR-0078). A remover that only knew about the new one
  // would report success while the role survived through a legacy row — the most
  // dangerous shape available here, because it fails toward ACCESS RETAINED and
  // nothing observes it.
  const removed = await revokeRoleGrants(
    tx,
    tenantId,
    tenantUserId,
    roleId,
    actorTenantUserId,
    new Date()
  );

  if (!removed) return false;

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
