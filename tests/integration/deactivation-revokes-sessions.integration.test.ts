/**
 * Deactivating a tenant user must end their access NOW, not "in up to a session
 * lifetime" (against a real PostgreSQL).
 *
 * The gap this pins was real and invisible: `setTenantUserStatus` wrote
 * `status = 'inactive'` and its own doc comment claimed that "revokes all of a
 * user's access", but the guard chain never reads that column —
 * `resolveTenantContext` looks up a session and a tenant-user ROW, not its
 * status. So a deactivated user kept working normally until their session
 * happened to expire, and the only way to notice was to try.
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
import { authorizeInTransaction } from "../../src/modules/identity-access/application/access-guard";
import { setTenantUserStatus } from "../../src/modules/identity-access/application/user-admin";
import { issueMachineCredential } from "../../src/modules/identity-access/application/machine-credential-directory";
import { resetPolicyCache } from "../../src/modules/identity-access/application/policy-cache";

const TENANT = "c3333333-3333-4333-8333-333333333333";
const ADMIN_USER = "c3000000-0000-4000-8000-000000000001";
const TARGET_USER = "c3000000-0000-4000-8000-000000000002";
const ADMIN_ROLE = "c3000000-0000-4000-8000-0000000000a1";
const TARGET_ROLE = "c3000000-0000-4000-8000-0000000000a2";

const TARGET_SESSION = "target-session-token";

const GUARD = {
  moduleKey: "blog_content",
  activityCode: "posts",
  action: "read"
} as const;

let targetIdentity = "";

async function seedFixtures(): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${TENANT}, 'deact-tenant', 'Deactivation Tenant')
  `;

  for (const user of [
    { id: ADMIN_USER, label: "admin" },
    { id: TARGET_USER, label: "target" }
  ]) {
    const profile = (await admin`
      INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
      VALUES (${TENANT}, 'person', ${`Display ${user.label}`})
      RETURNING id
    `) as { id: string }[];
    const identity = (await admin`
      INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
      VALUES (${TENANT}, ${profile[0]!.id}, ${`${user.label}@example.test`}, 'x')
      RETURNING id
    `) as { id: string }[];
    await admin`
      INSERT INTO awcms_tenant_users (id, tenant_id, identity_id)
      VALUES (${user.id}, ${TENANT}, ${identity[0]!.id})
    `;

    if (user.id === TARGET_USER) targetIdentity = identity[0]!.id;
  }

  // The admin holds the system role so the last-admin guard never fires on the
  // target; the target holds an ordinary role carrying the read permission.
  await admin`
    INSERT INTO awcms_roles (id, tenant_id, role_code, role_name, is_system)
    VALUES (${ADMIN_ROLE}, ${TENANT}, 'owner', 'Owner', true),
           (${TARGET_ROLE}, ${TENANT}, 'editor', 'Editor', false)
  `;

  const permission = (await admin`
    SELECT id FROM awcms_permissions
    WHERE module_key = 'blog_content' AND activity_code = 'posts' AND action = 'read'
  `) as { id: string }[];

  await admin`
    INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
    VALUES (${TENANT}, ${TARGET_ROLE}, ${permission[0]!.id})
  `;

  await admin`
    INSERT INTO awcms_access_policies
      (tenant_id, tenant_user_id, role_id, scope_type, scope_id, granted_by_tenant_user_id)
    VALUES (${TENANT}, ${ADMIN_USER}, ${ADMIN_ROLE}, 'tenant', ${TENANT}, ${ADMIN_USER}),
           (${TENANT}, ${TARGET_USER}, ${TARGET_ROLE}, 'tenant', ${TENANT}, ${ADMIN_USER})
  `;

  await admin`
    INSERT INTO awcms_sessions (tenant_id, identity_id, token_hash, expires_at)
    VALUES (${TENANT}, ${targetIdentity}, ${hashSessionToken(TARGET_SESSION)}, now() + interval '8 hours')
  `;
}

async function authorizeAs(token: string): Promise<boolean> {
  const result = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
    authorizeInTransaction(
      tx,
      TENANT,
      hashSessionToken(token),
      new Date(),
      GUARD
    )
  );

  return result.allowed;
}

async function deactivateTarget(): Promise<string> {
  const result = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
    setTenantUserStatus(tx, TENANT, ADMIN_USER, TARGET_USER, "inactive")
  );

  return result.outcome;
}

const suite = integrationEnabled ? describe : describe.skip;

suite("deactivation revokes live access", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    resetPolicyCache();
    await seedFixtures();
  });

  test("a live session stops working the moment the user is deactivated", async () => {
    expect(await authorizeAs(TARGET_SESSION)).toBe(true);

    expect(await deactivateTarget()).toBe("updated");

    expect(await authorizeAs(TARGET_SESSION)).toBe(false);
  });

  test("the session row is actually revoked, not merely refused", async () => {
    await deactivateTarget();

    const rows = (await getAdminSql()`
      SELECT revoked_at FROM awcms_sessions
      WHERE tenant_id = ${TENANT} AND identity_id = ${targetIdentity}
    `) as { revoked_at: Date | null }[];

    // Refusing at the guard would be enough for THIS test to pass while leaving
    // a live row behind for any other reader of the table; the revocation has
    // to be a fact in the data.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.revoked_at).not.toBeNull();
  });

  test("machine credentials of the deactivated user stop resolving too", async () => {
    const issued = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      issueMachineCredential(
        tx,
        TENANT,
        ADMIN_USER,
        {
          name: "target feed",
          tenantUserId: TARGET_USER,
          allowedPermissionKeys: ["blog_content.posts.read"],
          allowedWriteActions: [],
          allowedIpCidrs: [],
          expiresAt: new Date(Date.now() + 60 * 60 * 1000)
        },
        new Date()
      )
    );

    if (issued.outcome !== "issued") throw new Error("issuance failed");

    expect(await authorizeAs(issued.token)).toBe(true);

    await deactivateTarget();

    expect(await authorizeAs(issued.token)).toBe(false);
  });

  test("reactivating does NOT resurrect the revoked session", async () => {
    await deactivateTarget();

    await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      setTenantUserStatus(tx, TENANT, ADMIN_USER, TARGET_USER, "active")
    );

    // The user may sign in again; the token that was live at deactivation must
    // stay dead. Anything else would mean a compromised session survives a
    // deactivate/reactivate cycle, which is exactly the sequence an operator
    // reaches for when they suspect one.
    expect(await authorizeAs(TARGET_SESSION)).toBe(false);
  });

  test("an unrelated user's session is untouched", async () => {
    const adminSession = "admin-session-token";
    await getAdminSql()`
      INSERT INTO awcms_sessions (tenant_id, identity_id, token_hash, expires_at)
      SELECT ${TENANT}, identity_id, ${hashSessionToken(adminSession)}, now() + interval '8 hours'
      FROM awcms_tenant_users WHERE id = ${ADMIN_USER}
    `;

    await deactivateTarget();

    const rows = (await getAdminSql()`
      SELECT revoked_at FROM awcms_sessions
      WHERE tenant_id = ${TENANT} AND token_hash = ${hashSessionToken(adminSession)}
    `) as { revoked_at: Date | null }[];

    expect(rows[0]?.revoked_at).toBeNull();
  });

  test("a machine credential for a DIFFERENT user keeps working", async () => {
    const issued = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      issueMachineCredential(
        tx,
        TENANT,
        ADMIN_USER,
        {
          name: "admin feed",
          tenantUserId: ADMIN_USER,
          allowedPermissionKeys: ["blog_content.posts.read"],
          allowedWriteActions: [],
          allowedIpCidrs: [],
          expiresAt: new Date(Date.now() + 60 * 60 * 1000)
        },
        new Date()
      )
    );

    if (issued.outcome !== "issued") throw new Error("issuance failed");

    await deactivateTarget();

    // Sanity that the sweep is scoped to the deactivated identity — a
    // revocation that took out everything would also pass every test above.
    const stillWorks = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      authorizeInTransaction(
        tx,
        TENANT,
        hashSessionToken(issued.token),
        new Date(),
        {
          moduleKey: "identity_access",
          activityCode: "access_control",
          action: "read"
        }
      )
    );

    // The admin's credential is narrowed to blog read, so access_control is
    // denied — but with 403 (authenticated, not permitted), never 401.
    expect(stillWorks.allowed).toBe(false);
    if (!stillWorks.allowed) expect(stillWorks.denied.status).toBe(403);
  });
});
