/**
 * Role (RBAC) WRITE logic for the admin management screen (Issue #171). Kept
 * separate from the READ-only `access-directory.ts` (owned by another slice):
 * every function here mutates and is HIGH-RISK, so each writes an audit event
 * and is gated by the caller's `identity_access.access_control.configure`
 * guard.
 *
 * ABAC ACTION NOTE: role CRUD and role↔permission management all authorize on
 * the seeded `configure` permission ("Manage roles and role permissions",
 * `identity_access` module.ts + `sql/005`), NOT distinct create/update/delete
 * permission keys. Those finer keys are not in the permission catalog and
 * cannot be added without a migration (out of scope for this slice), so
 * guarding on them would default-deny every actor — including the owner, who is
 * granted every catalogued permission. `configure` is a HIGH_RISK_ACTION, so
 * the audit posture is unchanged.
 *
 * Every function assumes it runs INSIDE `withTenant` (RLS FORCE is the real
 * tenant boundary) and after the ABAC guard has passed; each still filters
 * `tenant_id` explicitly (defense in depth) and scopes soft-delete reads to
 * `deleted_at IS NULL`.
 */
import { recordAuditEvent } from "../../logging/application/audit-log";

const AUDIT_MODULE_KEY = "identity_access";
const AUDIT_RESOURCE_TYPE_ROLE = "role";
const AUDIT_RESOURCE_TYPE_PERMISSION = "role_permission";

const POSTGRES_UNIQUE_VIOLATION = "23505";
const POSTGRES_FK_VIOLATION = "23503";

/**
 * `role_code` is unique per tenant among LIVE roles
 * (`awcms_roles_tenant_code_key`, partial `WHERE deleted_at IS NULL`,
 * sql/005:45). A collision is caller-actionable — pick another code — so it
 * surfaces as 409, not an unhandled `PostgresError` (500).
 */
export class DuplicateRoleCodeError extends Error {
  constructor(roleCode: string) {
    super(`A role with code "${roleCode}" already exists for this tenant.`);
    this.name = "DuplicateRoleCodeError";
  }
}

/**
 * The `(tenant_id, role_id, permission_id)` grant already exists
 * (`awcms_role_permissions_key`, sql/005:64). Idempotent from the caller's
 * point of view but reported as 409 so the UI can tell "already granted" apart
 * from success.
 */
export class DuplicateRolePermissionError extends Error {
  constructor() {
    super("That permission is already granted to this role.");
    this.name = "DuplicateRolePermissionError";
  }
}

/** `permission_id` does not reference a row in the global permission catalog. */
export class PermissionNotFoundError extends Error {
  constructor() {
    super("permissionId does not reference a known permission.");
    this.name = "PermissionNotFoundError";
  }
}

export type RoleAdminRecord = {
  id: string;
  roleCode: string;
  roleName: string;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type RoleRow = {
  id: string;
  role_code: string;
  role_name: string;
  is_system: boolean;
  created_at: Date;
  updated_at: Date;
};

function toRecord(row: RoleRow): RoleAdminRecord {
  return {
    id: row.id,
    roleCode: row.role_code,
    roleName: row.role_name,
    isSystem: row.is_system,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function fetchLiveRoleById(
  tx: Bun.SQL,
  tenantId: string,
  roleId: string
): Promise<RoleAdminRecord | null> {
  const rows = (await tx`
    SELECT id, role_code, role_name, is_system, created_at, updated_at
    FROM awcms_roles
    WHERE tenant_id = ${tenantId} AND id = ${roleId} AND deleted_at IS NULL
  `) as RoleRow[];

  return rows[0] ? toRecord(rows[0]) : null;
}

export type DeletedRoleView = {
  id: string;
  roleCode: string;
  roleName: string;
  isSystem: boolean;
};

/**
 * The tenant's soft-deleted roles (restore targets for the admin screen).
 * Bounded/low-cardinality config list, so no cursor.
 */
export async function listDeletedRoles(
  tx: Bun.SQL,
  tenantId: string
): Promise<DeletedRoleView[]> {
  const rows = (await tx`
    SELECT id, role_code, role_name, is_system
    FROM awcms_roles
    WHERE tenant_id = ${tenantId} AND deleted_at IS NOT NULL
    ORDER BY role_code
    LIMIT 100
  `) as Array<{
    id: string;
    role_code: string;
    role_name: string;
    is_system: boolean;
  }>;

  return rows.map((row) => ({
    id: row.id,
    roleCode: row.role_code,
    roleName: row.role_name,
    isSystem: row.is_system
  }));
}

// --- Permission catalog + role-permission reads (for the manage-permissions UI) ---

export type PermissionCatalogEntry = {
  id: string;
  moduleKey: string;
  activityCode: string;
  action: string;
  description: string | null;
};

type PermissionRow = {
  id: string;
  module_key: string;
  activity_code: string;
  action: string;
  description: string | null;
};

/**
 * The whole global permission catalog (`awcms_permissions` has no `tenant_id`;
 * it is platform-wide reference data). Bounded and low-cardinality, so no
 * cursor. Used to render the "add permission" picker.
 */
export async function listPermissionCatalog(
  tx: Bun.SQL
): Promise<PermissionCatalogEntry[]> {
  const rows = (await tx`
    SELECT id, module_key, activity_code, action, description
    FROM awcms_permissions
    ORDER BY module_key, activity_code, action
  `) as PermissionRow[];

  return rows.map((row) => ({
    id: row.id,
    moduleKey: row.module_key,
    activityCode: row.activity_code,
    action: row.action,
    description: row.description
  }));
}

/** The permissions currently granted to `roleId`, joined to the catalog. */
export async function listRolePermissions(
  tx: Bun.SQL,
  tenantId: string,
  roleId: string
): Promise<PermissionCatalogEntry[]> {
  const rows = (await tx`
    SELECT p.id, p.module_key, p.activity_code, p.action, p.description
    FROM awcms_role_permissions rp
    JOIN awcms_permissions p ON p.id = rp.permission_id
    WHERE rp.tenant_id = ${tenantId} AND rp.role_id = ${roleId}
    ORDER BY p.module_key, p.activity_code, p.action
  `) as PermissionRow[];

  return rows.map((row) => ({
    id: row.id,
    moduleKey: row.module_key,
    activityCode: row.activity_code,
    action: row.action,
    description: row.description
  }));
}

// --- Writes ---

/** @throws {DuplicateRoleCodeError} `roleCode` is already taken by a live role. */
export async function createRole(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  input: { roleCode: string; roleName: string },
  correlationId?: string
): Promise<RoleAdminRecord> {
  let rows: RoleRow[];

  try {
    rows = (await tx`
      INSERT INTO awcms_roles (tenant_id, role_code, role_name, is_system)
      VALUES (${tenantId}, ${input.roleCode}, ${input.roleName}, false)
      RETURNING id, role_code, role_name, is_system, created_at, updated_at
    `) as RoleRow[];
  } catch (error) {
    if (
      error instanceof Bun.SQL.PostgresError &&
      String(error.errno) === POSTGRES_UNIQUE_VIOLATION
    ) {
      throw new DuplicateRoleCodeError(input.roleCode);
    }
    throw error;
  }

  const record = toRecord(rows[0]!);

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId,
    moduleKey: AUDIT_MODULE_KEY,
    action: "create",
    resourceType: AUDIT_RESOURCE_TYPE_ROLE,
    resourceId: record.id,
    severity: "warning",
    message: `Role created: ${record.roleCode}.`,
    correlationId
  });

  return record;
}

/** Edits `role_name` only. Returns `null` when the role does not exist / is deleted. */
export async function updateRole(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  roleId: string,
  input: { roleName: string },
  correlationId?: string
): Promise<RoleAdminRecord | null> {
  const rows = (await tx`
    UPDATE awcms_roles
    SET role_name = ${input.roleName}, updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${roleId} AND deleted_at IS NULL
    RETURNING id, role_code, role_name, is_system, created_at, updated_at
  `) as RoleRow[];

  if (rows.length === 0) return null;

  const record = toRecord(rows[0]!);

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId,
    moduleKey: AUDIT_MODULE_KEY,
    action: "update",
    resourceType: AUDIT_RESOURCE_TYPE_ROLE,
    resourceId: record.id,
    severity: "warning",
    message: `Role updated: ${record.roleCode}.`,
    correlationId
  });

  return record;
}

export type SoftDeleteRoleResult =
  | { outcome: "deleted"; role: RoleAdminRecord }
  | { outcome: "not_found" }
  | { outcome: "system_blocked" };

/**
 * Soft-deletes a role. `is_system` roles (e.g. the seeded `owner`) are BLOCKED:
 * deleting them would strip the tenant's only administrator of their grants.
 * The block is checked before the UPDATE — the caller maps it to 409.
 */
export async function softDeleteRole(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  roleId: string,
  reason: string | null,
  correlationId?: string
): Promise<SoftDeleteRoleResult> {
  const existing = await fetchLiveRoleById(tx, tenantId, roleId);
  if (!existing) return { outcome: "not_found" };
  if (existing.isSystem) return { outcome: "system_blocked" };

  const rows = (await tx`
    UPDATE awcms_roles
    SET deleted_at = now(), deleted_by = ${actorTenantUserId},
        delete_reason = ${reason}, updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${roleId} AND deleted_at IS NULL
    RETURNING id, role_code, role_name, is_system, created_at, updated_at
  `) as RoleRow[];

  if (rows.length === 0) return { outcome: "not_found" };

  const record = toRecord(rows[0]!);

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId,
    moduleKey: AUDIT_MODULE_KEY,
    action: "delete",
    resourceType: AUDIT_RESOURCE_TYPE_ROLE,
    resourceId: record.id,
    severity: "warning",
    message: `Role soft-deleted: ${record.roleCode}.`,
    attributes: reason ? { reason } : undefined,
    correlationId
  });

  return { outcome: "deleted", role: record };
}

/**
 * Restores a soft-deleted role. Returns `null` when the role is not currently
 * soft-deleted (absent or already live) — the same 404-on-retry posture as the
 * email-template restore. `delete_reason` is kept for history.
 *
 * @throws {DuplicateRoleCodeError} its `role_code` was re-used by a live role
 *   while it was deleted (the partial unique index fires on restore).
 */
export async function restoreRole(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  roleId: string,
  correlationId?: string
): Promise<RoleAdminRecord | null> {
  let rows: RoleRow[];

  try {
    rows = (await tx`
      UPDATE awcms_roles
      SET deleted_at = NULL, deleted_by = NULL,
          restored_at = now(), restored_by = ${actorTenantUserId},
          updated_at = now()
      WHERE tenant_id = ${tenantId} AND id = ${roleId} AND deleted_at IS NOT NULL
      RETURNING id, role_code, role_name, is_system, created_at, updated_at
    `) as RoleRow[];
  } catch (error) {
    if (
      error instanceof Bun.SQL.PostgresError &&
      String(error.errno) === POSTGRES_UNIQUE_VIOLATION
    ) {
      // Read the (still-deleted) role_code for the error message.
      const conflict = (await tx`
        SELECT role_code FROM awcms_roles
        WHERE tenant_id = ${tenantId} AND id = ${roleId}
      `) as { role_code: string }[];
      throw new DuplicateRoleCodeError(conflict[0]?.role_code ?? "unknown");
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
    resourceType: AUDIT_RESOURCE_TYPE_ROLE,
    resourceId: record.id,
    severity: "warning",
    message: `Role restored: ${record.roleCode}.`,
    correlationId
  });

  return record;
}

export type GrantResult =
  | { outcome: "granted" }
  | { outcome: "role_not_found" }
  | { outcome: "system_blocked" };

/**
 * Grants a catalogued permission to a live role.
 *
 * `is_system` roles (e.g. the seeded `owner`) are BLOCKED: their permission set
 * is an immutable invariant seeded at bootstrap. Allowing mutation via the API
 * would let a delegated `configure` holder alter the tenant's root role — the
 * same foot-gun `softDeleteRole` already blocks. The caller maps it to 409.
 *
 * @throws {DuplicateRolePermissionError} the grant already exists (23505).
 * @throws {PermissionNotFoundError} `permissionId` is not in the catalog (the
 *   `permission_id` FK, 23503).
 */
export async function grantPermissionToRole(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  roleId: string,
  permissionId: string,
  correlationId?: string
): Promise<GrantResult> {
  const role = await fetchLiveRoleById(tx, tenantId, roleId);
  if (!role) return { outcome: "role_not_found" };
  if (role.isSystem) return { outcome: "system_blocked" };

  try {
    await tx`
      INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
      VALUES (${tenantId}, ${roleId}, ${permissionId})
    `;
  } catch (error) {
    if (error instanceof Bun.SQL.PostgresError) {
      if (String(error.errno) === POSTGRES_UNIQUE_VIOLATION) {
        throw new DuplicateRolePermissionError();
      }
      if (String(error.errno) === POSTGRES_FK_VIOLATION) {
        throw new PermissionNotFoundError();
      }
    }
    throw error;
  }

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId,
    moduleKey: AUDIT_MODULE_KEY,
    action: "assign",
    resourceType: AUDIT_RESOURCE_TYPE_PERMISSION,
    resourceId: roleId,
    severity: "warning",
    message: `Permission granted to role ${role.roleCode}.`,
    attributes: { permissionId },
    correlationId
  });

  return { outcome: "granted" };
}

export type RevokeResult =
  | { outcome: "revoked" }
  | { outcome: "role_not_found" }
  | { outcome: "system_blocked" }
  | { outcome: "grant_not_found" };

/**
 * Revokes a permission from a live role. `is_system` roles are BLOCKED — see
 * {@link grantPermissionToRole}: stripping `access_control.*` from the seeded
 * `owner` role would lock the tenant out of its own administration. The caller
 * maps it to 409.
 */
export async function revokePermissionFromRole(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  roleId: string,
  permissionId: string,
  correlationId?: string
): Promise<RevokeResult> {
  const role = await fetchLiveRoleById(tx, tenantId, roleId);
  if (!role) return { outcome: "role_not_found" };
  if (role.isSystem) return { outcome: "system_blocked" };

  const rows = (await tx`
    DELETE FROM awcms_role_permissions
    WHERE tenant_id = ${tenantId} AND role_id = ${roleId}
      AND permission_id = ${permissionId}
    RETURNING id
  `) as { id: string }[];

  if (rows.length === 0) return { outcome: "grant_not_found" };

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId,
    moduleKey: AUDIT_MODULE_KEY,
    action: "revoke",
    resourceType: AUDIT_RESOURCE_TYPE_PERMISSION,
    resourceId: roleId,
    severity: "warning",
    message: `Permission revoked from role ${role.roleCode}.`,
    attributes: { permissionId },
    correlationId
  });

  return { outcome: "revoked" };
}
