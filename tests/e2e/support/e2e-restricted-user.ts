/**
 * Seed a tenant user whose role holds either NOTHING or every read.
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
 * ## Two grants, two mechanical rules
 *
 * `none` gives an EMPTY role — not "read-only", nothing at all — so every
 * permission-gated screen owes the same answer and one rule covers all of them:
 * the denial renders and the contents do not.
 *
 * `read` gives every tenant-scoped read, a real minimum-privilege operator.
 * NOTHING USES IT YET: the spec written against it proved flaky for a reason
 * that is not its own — `admin-modules-toggle.e2e.ts` deliberately DISABLES the
 * `reporting` module, and `/admin` authorizes on `reporting.dashboard.read`, so
 * a read-only sweep overlapping that toggle sees the dashboard correctly deny.
 * The fixture is kept because the interference is a harness problem worth
 * solving properly (read sweeps must not overlap global-state mutators), not a
 * reason to throw the grant away.
 *
 * What neither covers is which individual WRITE controls a partially-
 * permissioned user should see. Those expectations differ per screen, so they
 * are per-screen knowledge rather than one rule — stated here so the gap is
 * visible rather than assumed closed.
 */
import { hashPassword } from "../../../src/lib/auth/password";
import { linkIdentityToPrincipal } from "../../../src/modules/identity-access/application/principal-store";

export type RestrictedUser = {
  loginIdentifier: string;
  password: string;
  tenantUserId: string;
};

/**
 * What the seeded role holds.
 *
 * `none` — the deny-path fixture. Every gated screen owes this user the same
 * answer, so one mechanical rule covers all of them.
 *
 * `read` — every TENANT-scoped permission whose action is `read`, and nothing
 * else. This is a real read-only operator, and it is derived from the
 * permission catalogue rather than extracted from each page's `authorize`
 * block. That matters: 10 of the 47 screens declare an ARRAY of authorize
 * triples rather than one, so a source extractor would have quietly
 * under-granted for those and then blamed the screens for denying.
 */
export type RestrictedGrant = "none" | "read";

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
  grant: RestrictedGrant = "none",
  loginIdentifier = grant === "read"
    ? "e2e-readonly@example.com"
    : "e2e-restricted@example.com",
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
        VALUES (
          ${tenantId},
          ${grant === "read" ? "e2e_readonly" : "e2e_restricted"},
          ${grant === "read" ? "E2E Read Only" : "E2E Restricted"},
          false
        )
        RETURNING id
      `) as { id: string }[];

      if (grant === "read") {
        // Every TENANT-scoped read, and nothing else. The `scope` filter is the
        // same one the owner bootstrap uses and for the same reason (ADR-0053):
        // without it a future PLATFORM permission would be handed to an
        // ordinary tenant role the moment it is declared.
        await tx`
          INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
          SELECT ${tenantId}, ${role[0]!.id}, id FROM awcms_permissions
          WHERE scope = 'tenant' AND action = 'read'
        `;
      }

      // ADR-0078 — the grant lands in `awcms_access_policies`, tenant-wide,
      // exactly as the owner's does. Same shape; the permission set is whatever
      // `grant` decided above.
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
