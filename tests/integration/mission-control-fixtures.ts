/**
 * Shared Postgres fixtures for the Mission Control integration suites
 * (ahliweb/omes#265 scene, #266 replay): tenants, tenant users with a real
 * session, and a role granted exact permissions through the REAL writer.
 */
import { expect } from "bun:test";

import { getAdminSql, getRuntimeSql } from "./harness";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { hashSessionToken } from "../../src/lib/auth/session-token";
import { grantRolePolicy } from "../../src/modules/identity-access/application/access-policy-writer";

/** Every source's read guard, i.e. what a fully-privileged viewer holds. */
export const ALL_READ_GUARDS: Array<[string, string, string]> = [
  ["omes_control", "servers", "read"],
  ["omes_control", "deployments", "read"],
  ["omes_control", "jobs", "read"],
  ["omes_control", "backups", "read"],
  ["omes_control", "hermes_orchestration", "read"],
  ["omes_control", "architecture", "read"],
  ["omes_control", "ai_privacy", "read"],
  ["workflow", "approval", "read"]
];

export async function seedTenant(id: string, code: string): Promise<void> {
  await getAdminSql()`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${id}, ${code}, ${code})
  `;
}

export async function seedTenantUser(
  tenantId: string,
  id: string,
  label: string,
  sessionToken: string | null
): Promise<void> {
  const admin = getAdminSql();

  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${`Display ${label}`})
    RETURNING id
  `) as { id: string }[];

  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${`${label}@example.test`}, 'x')
    RETURNING id
  `) as { id: string }[];

  await admin`
    INSERT INTO awcms_tenant_users (id, tenant_id, identity_id)
    VALUES (${id}, ${tenantId}, ${identity[0]!.id})
  `;

  if (sessionToken) {
    await admin`
      INSERT INTO awcms_sessions (tenant_id, identity_id, token_hash, expires_at)
      VALUES (${tenantId}, ${identity[0]!.id}, ${hashSessionToken(sessionToken)}, now() + interval '8 hours')
    `;
  }
}

/** Creates a role, assigns it to the user through the REAL writer, then grants the listed permissions. */
export async function grantRole(
  tenantId: string,
  roleId: string,
  roleCode: string,
  userId: string,
  permissions: Array<[string, string, string]>
): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_roles (id, tenant_id, role_code, role_name, is_system)
    VALUES (${roleId}, ${tenantId}, ${roleCode}, ${roleCode}, false)
  `;
  await withTenantOrThrow(getRuntimeSql(), tenantId, (tx) =>
    grantRolePolicy(tx, tenantId, {
      tenantUserId: userId,
      roleId,
      grantedByTenantUserId: null
    })
  );

  for (const [moduleKey, activityCode, action] of permissions) {
    const permission = (await admin`
      SELECT id FROM awcms_permissions
      WHERE module_key = ${moduleKey} AND activity_code = ${activityCode} AND action = ${action}
    `) as { id: string }[];
    expect(permission).toHaveLength(1);
    await admin`
      INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
      VALUES (${tenantId}, ${roleId}, ${permission[0]!.id})
      ON CONFLICT DO NOTHING
    `;
  }
}
