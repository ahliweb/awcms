/**
 * `awcms_access_policies` equivalence + effect (ADR-0078, Gelombang 3 PR 3.1 of
 * #423), against a real PostgreSQL under the WORLD-1 ephemeral-database harness.
 *
 * PR 3.1's whole safety argument is one sentence: **with the new table empty,
 * `fetchGrantedPermissionKeys` returns exactly what it returned before.** That
 * sentence is about a `UNION ALL` inside a SQL string, and no amount of reading
 * it proves it — a `JOIN` moved into a subquery, a `tenant_id` predicate lost on
 * one side, a `DISTINCT` that stopped covering a column, all look fine and all
 * change the answer. So the oracle runs the real query against real rows.
 *
 * Two halves, and both are needed:
 *
 *   1. EQUIVALENCE — with no policy rows, the union's answer equals the answer
 *      of the pre-migration query, run side by side against the same fixtures.
 *      The old query is spelled out here as a literal rather than imported: a
 *      test that derives its expectation from the thing under test can only
 *      assert that the code agrees with itself.
 *   2. EFFECT — a policy row actually grants, and its lifecycle columns actually
 *      filter. Without this half, a `UNION ALL` branch that silently matched
 *      nothing at all would pass part 1 perfectly.
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
import { fetchGrantedPermissionKeys } from "../../src/modules/identity-access/application/auth-context";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const A_SUBJECT = "a0000000-0000-4000-8000-000000000001";
const A_OTHER = "a0000000-0000-4000-8000-000000000002";
const B_SUBJECT = "b0000000-0000-4000-8000-000000000001";

const ROLE_ASSIGNED = "a0000000-0000-4000-8000-0000000000a1";
const ROLE_POLICY_ONLY = "a0000000-0000-4000-8000-0000000000a2";
const ROLE_DELETED = "a0000000-0000-4000-8000-0000000000a3";
const B_ROLE = "b0000000-0000-4000-8000-0000000000b1";

/**
 * The query as it stood BEFORE `sql/102`, transcribed by hand.
 *
 * Deliberately not extracted from git or re-derived: this is the oracle, and an
 * oracle that shares a source with the thing it judges judges nothing.
 */
async function legacyGrantedKeys(
  tx: Bun.SQL,
  tenantId: string,
  tenantUserId: string
): Promise<Set<string>> {
  const rows = (await tx`
    SELECT DISTINCT p.module_key, p.activity_code, p.action
    FROM awcms_access_assignments aa
    JOIN awcms_role_permissions rp ON rp.role_id = aa.role_id AND rp.tenant_id = aa.tenant_id
    JOIN awcms_permissions p ON p.id = rp.permission_id
    JOIN awcms_roles r ON r.id = aa.role_id
    WHERE aa.tenant_id = ${tenantId} AND aa.tenant_user_id = ${tenantUserId} AND r.deleted_at IS NULL
  `) as { module_key: string; activity_code: string; action: string }[];

  return new Set(
    rows.map((row) => `${row.module_key}.${row.activity_code}.${row.action}`)
  );
}

function sorted(keys: Set<string>): string[] {
  return [...keys].sort();
}

async function seedFixtures(): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${TENANT_A}, 'ap-tenant-a', 'AP Tenant A'),
           (${TENANT_B}, 'ap-tenant-b', 'AP Tenant B')
  `;

  const users = [
    { id: A_SUBJECT, tenant: TENANT_A, label: "a-subject" },
    { id: A_OTHER, tenant: TENANT_A, label: "a-other" },
    { id: B_SUBJECT, tenant: TENANT_B, label: "b-subject" }
  ];

  for (const user of users) {
    const profile = (await admin`
      INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
      VALUES (${user.tenant}, 'person', ${`Profile ${user.label}`})
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
  }

  await admin`
    INSERT INTO awcms_roles (id, tenant_id, role_code, role_name)
    VALUES (${ROLE_ASSIGNED}, ${TENANT_A}, 'ap-assigned', 'Assigned'),
           (${ROLE_POLICY_ONLY}, ${TENANT_A}, 'ap-policy', 'Policy only'),
           (${ROLE_DELETED}, ${TENANT_A}, 'ap-deleted', 'Deleted'),
           (${B_ROLE}, ${TENANT_B}, 'ap-b', 'B role')
  `;

  // Soft-deleted role: both branches must drop it.
  await admin`
    UPDATE awcms_roles SET deleted_at = now() WHERE id = ${ROLE_DELETED}
  `;

  // Three catalogue permissions, one per role, so a key identifies its source.
  const permissions = (await admin`
    INSERT INTO awcms_permissions (module_key, activity_code, action, description)
    VALUES ('identity_access', 'ap_fixture_assigned', 'read', 'fixture'),
           ('identity_access', 'ap_fixture_policy', 'read', 'fixture'),
           ('identity_access', 'ap_fixture_deleted', 'read', 'fixture')
    ON CONFLICT (module_key, activity_code, action) DO UPDATE SET description = 'fixture'
    RETURNING id, activity_code
  `) as { id: string; activity_code: string }[];

  const permissionByActivity = new Map(
    permissions.map((row) => [row.activity_code, row.id])
  );

  await admin`
    INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
    VALUES (${TENANT_A}, ${ROLE_ASSIGNED}, ${permissionByActivity.get("ap_fixture_assigned")!}),
           (${TENANT_A}, ${ROLE_POLICY_ONLY}, ${permissionByActivity.get("ap_fixture_policy")!}),
           (${TENANT_A}, ${ROLE_DELETED}, ${permissionByActivity.get("ap_fixture_deleted")!})
  `;

  // The classic grant: subject holds the assigned role AND the deleted one.
  await admin`
    INSERT INTO awcms_access_assignments (tenant_id, tenant_user_id, role_id)
    VALUES (${TENANT_A}, ${A_SUBJECT}, ${ROLE_ASSIGNED}),
           (${TENANT_A}, ${A_SUBJECT}, ${ROLE_DELETED})
  `;
}

/** Inserts one policy row through the admin connection (RLS-bypassing). */
async function insertPolicy(
  overrides: Record<string, unknown> = {}
): Promise<void> {
  const admin = getAdminSql();
  const row = {
    tenant_id: TENANT_A,
    tenant_user_id: A_SUBJECT,
    role_id: ROLE_POLICY_ONLY,
    scope_type: "tenant",
    scope_id: TENANT_A,
    status: "active",
    effective_from: new Date(Date.now() - 60_000),
    effective_to: null as Date | null,
    // Carried explicitly rather than defaulted away: `awcms_access_policies_revoked_consistency_check`
    // refuses `status = 'revoked'` with a NULL timestamp, and a helper that
    // silently dropped the column would make that constraint look like a bug in
    // the test it caught. (It caught this one.)
    revoked_at: null as Date | null,
    ...overrides
  };

  await admin`
    INSERT INTO awcms_access_policies
      (tenant_id, tenant_user_id, role_id, scope_type, scope_id, status,
       effective_from, effective_to, revoked_at)
    VALUES
      (${row.tenant_id}, ${row.tenant_user_id}, ${row.role_id}, ${row.scope_type},
       ${row.scope_id}, ${row.status}, ${row.effective_from}, ${row.effective_to},
       ${row.revoked_at})
  `;
}

const ASSIGNED_KEY = "identity_access.ap_fixture_assigned.read";
const POLICY_KEY = "identity_access.ap_fixture_policy.read";
const DELETED_KEY = "identity_access.ap_fixture_deleted.read";

const suite = integrationEnabled ? describe : describe.skip;

suite("awcms_access_policies equivalence and effect (ADR-0078)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedFixtures();
  });

  test("with NO policy rows the union answers exactly what the pre-migration query answers", async () => {
    const runtime = getRuntimeSql();

    const [union, legacy] = await withTenantOrThrow(
      runtime,
      TENANT_A,
      async (tx) => [
        await fetchGrantedPermissionKeys(tx, TENANT_A, A_SUBJECT),
        await legacyGrantedKeys(tx, TENANT_A, A_SUBJECT)
      ]
    );

    expect(sorted(union)).toEqual(sorted(legacy));
    // And the fixture is not vacuous: the subject really does hold something,
    // and the soft-deleted role really is excluded by both.
    expect(sorted(union)).toEqual([ASSIGNED_KEY]);
    expect(sorted(union)).not.toContain(DELETED_KEY);
  });

  test("a subject with nothing at all still agrees, and both answer empty", async () => {
    const runtime = getRuntimeSql();

    const [union, legacy] = await withTenantOrThrow(
      runtime,
      TENANT_A,
      async (tx) => [
        await fetchGrantedPermissionKeys(tx, TENANT_A, A_OTHER),
        await legacyGrantedKeys(tx, TENANT_A, A_OTHER)
      ]
    );

    expect(sorted(union)).toEqual(sorted(legacy));
    expect(sorted(union)).toEqual([]);
  });

  test("an ACTIVE policy grants its role's keys, and the union no longer matches the legacy query", async () => {
    // The other half of the oracle. Without this, a UNION ALL branch that
    // matched nothing at all would satisfy every equivalence assertion above.
    await insertPolicy();

    const runtime = getRuntimeSql();

    const [union, legacy] = await withTenantOrThrow(
      runtime,
      TENANT_A,
      async (tx) => [
        await fetchGrantedPermissionKeys(tx, TENANT_A, A_SUBJECT),
        await legacyGrantedKeys(tx, TENANT_A, A_SUBJECT)
      ]
    );

    expect(sorted(union)).toEqual([ASSIGNED_KEY, POLICY_KEY].sort());
    expect(sorted(legacy)).toEqual([ASSIGNED_KEY]);
  });

  test("holding the SAME role through both shapes yields the key once", async () => {
    // `UNION ALL` under `DISTINCT`. This is what lets PR 3.3 move rows one at a
    // time: during the move a subject holds a role through both tables, and
    // that must be indistinguishable from holding it through either.
    await insertPolicy({ role_id: ROLE_ASSIGNED });

    const runtime = getRuntimeSql();
    const union = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      fetchGrantedPermissionKeys(tx, TENANT_A, A_SUBJECT)
    );

    expect(sorted(union)).toEqual([ASSIGNED_KEY]);
  });

  test.each([
    ["revoked", { status: "revoked", revoked_at: new Date() }],
    ["expired", { status: "expired" }],
    ["not yet effective", { effective_from: new Date(Date.now() + 3_600_000) }],
    [
      "past its effective_to",
      {
        effective_from: new Date(Date.now() - 7_200_000),
        effective_to: new Date(Date.now() - 3_600_000)
      }
    ]
  ])("a %s policy grants nothing", async (_label, overrides) => {
    await insertPolicy(overrides);

    const runtime = getRuntimeSql();
    const union = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      fetchGrantedPermissionKeys(tx, TENANT_A, A_SUBJECT)
    );

    expect(sorted(union)).toEqual([ASSIGNED_KEY]);
  });

  test("a policy naming a soft-deleted role grants nothing", async () => {
    // The role filter has to apply to BOTH branches. A `deleted_at` check left
    // on the assignment side only would let a stale policy outlive the role it
    // names — and a deleted role is exactly the thing an admin deletes in order
    // to take access away.
    await insertPolicy({ role_id: ROLE_DELETED });

    const runtime = getRuntimeSql();
    const union = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      fetchGrantedPermissionKeys(tx, TENANT_A, A_SUBJECT)
    );

    expect(sorted(union)).toEqual([ASSIGNED_KEY]);
  });

  test("a cross-tenant policy row is refused by the composite FK, not merely filtered", async () => {
    // Postgres runs RI checks as the table OWNER and bypasses RLS while doing
    // so, so this is the only control that makes a tenant-A row unable to name
    // a tenant-B subject. Attempted through the admin connection precisely
    // because that connection can bypass everything RLS would have caught.
    const admin = getAdminSql();
    let rejected = false;

    try {
      await admin`
        INSERT INTO awcms_access_policies
          (tenant_id, tenant_user_id, role_id, scope_type, scope_id)
        VALUES (${TENANT_A}, ${B_SUBJECT}, ${ROLE_ASSIGNED}, 'tenant', ${TENANT_A})
      `;
    } catch {
      rejected = true;
    }

    expect(rejected).toBe(true);
  });

  test("the active partial unique index refuses a duplicate grant but allows re-granting after revocation", async () => {
    await insertPolicy();

    let duplicateRejected = false;
    try {
      await insertPolicy();
    } catch {
      duplicateRejected = true;
    }
    expect(duplicateRejected).toBe(true);

    // Revoking frees the slot: re-granting the same thing later is the ordinary
    // case, not an edge one, which is why the index is partial on `status`.
    await getAdminSql()`
      UPDATE awcms_access_policies
      SET status = 'revoked', revoked_at = now()
      WHERE tenant_id = ${TENANT_A}
    `;

    await insertPolicy();

    const runtime = getRuntimeSql();
    const union = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      fetchGrantedPermissionKeys(tx, TENANT_A, A_SUBJECT)
    );

    expect(sorted(union)).toEqual([ASSIGNED_KEY, POLICY_KEY].sort());
  });
});
