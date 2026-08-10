/**
 * Every reader of "who holds which role" agrees with the writer (ADR-0079,
 * Gelombang 3 PR 3.3 of #423), against a real PostgreSQL.
 *
 * ## Why this suite exists
 *
 * PR 3.2 made `awcms_access_policies` the table a grant is written to. Five
 * readers kept their own `awcms_access_assignments` join, so for every tenant
 * created after that PR they answered about a table nothing writes. Each failure
 * was silent and each was different:
 *
 *   - `GET /api/v1/auth/session` reported the owner as holding NO roles.
 *   - `/admin/users` listed every user with an empty role set.
 *   - ABAC `subject.roles` went empty, which makes a DENY policy INERT — the one
 *     direction that widens access rather than narrowing it.
 *   - SoD stopped seeing ordinary role grants and reported no conflicts.
 *   - The `last_admin_blocked` guard concluded the tenant had no administrator
 *     and permitted deactivating the only owner: a lockout with no in-app
 *     recovery.
 *
 * Thirty-eight gates were green the whole time, `bun run check` passed, and the
 * unit tests passed — because every one of them asserted a reader against
 * itself. What none of them did was write a grant through the real writer and
 * then ASK the readers.
 *
 * That is all this file does. `tests/grant-source-parity.test.ts` pins the same
 * property statically (every reader embeds `activeRoleGrants`); this one pins it
 * behaviourally, which is what would have caught the drift in the first place —
 * a reader can be repointed at any table and still compile.
 *
 * Gated on `DATABASE_URL` (harness §Gating).
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";

import {
  getAdminSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { hashSessionToken } from "../../src/lib/auth/session-token";
import { listTenantUsers } from "../../src/modules/identity-access/application/access-directory";
import { resolveTenantPrincipalForTenantUser } from "../../src/modules/identity-access/application/auth-context";
import { resolveSoDAssignmentFacts } from "../../src/modules/identity-access/application/business-scope-facts";
import { grantRolePolicy } from "../../src/modules/identity-access/application/access-policy-writer";
import { introspectSession } from "../../src/modules/identity-access/application/session-introspection";
import { setTenantUserStatus } from "../../src/modules/identity-access/application/user-admin";
import { resolveBoundedAnnouncementTargets } from "../../src/modules/email/application/announcement-directory";

const TENANT = "d4444444-4444-4444-8444-444444444444";
const OWNER_USER = "d4000000-0000-4000-8000-000000000001";
const SECOND_OWNER = "d4000000-0000-4000-8000-000000000002";
const OWNER_ROLE = "d4000000-0000-4000-8000-0000000000a1";

const OWNER_SESSION = "grant-reader-owner-session";

/** `blog_content.posts.read` — a real catalogue key, so SoD sees a real fact. */
const GRANTED_KEY = "blog_content.posts.read";

let ownerIdentity = "";

async function seedTenantUser(id: string, label: string): Promise<string> {
  const admin = getAdminSql();

  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${TENANT}, 'person', ${`Display ${label}`})
    RETURNING id
  `) as { id: string }[];

  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${TENANT}, ${profile[0]!.id}, ${`${label}@example.test`}, 'x')
    RETURNING id
  `) as { id: string }[];

  await admin`
    INSERT INTO awcms_tenant_users (id, tenant_id, identity_id)
    VALUES (${id}, ${TENANT}, ${identity[0]!.id})
  `;

  return identity[0]!.id;
}

async function seedFixtures(): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${TENANT}, 'grant-reader-tenant', 'Grant Reader Tenant')
  `;

  ownerIdentity = await seedTenantUser(OWNER_USER, "owner");
  await seedTenantUser(SECOND_OWNER, "second");

  await admin`
    INSERT INTO awcms_roles (id, tenant_id, role_code, role_name, is_system)
    VALUES (${OWNER_ROLE}, ${TENANT}, 'owner', 'Owner', true)
  `;

  const permission = (await admin`
    SELECT id FROM awcms_permissions
    WHERE module_key = 'blog_content' AND activity_code = 'posts' AND action = 'read'
  `) as { id: string }[];

  await admin`
    INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
    VALUES (${TENANT}, ${OWNER_ROLE}, ${permission[0]!.id})
  `;

  await admin`
    INSERT INTO awcms_sessions (tenant_id, identity_id, token_hash, expires_at)
    VALUES (${TENANT}, ${ownerIdentity}, ${hashSessionToken(OWNER_SESSION)}, now() + interval '8 hours')
  `;
}

/**
 * Grants through the REAL writer, not through an INSERT.
 *
 * A fixture that wrote the row itself could put it anywhere, including the table
 * the readers happen to read — which is precisely how a suite passes while the
 * product is broken. Going through `grantRolePolicy` means the writer and the
 * readers are being compared, which is the only comparison worth making here.
 */
async function grantOwnerRole(tenantUserId: string): Promise<void> {
  await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
    grantRolePolicy(tx, TENANT, {
      tenantUserId,
      roleId: OWNER_ROLE,
      grantedByTenantUserId: null,
      reason: "grant reader fixture"
    })
  );
}

const suite = integrationEnabled ? describe : describe.skip;

suite("every grant reader sees what the grant writer wrote", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedFixtures();
    await grantOwnerRole(OWNER_USER);
  });

  test("the ABAC subject's roles carry the granted role code", async () => {
    // `TenantContext.roles` is what an ABAC policy's `subject.roles` matches on.
    // Empty roles silently disarm every DENY policy written against a role name.
    const principal = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      resolveTenantPrincipalForTenantUser(tx, TENANT, OWNER_USER)
    );

    expect(principal?.context.roles).toEqual(["owner"]);
  });

  test("session introspection reports the role to the BFF", async () => {
    const introspection = await withTenantOrThrow(
      getRuntimeSql(),
      TENANT,
      (tx) =>
        introspectSession(
          tx,
          TENANT,
          hashSessionToken(OWNER_SESSION),
          new Date()
        )
    );

    expect(introspection?.roles).toEqual(["owner"]);
  });

  test("the admin user list shows who holds the role", async () => {
    const users = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      listTenantUsers(tx, TENANT)
    );

    const owner = users.find((user) => user.id === OWNER_USER);

    expect(owner?.roles).toEqual(["owner"]);
    // And the join must not invent membership for everyone else.
    expect(users.find((user) => user.id === SECOND_OWNER)?.roles).toEqual([]);
  });

  test("SoD sees the ordinary RBAC grant", async () => {
    const facts = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      resolveSoDAssignmentFacts(tx, TENANT, OWNER_USER, new Date())
    );

    const ordinary = facts.filter((fact) => fact.scopeType === null);

    expect(ordinary.map((fact) => fact.permissionKey)).toContain(GRANTED_KEY);
  });

  test("announcement targeting by role resolves the holder", async () => {
    const resolved = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      resolveBoundedAnnouncementTargets(tx, TENANT, {
        type: "role",
        roleId: OWNER_ROLE
      })
    );

    expect(resolved.recipients.map((row) => row.tenantUserId)).toEqual([
      OWNER_USER
    ]);
  });

  test("the last administrator cannot be deactivated", async () => {
    // The failure direction that matters: a guard that cannot see the grant
    // permits the deactivation, and the tenant is left with no administrator and
    // no in-app way back.
    const result = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      setTenantUserStatus(tx, TENANT, SECOND_OWNER, OWNER_USER, "inactive")
    );

    expect(result.outcome).toBe("last_admin_blocked");
  });

  test("a second administrator makes the first deactivatable again", async () => {
    // The other direction, so the guard cannot be satisfied by refusing
    // everything: a check that always blocks passes the test above just as well.
    await grantOwnerRole(SECOND_OWNER);

    const result = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      setTenantUserStatus(tx, TENANT, SECOND_OWNER, OWNER_USER, "inactive")
    );

    expect(result.outcome).toBe("updated");
  });

  test("revoking the grant removes it from every reader at once", async () => {
    // Revocation transitions the policy rather than deleting it, so a reader
    // that filtered `status` incorrectly would keep reporting the role — the
    // shape that fails toward ACCESS RETAINED.
    const runtime = getRuntimeSql();

    await withTenantOrThrow(runtime, TENANT, async (tx) => {
      await tx`
        UPDATE awcms_access_policies
        SET status = 'revoked', revoked_at = now()
        WHERE tenant_id = ${TENANT} AND tenant_user_id = ${OWNER_USER}
      `;
    });

    const [principal, users, facts] = await withTenantOrThrow(
      runtime,
      TENANT,
      async (tx) => [
        await resolveTenantPrincipalForTenantUser(tx, TENANT, OWNER_USER),
        await listTenantUsers(tx, TENANT),
        await resolveSoDAssignmentFacts(tx, TENANT, OWNER_USER, new Date())
      ]
    );

    expect(principal?.context.roles).toEqual([]);
    expect(users.find((user) => user.id === OWNER_USER)?.roles).toEqual([]);
    expect(facts.map((fact) => fact.permissionKey)).not.toContain(GRANTED_KEY);
  });
});
