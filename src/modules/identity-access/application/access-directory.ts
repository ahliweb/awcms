/**
 * Read-only access-management directory (Issue #166, Stage 3b — ported from
 * awcms-mini's access-management reads, adapted to awcms's schema/scope).
 *
 * Three bounded list reads behind the admin RBAC/ABAC screens and their JSON
 * endpoints, all gated on `identity_access.access_control.read` ("Read roles,
 * permissions, and decision logs", seeded in `sql/005`):
 *
 * - `listTenantUsers`  — a tenant's users with their assigned role codes.
 * - `listRoles`        — a tenant's (non-deleted) roles with a permission count.
 * - `listAbacPolicies` — a tenant's ABAC policies.
 *
 * All are `LIMIT`-bounded low-cardinality config lists (same convention as
 * `listEmailTemplates`), so no keyset cursor. Every query is tenant-filtered
 * AND runs inside `withTenant` (RLS FORCE is the real boundary). Callers must
 * be inside a `withTenant` transaction and must have passed the ABAC guard.
 */
import { maskIdentifierValue } from "../../profile-identity/domain/identifier";

const LIST_LIMIT = 100;

export type TenantUserView = {
  id: string;
  /** Masked — `login_identifier` is PII (usually an email). Never returned raw in a list. */
  loginIdentifierMasked: string;
  status: string;
  /** Assigned role codes (empty when the user holds no role). */
  roles: string[];
};

type TenantUserRow = {
  id: string;
  login_identifier: string;
  status: string;
  roles: string[] | null;
};

export async function listTenantUsers(
  tx: Bun.SQL,
  tenantId: string
): Promise<TenantUserView[]> {
  const rows = (await tx`
    SELECT
      tu.id,
      i.login_identifier,
      tu.status,
      COALESCE(
        array_agg(r.role_code) FILTER (WHERE r.id IS NOT NULL),
        '{}'
      ) AS roles
    FROM awcms_tenant_users tu
    JOIN awcms_identities i ON i.id = tu.identity_id
    LEFT JOIN awcms_access_assignments aa ON aa.tenant_user_id = tu.id
    LEFT JOIN awcms_roles r
      ON r.id = aa.role_id AND r.deleted_at IS NULL
    WHERE tu.tenant_id = ${tenantId}
    GROUP BY tu.id, i.login_identifier, tu.status
    ORDER BY i.login_identifier
    LIMIT ${LIST_LIMIT}
  `) as TenantUserRow[];

  return rows.map((row) => ({
    id: row.id,
    loginIdentifierMasked: maskIdentifierValue(row.login_identifier),
    status: row.status,
    roles: row.roles ?? []
  }));
}

export type RoleView = {
  id: string;
  roleCode: string;
  roleName: string;
  isSystem: boolean;
  permissionCount: number;
};

type RoleRow = {
  id: string;
  role_code: string;
  role_name: string;
  is_system: boolean;
  permission_count: number;
};

export async function listRoles(
  tx: Bun.SQL,
  tenantId: string
): Promise<RoleView[]> {
  const rows = (await tx`
    SELECT
      r.id,
      r.role_code,
      r.role_name,
      r.is_system,
      count(rp.id)::int AS permission_count
    FROM awcms_roles r
    LEFT JOIN awcms_role_permissions rp ON rp.role_id = r.id
    WHERE r.tenant_id = ${tenantId} AND r.deleted_at IS NULL
    GROUP BY r.id, r.role_code, r.role_name, r.is_system
    ORDER BY r.role_code
    LIMIT ${LIST_LIMIT}
  `) as RoleRow[];

  return rows.map((row) => ({
    id: row.id,
    roleCode: row.role_code,
    roleName: row.role_name,
    isSystem: row.is_system,
    permissionCount: row.permission_count
  }));
}

export type AbacPolicyView = {
  id: string;
  policyCode: string;
  effect: string;
  description: string | null;
  isActive: boolean;
};

type AbacPolicyRow = {
  id: string;
  policy_code: string;
  effect: string;
  description: string | null;
  is_active: boolean;
};

export async function listAbacPolicies(
  tx: Bun.SQL,
  tenantId: string
): Promise<AbacPolicyView[]> {
  const rows = (await tx`
    SELECT id, policy_code, effect, description, is_active
    FROM awcms_abac_policies
    WHERE tenant_id = ${tenantId}
    ORDER BY policy_code
    LIMIT ${LIST_LIMIT}
  `) as AbacPolicyRow[];

  return rows.map((row) => ({
    id: row.id,
    policyCode: row.policy_code,
    effect: row.effect,
    description: row.description,
    isActive: row.is_active
  }));
}
