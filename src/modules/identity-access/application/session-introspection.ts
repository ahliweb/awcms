/**
 * Session introspection for a cross-origin BFF (ADR-0045 §3, ADR-0049 §7).
 *
 * The BFF holds a user's `awcms` session token server-side and needs to answer
 * "is this still valid, and who is it?" to render a portal header. What it must
 * NOT receive is the rest of the identity: this projection is an allow-list, not
 * a row.
 */
import { activeRoleGrants } from "./grant-source";
import { sessionCredentialCurrent } from "./session-credential-epoch";

export type SessionIntrospection = {
  identityId: string;
  tenantId: string;
  displayName: string;
  roles: string[];
  assuranceLevel: string;
  expiresAt: Date;
  scopes: { scopeType: string; scopeId: string }[];
};

/**
 * Returns the safe claims for an ACTIVE session, or `null` for every other
 * case — unknown token, expired, revoked, identity deactivated, tenant
 * membership gone. One `null` for all of them: a caller must not be able to use
 * this endpoint to learn WHY, which would make it an oracle over session state.
 */
export async function introspectSession(
  tx: Bun.SQL,
  tenantId: string,
  tokenHash: string,
  now: Date
): Promise<SessionIntrospection | null> {
  const sessionRows = (await tx`
    SELECT s.identity_id, s.expires_at, s.revoked_at, s.assurance_level,
           i.status AS identity_status, p.display_name
    FROM awcms_sessions s
    JOIN awcms_identities i
      ON i.tenant_id = s.tenant_id AND i.id = s.identity_id
    JOIN awcms_profiles p
      ON p.tenant_id = i.tenant_id AND p.id = i.profile_id
    WHERE s.tenant_id = ${tenantId} AND s.token_hash = ${tokenHash}
      AND ${sessionCredentialCurrent(tx)}
  `) as {
    identity_id: string;
    expires_at: Date;
    revoked_at: Date | null;
    assurance_level: string;
    identity_status: string;
    display_name: string;
  }[];

  const session = sessionRows[0];

  if (!session) return null;
  if (session.revoked_at) return null;
  if (new Date(session.expires_at).getTime() <= now.getTime()) return null;
  // A session that outlived its identity's activation is not a live session.
  // Deactivating a user must take effect here, not only at the next login.
  if (session.identity_status !== "active") return null;

  const tenantUserRows = (await tx`
    SELECT id FROM awcms_tenant_users
    WHERE tenant_id = ${tenantId} AND identity_id = ${session.identity_id}
  `) as { id: string }[];

  const tenantUser = tenantUserRows[0];

  if (!tenantUser) return null;

  const roleRows = (await tx`
    SELECT DISTINCT r.role_code
    FROM (${activeRoleGrants(tx, tenantId)}) g
    JOIN awcms_roles r ON r.id = g.role_id AND r.tenant_id = ${tenantId}
    WHERE g.tenant_user_id = ${tenantUser.id}
      AND r.deleted_at IS NULL
    ORDER BY r.role_code
  `) as { role_code: string }[];

  // Effective-dated, exactly as the business-scope layer evaluates them — an
  // expired or revoked scope must disappear from the portal header at the same
  // instant it stops granting anything.
  const scopeRows = (await tx`
    SELECT scope_type, scope_id
    FROM awcms_business_scope_assignments
    WHERE tenant_id = ${tenantId} AND tenant_user_id = ${tenantUser.id}
      AND status = 'active'
      AND effective_from <= ${now}
      AND (effective_to IS NULL OR effective_to > ${now})
    ORDER BY scope_type, scope_id
  `) as { scope_type: string; scope_id: string }[];

  return {
    identityId: session.identity_id,
    tenantId,
    displayName: session.display_name,
    roles: roleRows.map((row) => row.role_code),
    assuranceLevel: session.assurance_level,
    expiresAt: session.expires_at,
    scopes: scopeRows.map((row) => ({
      scopeType: row.scope_type,
      scopeId: row.scope_id
    }))
  };
}
