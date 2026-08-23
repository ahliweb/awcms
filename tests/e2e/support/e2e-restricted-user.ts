/**
 * Seed a tenant user holding a role with ZERO permissions.
 *
 * ## Why this is seeded rather than invited
 *
 * The product path for a second user is an invitation, and its token is stored
 * hashed and delivered by email — a test cannot read it back. So the row is
 * written directly, but through the SAME primitives the owner bootstrap uses
 * (`hashPassword`, `linkIdentityToPrincipal`, the same tables in the same
 * order). A user assembled by hand with a different password hash, or with no
 * principal link, would be testing a shape the login path never produces.
 *
 * `linkIdentityToPrincipal` matters specifically: ADR-0086 moved the lockout
 * counter onto the principal, and an identity with no principal counts no
 * failed logins. Every identity writer links, so this one does too.
 *
 * ## The role holds nothing, deliberately
 *
 * Not "read-only" — empty. Every permission-gated admin screen then owes this
 * user the same answer, so a single mechanical rule covers all 47: the denial
 * renders and the contents do not. A partially-permissioned user is a more
 * realistic operator and a much larger question, because the expected result
 * differs per screen; that belongs in its own round.
 */
import { hashPassword } from "../../../src/lib/auth/password";
import { linkIdentityToPrincipal } from "../../../src/modules/identity-access/application/principal-store";

export type RestrictedUser = {
  loginIdentifier: string;
  password: string;
  tenantUserId: string;
};

/**
 * Create (or return, if it already exists) the restricted user for `tenantId`.
 *
 * Idempotent on `login_identifier` so a re-run against a database that already
 * has one does not fail on the unique constraint — a local run of this suite
 * twice is normal.
 */
export async function seedRestrictedUser(
  databaseUrl: string,
  tenantId: string,
  loginIdentifier = "e2e-restricted@example.com",
  password = "E2eRestricted!Passw0rd"
): Promise<RestrictedUser> {
  const sql = new Bun.SQL(databaseUrl, { max: 1 });

  try {
    return await sql.begin(async (tx: Bun.SQL) => {
      await tx.unsafe(`SET LOCAL app.current_tenant_id = '${tenantId}'`);

      const existing = (await tx`
        SELECT tu.id
        FROM awcms_tenant_users tu
        JOIN awcms_identities i ON i.id = tu.identity_id
        WHERE tu.tenant_id = ${tenantId}
          AND i.login_identifier = ${loginIdentifier}
        LIMIT 1
      `) as { id: string }[];

      if (existing[0]) {
        return {
          loginIdentifier,
          password,
          tenantUserId: existing[0].id
        };
      }

      const profile = (await tx`
        INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
        VALUES (${tenantId}, 'person', 'E2E Restricted')
        RETURNING id
      `) as { id: string }[];

      const passwordHash = await hashPassword(password);
      const identity = (await tx`
        INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
        VALUES (${tenantId}, ${profile[0]!.id}, ${loginIdentifier}, ${passwordHash})
        RETURNING id
      `) as { id: string }[];

      // ADR-0086 — the lockout counter lives on the principal; an identity with
      // no principal counts no failed logins. Every identity writer links.
      await linkIdentityToPrincipal(tx, identity[0]!.id, loginIdentifier);

      const tenantUser = (await tx`
        INSERT INTO awcms_tenant_users (tenant_id, identity_id)
        VALUES (${tenantId}, ${identity[0]!.id})
        RETURNING id
      `) as { id: string }[];

      // A real role, with NO rows in `awcms_role_permissions`. Giving the user
      // no role at all would test a different thing — an unassigned user —
      // and would not prove that an assigned role holding nothing denies.
      const role = (await tx`
        INSERT INTO awcms_roles (tenant_id, role_code, role_name, is_system)
        VALUES (${tenantId}, 'e2e_restricted', 'E2E Restricted', false)
        RETURNING id
      `) as { id: string }[];

      // ADR-0078 — the grant lands in `awcms_access_policies`, tenant-wide,
      // exactly as the owner's does. Same shape, empty permission set.
      const policy = (await tx`
        INSERT INTO awcms_access_policies
          (tenant_id, subject_type, tenant_user_id, role_id, scope_type, scope_id,
           granted_by_tenant_user_id, reason)
        VALUES
          (${tenantId}, 'tenant_user', ${tenantUser[0]!.id}, ${role[0]!.id}, 'tenant', ${tenantId},
           ${tenantUser[0]!.id}, 'e2e restricted-user fixture')
        RETURNING id
      `) as { id: string }[];

      await tx`
        INSERT INTO awcms_access_policy_events
          (tenant_id, policy_id, event_type, actor_tenant_user_id, reason)
        VALUES (${tenantId}, ${policy[0]!.id}, 'granted', ${tenantUser[0]!.id}, 'e2e restricted-user fixture')
      `;

      return {
        loginIdentifier,
        password,
        tenantUserId: tenantUser[0]!.id
      };
    });
  } finally {
    await sql.end();
  }
}
