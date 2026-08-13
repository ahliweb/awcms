/**
 * Machine credentials + session introspection (ADR-0049, migrations sql/082 +
 * sql/083) against a real PostgreSQL under the WORLD-1 ephemeral-database
 * harness.
 *
 * These prove the claims a typecheck cannot, and each one is a security
 * property rather than a happy path:
 *
 *   1. A credential AUTHENTICATES through the SAME chokepoint as a session —
 *      `authorizeInTransaction` resolves it, and everything downstream (module
 *      enabled, RBAC, ABAC, decision log) runs unchanged.
 *   2. READ-ONLY is enforced BEFORE permissions are consulted: a credential
 *      whose service account is an all-permissions owner still cannot mutate.
 *   3. The allow-list NARROWS — a permission the account holds but the
 *      credential omits is denied, and a permission the credential names but
 *      the account lacks grants nothing.
 *   4. Revocation and expiry take effect on the NEXT request, with the same
 *      401 shape as an unknown token (no oracle).
 *   5. RLS + the tenant-bearing token together make a credential useless
 *      against another tenant.
 *   6. The decision log records WHICH credential acted, not just which account.
 *   7. Introspection returns safe claims only, and refuses a machine credential
 *      with the ordinary 401.
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
  assertRejected,
  getAdminSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { hashSessionToken } from "../../src/lib/auth/session-token";
import {
  generateMachineCredentialToken,
  hashMachineCredentialToken
} from "../../src/lib/auth/machine-credential-token";
import { authorizeInTransaction } from "../../src/modules/identity-access/application/access-guard";
import type { AccessAction } from "../../src/modules/identity-access/domain/access-control";
import {
  issueMachineCredential,
  listMachineCredentials,
  revokeMachineCredential,
  toPostgresTextArray
} from "../../src/modules/identity-access/application/machine-credential-directory";
import { introspectSession } from "../../src/modules/identity-access/application/session-introspection";
import { resetPolicyCache } from "../../src/modules/identity-access/application/policy-cache";

const TENANT_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TENANT_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const SERVICE_USER_A = "c0000000-0000-4000-8000-000000000001";
const HUMAN_USER_A = "c0000000-0000-4000-8000-000000000002";
const SERVICE_USER_B = "d0000000-0000-4000-8000-000000000001";

const ROLE_A = "c0000000-0000-4000-8000-0000000000a1";
const ROLE_B = "d0000000-0000-4000-8000-0000000000b1";

/** What the service account is GRANTED — deliberately wider than any credential. */
const ACCOUNT_PERMISSIONS = [
  { module: "blog_content", activity: "posts", action: "read" },
  { module: "blog_content", activity: "posts", action: "update" },
  { module: "media_library", activity: "media_objects", action: "read" }
];

const READ_GUARD = {
  moduleKey: "blog_content",
  activityCode: "posts",
  action: "read"
} as const;

const UPDATE_GUARD = {
  moduleKey: "blog_content",
  activityCode: "posts",
  action: "update"
} as const;

let humanIdentityA = "";

async function seedFixtures(): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${TENANT_A}, 'mc-tenant-a', 'MC Tenant A'),
           (${TENANT_B}, 'mc-tenant-b', 'MC Tenant B')
  `;

  const users = [
    { id: SERVICE_USER_A, tenant: TENANT_A, label: "svc-a" },
    { id: HUMAN_USER_A, tenant: TENANT_A, label: "human-a" },
    { id: SERVICE_USER_B, tenant: TENANT_B, label: "svc-b" }
  ];

  for (const user of users) {
    const profile = (await admin`
      INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
      VALUES (${user.tenant}, 'person', ${`Display ${user.label}`})
      RETURNING id
    `) as { id: string }[];
    const identity = (await admin`
      INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
      VALUES (${user.tenant}, ${profile[0]!.id}, ${`${user.label}@example.test`}, 'x')
      RETURNING id
    `) as { id: string }[];
    await admin`
      INSERT INTO awcms_tenant_users (id, tenant_id, identity_id)
      VALUES (${user.id}, ${user.tenant}, ${identity[0]!.id})
    `;

    if (user.id === HUMAN_USER_A) humanIdentityA = identity[0]!.id;
  }

  await admin`
    INSERT INTO awcms_roles (id, tenant_id, role_code, role_name)
    VALUES (${ROLE_A}, ${TENANT_A}, 'mc-role-a', 'MC Role A'),
           (${ROLE_B}, ${TENANT_B}, 'mc-role-b', 'MC Role B')
  `;

  for (const permission of ACCOUNT_PERMISSIONS) {
    const rows = (await admin`
      INSERT INTO awcms_permissions (module_key, activity_code, action, description)
      VALUES (${permission.module}, ${permission.activity}, ${permission.action}, 'test')
      ON CONFLICT (module_key, activity_code, action) DO UPDATE SET description = EXCLUDED.description
      RETURNING id
    `) as { id: string }[];

    await admin`
      INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
      VALUES (${TENANT_A}, ${ROLE_A}, ${rows[0]!.id})
    `;
  }

  // Both the service account and the human hold the SAME wide role, so any
  // difference in what they may do comes from the credential, not the grants.
  await admin`
    INSERT INTO awcms_access_policies
      (tenant_id, tenant_user_id, role_id, scope_type, scope_id, granted_by_tenant_user_id)
    VALUES (${TENANT_A}, ${SERVICE_USER_A}, ${ROLE_A}, 'tenant', ${TENANT_A}, ${HUMAN_USER_A}),
           (${TENANT_A}, ${HUMAN_USER_A}, ${ROLE_A}, 'tenant', ${TENANT_A}, ${HUMAN_USER_A})
  `;
}

/** Issues a credential through the real service and returns its plaintext token. */
async function issue(
  allowedPermissionKeys: string[],
  expiresAt = new Date(Date.now() + 60 * 60 * 1000),
  // ADR-0092. Defaulted to the read-only class so every pre-existing caller
  // below keeps issuing exactly what it issued before the write class existed.
  writeClass: {
    allowedWriteActions?: AccessAction[];
    allowedIpCidrs?: string[];
  } = {}
): Promise<{ token: string; id: string }> {
  const runtime = getRuntimeSql();

  const result = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
    issueMachineCredential(
      tx,
      TENANT_A,
      HUMAN_USER_A,
      {
        name: "build feed",
        tenantUserId: SERVICE_USER_A,
        allowedPermissionKeys,
        allowedWriteActions: writeClass.allowedWriteActions ?? [],
        allowedIpCidrs: writeClass.allowedIpCidrs ?? [],
        expiresAt
      },
      new Date()
    )
  );

  if (result.outcome !== "issued") {
    throw new Error(`issuance failed: ${result.outcome}`);
  }

  return { token: result.token, id: result.credential.id };
}

const suite = integrationEnabled ? describe : describe.skip;

suite("machine credentials + session introspection (ADR-0049)", () => {
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

  test("authenticates through the same chokepoint a session uses", async () => {
    const { token } = await issue(["blog_content.posts.read"]);
    const runtime = getRuntimeSql();

    const result = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      authorizeInTransaction(
        tx,
        TENANT_A,
        hashSessionToken(token),
        new Date(),
        READ_GUARD
      )
    );

    expect(result.allowed).toBe(true);
    if (result.allowed) {
      // It acts AS the service account — not as some parallel principal.
      expect(result.context.tenantUserId).toBe(SERVICE_USER_A);
    }
  });

  test("READ-ONLY holds even when the service account is granted the action", async () => {
    // The credential's allow-list even NAMES the update permission, and the
    // account genuinely holds it. The refusal comes from the action class.
    const { token } = await issue([
      "blog_content.posts.read",
      "blog_content.posts.update"
    ]);
    const runtime = getRuntimeSql();

    const machine = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      authorizeInTransaction(
        tx,
        TENANT_A,
        hashSessionToken(token),
        new Date(),
        UPDATE_GUARD
      )
    );

    expect(machine.allowed).toBe(false);
    if (!machine.allowed) expect(machine.denied.status).toBe(403);

    // Control: the SAME permission, through a human session, is allowed — so
    // the deny above is the credential rule and not a broken grant.
    const sessionToken = "human-session-token";
    await getAdminSql()`
      INSERT INTO awcms_sessions (tenant_id, identity_id, token_hash, expires_at)
      VALUES (${TENANT_A}, ${humanIdentityA}, ${hashSessionToken(sessionToken)}, now() + interval '1 hour')
    `;

    const human = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      authorizeInTransaction(
        tx,
        TENANT_A,
        hashSessionToken(sessionToken),
        new Date(),
        UPDATE_GUARD
      )
    );

    expect(human.allowed).toBe(true);
  });

  test("the allow-list narrows: an omitted permission is denied", async () => {
    const { token } = await issue(["media_library.media_objects.read"]);
    const runtime = getRuntimeSql();

    const result = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      authorizeInTransaction(
        tx,
        TENANT_A,
        hashSessionToken(token),
        new Date(),
        READ_GUARD
      )
    );

    expect(result.allowed).toBe(false);
  });

  test("the allow-list cannot widen: naming a permission the account lacks grants nothing", async () => {
    const { token } = await issue(["identity_access.access_control.read"]);
    const runtime = getRuntimeSql();

    const result = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      authorizeInTransaction(
        tx,
        TENANT_A,
        hashSessionToken(token),
        new Date(),
        {
          moduleKey: "identity_access",
          activityCode: "access_control",
          action: "read"
        }
      )
    );

    expect(result.allowed).toBe(false);
  });

  test("revocation takes effect on the next request, with the unknown-token shape", async () => {
    const { token, id } = await issue(["blog_content.posts.read"]);
    const runtime = getRuntimeSql();

    const before = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      authorizeInTransaction(
        tx,
        TENANT_A,
        hashSessionToken(token),
        new Date(),
        READ_GUARD
      )
    );
    expect(before.allowed).toBe(true);

    const revoked = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      revokeMachineCredential(tx, TENANT_A, id, HUMAN_USER_A, new Date())
    );
    expect(revoked.outcome).toBe("revoked");

    const after = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      authorizeInTransaction(
        tx,
        TENANT_A,
        hashSessionToken(token),
        new Date(),
        READ_GUARD
      )
    );

    expect(after.allowed).toBe(false);
    if (!after.allowed) expect(after.denied.status).toBe(401);

    // Re-revoking is reported, not silently absorbed.
    const again = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      revokeMachineCredential(tx, TENANT_A, id, HUMAN_USER_A, new Date())
    );
    expect(again.outcome).toBe("already_revoked");
  });

  // Expiry is proven by moving the CLOCK, not by back-dating the row: the
  // `expires_at > created_at` CHECK deliberately refuses a row that was already
  // expired when it was written, so a test that rewrote the row would be
  // testing a state the database will never hold.
  test("a credential stops working once its expiry passes", async () => {
    const expiresAt = new Date(Date.now() + 60 * 1000);
    const { token } = await issue(["blog_content.posts.read"], expiresAt);
    const runtime = getRuntimeSql();

    const before = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      authorizeInTransaction(
        tx,
        TENANT_A,
        hashSessionToken(token),
        new Date(expiresAt.getTime() - 1000),
        READ_GUARD
      )
    );
    expect(before.allowed).toBe(true);

    const after = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      authorizeInTransaction(
        tx,
        TENANT_A,
        hashSessionToken(token),
        new Date(expiresAt.getTime() + 1000),
        READ_GUARD
      )
    );

    expect(after.allowed).toBe(false);
    if (!after.allowed) expect(after.denied.status).toBe(401);
  });

  test("the database refuses a credential that is born expired", async () => {
    await assertRejected(
      getAdminSql()`
        INSERT INTO awcms_machine_credentials
          (tenant_id, tenant_user_id, name, token_hash, allowed_permission_keys, expires_at, created_by_tenant_user_id)
        VALUES (
          ${TENANT_A}, ${SERVICE_USER_A}, 'born expired',
          ${hashMachineCredentialToken(generateMachineCredentialToken(TENANT_A))},
          ${toPostgresTextArray(["blog_content.posts.read"])}::text[],
          now() - interval '1 minute', ${HUMAN_USER_A}
        )
      `,
      "a credential whose expiry precedes its creation"
    );
  });

  test("a credential is useless against another tenant", async () => {
    const { token } = await issue(["blog_content.posts.read"]);

    // Presenting tenant A's credential while operating in tenant B's context:
    // RLS scopes the lookup, so the row is simply not there.
    const result = await withTenantOrThrow(getRuntimeSql(), TENANT_B, (tx) =>
      authorizeInTransaction(
        tx,
        TENANT_B,
        hashSessionToken(token),
        new Date(),
        READ_GUARD
      )
    );

    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.denied.status).toBe(401);
  });

  test("a session-namespace hash can never resolve a credential", async () => {
    const { token } = await issue(["blog_content.posts.read"]);

    // The same token, hashed WITHOUT the namespace tag: this is what an
    // attacker (or a future refactor) trying to cross the two tables would
    // produce, and it must find nothing.
    const untagged = hashMachineCredentialToken(token).replace(
      "mc-sha256:",
      "sha256:"
    );

    const result = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      authorizeInTransaction(tx, TENANT_A, untagged, new Date(), READ_GUARD)
    );

    expect(result.allowed).toBe(false);
  });

  test("the decision log records WHICH credential acted", async () => {
    const { token, id } = await issue(["blog_content.posts.read"]);

    await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      authorizeInTransaction(
        tx,
        TENANT_A,
        hashSessionToken(token),
        new Date(),
        READ_GUARD
      )
    );

    const rows = (await getAdminSql()`
      SELECT machine_credential_id, tenant_user_id, decision
      FROM awcms_abac_decision_logs
      WHERE tenant_id = ${TENANT_A}
      ORDER BY created_at DESC
      LIMIT 1
    `) as {
      machine_credential_id: string | null;
      tenant_user_id: string;
      decision: string;
    }[];

    expect(rows[0]?.decision).toBe("allow");
    expect(rows[0]?.machine_credential_id).toBe(id);
    expect(rows[0]?.tenant_user_id).toBe(SERVICE_USER_A);
  });

  test("last_used_at becomes visible without a write on every request", async () => {
    const { token, id } = await issue(["blog_content.posts.read"]);
    const admin = getAdminSql();

    const fresh = (await admin`
      SELECT last_used_at FROM awcms_machine_credentials WHERE id = ${id}
    `) as { last_used_at: Date | null }[];
    expect(fresh[0]?.last_used_at).toBeNull();

    await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      authorizeInTransaction(
        tx,
        TENANT_A,
        hashSessionToken(token),
        new Date(),
        READ_GUARD
      )
    );

    const used = (await admin`
      SELECT last_used_at FROM awcms_machine_credentials WHERE id = ${id}
    `) as { last_used_at: Date | null }[];
    expect(used[0]?.last_used_at).not.toBeNull();

    const firstStamp = new Date(used[0]!.last_used_at!).getTime();

    // A second request inside the refresh window must NOT write again.
    await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      authorizeInTransaction(
        tx,
        TENANT_A,
        hashSessionToken(token),
        new Date(),
        READ_GUARD
      )
    );

    const again = (await admin`
      SELECT last_used_at FROM awcms_machine_credentials WHERE id = ${id}
    `) as { last_used_at: Date | null }[];
    expect(new Date(again[0]!.last_used_at!).getTime()).toBe(firstStamp);
  });

  // Nothing revokes credentials when a service account is deactivated, and a
  // credential lives up to a YEAR — so "deactivate this account" MUST stop its
  // keys immediately, or it silently leaves a working one behind for months.
  // This is why the machine path checks both statuses while the session path
  // (bounded by session expiry) does not.
  test.each([
    ["tenant user deactivated", "awcms_tenant_users"],
    ["identity deactivated", "awcms_identities"]
  ])("%s kills its credentials on the next request", async (_label, table) => {
    const { token } = await issue(["blog_content.posts.read"]);
    const runtime = getRuntimeSql();

    const before = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      authorizeInTransaction(
        tx,
        TENANT_A,
        hashSessionToken(token),
        new Date(),
        READ_GUARD
      )
    );
    expect(before.allowed).toBe(true);

    const admin = getAdminSql();
    if (table === "awcms_tenant_users") {
      await admin`
        UPDATE awcms_tenant_users SET status = 'inactive'
        WHERE tenant_id = ${TENANT_A} AND id = ${SERVICE_USER_A}
      `;
    } else {
      await admin`
        UPDATE awcms_identities SET status = 'inactive'
        WHERE tenant_id = ${TENANT_A}
          AND id = (SELECT identity_id FROM awcms_tenant_users WHERE id = ${SERVICE_USER_A})
      `;
    }

    const after = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      authorizeInTransaction(
        tx,
        TENANT_A,
        hashSessionToken(token),
        new Date(),
        READ_GUARD
      )
    );

    expect(after.allowed).toBe(false);
    if (!after.allowed) expect(after.denied.status).toBe(401);
  });

  test("the listing never carries secret material", async () => {
    await issue(["blog_content.posts.read"]);

    const items = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      listMachineCredentials(tx, TENANT_A, new Date())
    );

    expect(items).toHaveLength(1);
    expect(JSON.stringify(items)).not.toContain("mc-sha256:");
    expect(Object.keys(items[0]!)).not.toContain("tokenHash");
    expect(items[0]!.status).toBe("active");
  });

  // ADR-0092 — the write class, issued through the real service rather than by
  // hand. `sql/121` landed with no writer at all; these are the first rows in
  // this repo that reach those two columns through a code path.

  test("the write class round-trips both columns, and the read class stays empty", async () => {
    await issue(["blog_content.posts.update"], undefined, {
      allowedWriteActions: ["update"],
      allowedIpCidrs: ["203.0.113.0/24"]
    });
    await issue(["blog_content.posts.read"]);

    const items = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      listMachineCredentials(tx, TENANT_A, new Date())
    );

    // Newest first, so the read-only one issued second comes back first.
    expect(items).toHaveLength(2);
    expect(items[0]!.allowedWriteActions).toEqual([]);
    expect(items[0]!.allowedIpCidrs).toEqual([]);
    expect(items[1]!.allowedWriteActions).toEqual(["update"]);
    expect(items[1]!.allowedIpCidrs).toEqual(["203.0.113.0/24"]);
  });

  test("a write credential authorises `update` from inside its allow-list and not outside", async () => {
    // The whole point of the surface, proven through `authorizeInTransaction`
    // rather than through the row: a credential is only worth issuing if the
    // chokepoint agrees with what was written. `update` rather than `create`
    // because it is what the service account actually holds here — a guard the
    // account cannot satisfy would answer 403 for a reason that has nothing to
    // do with the write class, and pass for the wrong reason if it broke.
    const { token } = await issue(["blog_content.posts.update"], undefined, {
      allowedWriteActions: ["update"],
      allowedIpCidrs: ["203.0.113.0/24"]
    });

    const inside = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      authorizeInTransaction(
        tx,
        TENANT_A,
        hashSessionToken(token),
        new Date(),
        UPDATE_GUARD,
        { clientIp: "203.0.113.9" }
      )
    );
    const outside = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      authorizeInTransaction(
        tx,
        TENANT_A,
        hashSessionToken(token),
        new Date(),
        UPDATE_GUARD,
        { clientIp: "198.51.100.7" }
      )
    );
    // A route that never learned to pass the address must not silently exempt
    // itself — the refusal that is easiest to leave out.
    const unknown = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      authorizeInTransaction(
        tx,
        TENANT_A,
        hashSessionToken(token),
        new Date(),
        UPDATE_GUARD
      )
    );

    expect(inside.allowed).toBe(true);
    expect(outside.allowed).toBe(false);
    expect(unknown.allowed).toBe(false);
  });

  test("the database refuses the two shapes the validator also refuses", async () => {
    const admin = getAdminSql();
    const row = (
      name: string,
      writeActions: string[],
      cidrs: string[],
      expiry: string
    ) => admin`
      INSERT INTO awcms_machine_credentials
        (tenant_id, tenant_user_id, name, token_hash, allowed_permission_keys,
         allowed_write_actions, allowed_ip_cidrs, expires_at,
         created_by_tenant_user_id)
      VALUES (
        ${TENANT_A}, ${SERVICE_USER_A}, ${name},
        ${hashMachineCredentialToken(generateMachineCredentialToken(TENANT_A))},
        ${toPostgresTextArray(["blog_content.posts.update"])}::text[],
        ${toPostgresTextArray(writeActions)}::text[],
        ${toPostgresTextArray(cidrs)}::text[],
        now() + ${expiry}::interval, ${HUMAN_USER_A}
      )
    `;

    // Asserted against the DATABASE, not the validator: a second writer is how
    // a rule enforced only in TypeScript disappears.
    await assertRejected(
      row("unbound writer", ["update"], [], "7 days"),
      "a write credential with no IP binding"
    );
    await assertRejected(
      row("long-lived writer", ["update"], ["203.0.113.0/24"], "60 days"),
      "a write credential outliving the 31-day ceiling"
    );
  });

  test("the database refuses an empty allow-list and a session-shaped hash", async () => {
    const admin = getAdminSql();

    await assertRejected(
      admin`
        INSERT INTO awcms_machine_credentials
          (tenant_id, tenant_user_id, name, token_hash, allowed_permission_keys, expires_at, created_by_tenant_user_id)
        VALUES (${TENANT_A}, ${SERVICE_USER_A}, 'empty', ${hashMachineCredentialToken("x")}, ${toPostgresTextArray([])}::text[], now() + interval '1 day', ${HUMAN_USER_A})
      `,
      "an empty allowed_permission_keys list"
    );

    await assertRejected(
      admin`
        INSERT INTO awcms_machine_credentials
          (tenant_id, tenant_user_id, name, token_hash, allowed_permission_keys, expires_at, created_by_tenant_user_id)
        VALUES (${TENANT_A}, ${SERVICE_USER_A}, 'session hash', ${`sha256:${"a".repeat(64)}`}, ${toPostgresTextArray(["blog_content.posts.read"])}::text[], now() + interval '1 day', ${HUMAN_USER_A})
      `,
      "a session-namespace token hash"
    );
  });

  test("the composite FK refuses a service account from another tenant", async () => {
    await assertRejected(
      getAdminSql()`
        INSERT INTO awcms_machine_credentials
          (tenant_id, tenant_user_id, name, token_hash, allowed_permission_keys, expires_at, created_by_tenant_user_id)
        VALUES (${TENANT_A}, ${SERVICE_USER_B}, 'cross tenant', ${hashMachineCredentialToken(generateMachineCredentialToken(TENANT_A))}, ${toPostgresTextArray(["blog_content.posts.read"])}::text[], now() + interval '1 day', ${HUMAN_USER_A})
      `,
      "a service account from another tenant"
    );
  });

  describe("session introspection", () => {
    const SESSION_TOKEN = "introspection-session-token";

    async function seedSession(
      expiresIn = "1 hour",
      revoked = false
    ): Promise<void> {
      await getAdminSql()`
        INSERT INTO awcms_sessions (tenant_id, identity_id, token_hash, expires_at, revoked_at, assurance_level)
        VALUES (
          ${TENANT_A}, ${humanIdentityA}, ${hashSessionToken(SESSION_TOKEN)},
          now() + ${expiresIn}::interval, ${revoked ? new Date() : null}, 'aal1'
        )
      `;
    }

    test("returns safe claims and no raw identifier", async () => {
      await seedSession();

      const claims = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        introspectSession(
          tx,
          TENANT_A,
          hashSessionToken(SESSION_TOKEN),
          new Date()
        )
      );

      expect(claims).not.toBeNull();
      expect(claims!.identityId).toBe(humanIdentityA);
      expect(claims!.displayName).toBe("Display human-a");
      expect(claims!.roles).toEqual(["mc-role-a"]);
      expect(claims!.assuranceLevel).toBe("aal1");
      // The raw login identifier is what `GET /auth/me` returns and what this
      // endpoint must never leak to a public portal.
      expect(JSON.stringify(claims)).not.toContain("human-a@example.test");
      expect(JSON.stringify(claims)).not.toContain("sha256:");
    });

    test("a revoked session and an unknown token are indistinguishable", async () => {
      await seedSession("1 hour", true);
      const runtime = getRuntimeSql();

      const revoked = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
        introspectSession(
          tx,
          TENANT_A,
          hashSessionToken(SESSION_TOKEN),
          new Date()
        )
      );
      const unknown = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
        introspectSession(tx, TENANT_A, hashSessionToken("nope"), new Date())
      );

      expect(revoked).toBeNull();
      expect(unknown).toBeNull();
    });

    test("a deactivated identity ends the introspected session", async () => {
      await seedSession();
      await getAdminSql()`
        UPDATE awcms_identities SET status = 'inactive' WHERE id = ${humanIdentityA}
      `;

      const claims = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        introspectSession(
          tx,
          TENANT_A,
          hashSessionToken(SESSION_TOKEN),
          new Date()
        )
      );

      expect(claims).toBeNull();
    });

    test("a machine credential has no session to introspect", async () => {
      const { token } = await issue(["blog_content.posts.read"]);

      const claims = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        introspectSession(tx, TENANT_A, hashSessionToken(token), new Date())
      );

      expect(claims).toBeNull();
    });
  });
});
