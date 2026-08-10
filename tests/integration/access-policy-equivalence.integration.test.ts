/**
 * `awcms_access_policies` equivalence + effect (ADR-0078 and ADR-0079,
 * Gelombang 3 PR 3.1/3.3 of #423), against a real PostgreSQL under the WORLD-1
 * ephemeral-database harness.
 *
 * PR 3.1's safety argument was one sentence: with the new table empty,
 * `fetchGrantedPermissionKeys` returns exactly what it returned before. PR 3.3
 * replaces it with the sentence that has to be true for the OLD table to be
 * retired: **after the backfill, every subject's answer is the same one the
 * pre-migration query gave for the same legacy rows.** Neither sentence can be
 * proven by reading SQL — a `JOIN` moved into a subquery, a `tenant_id`
 * predicate lost on one side, a `DISTINCT` that stopped covering a column all
 * look fine and all change the answer. So the oracle runs the real query, and
 * the migration under test is the real file rather than a transcription of it.
 *
 * Three halves, and all are needed:
 *
 *   1. EQUIVALENCE ACROSS THE BACKFILL — the answer computed from the legacy
 *      rows BEFORE `sql/103` runs equals the answer the live reader gives after
 *      it. The pre-migration query is spelled out here as a literal rather than
 *      imported: a test that derives its expectation from the thing under test
 *      can only assert that the code agrees with itself.
 *   2. THE RETIREMENT IS REAL — a legacy row that was NOT backfilled grants
 *      nothing. Without this, a reader that quietly kept its old union would
 *      satisfy part 1 perfectly, which is exactly the drift ADR-0079 records.
 *   3. EFFECT — a policy row actually grants, and its lifecycle columns actually
 *      filter.
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
import { readFileSync } from "node:fs";

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

/**
 * Runs `sql/103` again, against whatever legacy rows a test has seeded.
 *
 * The harness applies every migration to an EMPTY database, so the backfill has
 * already run and moved nothing. Re-running the real file is what puts rows
 * through the real statement — and it is the real file, read from disk, because
 * a transcription of a backfill is a backfill nobody has tested.
 *
 * Safe to run repeatedly by construction: the copy is guarded by `NOT EXISTS` on
 * both the id and the active-grant shape, and the GRANT/REVOKE statements are
 * idempotent. That is asserted below rather than assumed.
 */
async function applyBackfillMigration(): Promise<void> {
  const sql = readFileSync(
    "sql/103_awcms_access_assignments_backfill_retire.sql",
    "utf8"
  );

  await getAdminSql().unsafe(sql);
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

  test("after the backfill the reader answers exactly what the pre-migration query answered", async () => {
    const runtime = getRuntimeSql();

    const before = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      legacyGrantedKeys(tx, TENANT_A, A_SUBJECT)
    );

    // The fixture is not vacuous: the subject really did hold something through
    // the legacy table, and the soft-deleted role really was already excluded.
    expect(sorted(before)).toEqual([ASSIGNED_KEY]);
    expect(sorted(before)).not.toContain(DELETED_KEY);

    await applyBackfillMigration();

    const after = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      fetchGrantedPermissionKeys(tx, TENANT_A, A_SUBJECT)
    );

    expect(sorted(after)).toEqual(sorted(before));
  });

  test("the backfill keeps the id, so an audit reference still resolves", async () => {
    // The reason the migration copies `id` instead of minting one: audit rows,
    // operator notes and incident tickets name a grant by id, and re-keying
    // would break every one of them silently.
    const admin = getAdminSql();
    const legacyIds = (
      (await admin`
        SELECT id FROM awcms_access_assignments WHERE tenant_id = ${TENANT_A}
        ORDER BY id
      `) as { id: string }[]
    ).map((row) => row.id);

    expect(legacyIds).toHaveLength(2);

    await applyBackfillMigration();

    const policyIds = (
      (await admin`
        SELECT id FROM awcms_access_policies WHERE tenant_id = ${TENANT_A}
        ORDER BY id
      `) as { id: string }[]
    ).map((row) => row.id);

    expect(policyIds).toEqual(legacyIds);

    // And every migrated grant carries the `granted` event its history table
    // exists to hold — a policy with no lifecycle row is a grant with no origin.
    const events = (await admin`
      SELECT policy_id, event_type, metadata
      FROM awcms_access_policy_events
      WHERE tenant_id = ${TENANT_A}
      ORDER BY policy_id
    `) as { policy_id: string; event_type: string; metadata: unknown }[];

    expect(events.map((row) => row.policy_id)).toEqual(legacyIds);
    expect(events.every((row) => row.event_type === "granted")).toBe(true);
  });

  test("running the backfill twice moves nothing the second time", async () => {
    // Migrations are applied once, but a re-run happens: a restored snapshot, a
    // re-pointed `DATABASE_URL`, an operator repeating a step. Duplicating the
    // grants would violate the active partial unique index and abort — the loud
    // failure — but duplicating the EVENTS would not, and a history that says a
    // grant was made twice is a history that misleads an investigator.
    await applyBackfillMigration();
    await applyBackfillMigration();

    const admin = getAdminSql();
    const counts = (await admin`
      SELECT
        (SELECT count(*) FROM awcms_access_policies WHERE tenant_id = ${TENANT_A}) AS policies,
        (SELECT count(*) FROM awcms_access_policy_events WHERE tenant_id = ${TENANT_A}) AS events
    `) as { policies: string; events: string }[];

    expect(Number(counts[0]!.policies)).toBe(2);
    expect(Number(counts[0]!.events)).toBe(2);
  });

  test("a legacy row that was NOT backfilled grants nothing", async () => {
    // The retirement, asserted as a property rather than as a code shape. If any
    // reader kept its old union, this is the test that reports it — and it is
    // the same shape as the incident ADR-0079 records, only in the safe
    // direction.
    const runtime = getRuntimeSql();

    const keys = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      fetchGrantedPermissionKeys(tx, TENANT_A, A_SUBJECT)
    );

    expect(sorted(keys)).toEqual([]);
  });

  test("a subject with nothing at all answers empty", async () => {
    const runtime = getRuntimeSql();

    await applyBackfillMigration();

    const keys = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      fetchGrantedPermissionKeys(tx, TENANT_A, A_OTHER)
    );

    expect(sorted(keys)).toEqual([]);
  });

  test("a legacy row naming another tenant's role is left behind, not aborted on", async () => {
    // `awcms_access_assignments.role_id` is a single-column FK, so it cannot
    // stop a cross-tenant reference; `awcms_access_policies`' composite FK can,
    // and would abort the WHOLE migration on one such row. Such a row grants
    // nothing today either, so leaving it behind changes no access — but the
    // migration has to survive it, and only a real database can say whether it
    // does.
    const admin = getAdminSql();

    await admin`
      INSERT INTO awcms_access_assignments (tenant_id, tenant_user_id, role_id)
      VALUES (${TENANT_A}, ${A_OTHER}, ${B_ROLE})
    `;

    await applyBackfillMigration();

    const migrated = (await admin`
      SELECT count(*)::int AS n FROM awcms_access_policies
      WHERE tenant_id = ${TENANT_A}
    `) as { n: number }[];

    // The two good rows moved; the cross-tenant one did not.
    expect(migrated[0]!.n).toBe(2);

    const runtime = getRuntimeSql();
    const keys = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      fetchGrantedPermissionKeys(tx, TENANT_A, A_OTHER)
    );

    expect(sorted(keys)).toEqual([]);
  });

  test("an ACTIVE policy grants its role's keys on top of the migrated ones", async () => {
    // The other half of the oracle. Without this, a grant source that matched
    // nothing at all would satisfy every equivalence assertion above.
    await applyBackfillMigration();
    await insertPolicy();

    const runtime = getRuntimeSql();

    const keys = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      fetchGrantedPermissionKeys(tx, TENANT_A, A_SUBJECT)
    );

    expect(sorted(keys)).toEqual([ASSIGNED_KEY, POLICY_KEY].sort());
  });

  test("the SAME role held at two scopes yields the key once", async () => {
    // `DISTINCT` over the grant source. One role at three scopes is three rows
    // (ADR-0078) — the shape the partial unique index permits and the shape
    // PR 3.4 will start qualifying — and a subject must not be told about a
    // permission N times because they hold it in N places.
    await applyBackfillMigration();
    await insertPolicy({ role_id: ROLE_ASSIGNED, scope_id: A_SUBJECT });

    const runtime = getRuntimeSql();
    const keys = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      fetchGrantedPermissionKeys(tx, TENANT_A, A_SUBJECT)
    );

    expect(sorted(keys)).toEqual([ASSIGNED_KEY]);
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
    // The migrated grant is the non-vacuous baseline: without it the assertion
    // would pass just as well against a reader that returned nothing at all.
    await applyBackfillMigration();
    await insertPolicy(overrides);

    const runtime = getRuntimeSql();
    const union = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      fetchGrantedPermissionKeys(tx, TENANT_A, A_SUBJECT)
    );

    expect(sorted(union)).toEqual([ASSIGNED_KEY]);
  });

  test("a policy naming a soft-deleted role grants nothing", async () => {
    // `deleted_at` belongs to the role, not to the grant, so the filter lives
    // with the reader rather than in the shared grant source — a stale policy
    // must not outlive the role it names, and deleting a role is exactly the
    // thing an admin does in order to take that access away.
    //
    // The fixture's second legacy row names the soft-deleted role, so the
    // backfill supplies the policy under test: the migration deliberately does
    // NOT drop grants of deleted roles, because it must preserve the prior state
    // exactly and the reader is what makes them inert.
    await applyBackfillMigration();

    const admin = getAdminSql();
    const deletedRolePolicies = (await admin`
      SELECT count(*)::int AS n FROM awcms_access_policies
      WHERE tenant_id = ${TENANT_A} AND role_id = ${ROLE_DELETED}
    `) as { n: number }[];

    expect(deletedRolePolicies[0]!.n).toBe(1);

    const runtime = getRuntimeSql();
    const keys = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      fetchGrantedPermissionKeys(tx, TENANT_A, A_SUBJECT)
    );

    expect(sorted(keys)).toEqual([ASSIGNED_KEY]);
    expect(sorted(keys)).not.toContain(DELETED_KEY);
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
    const keys = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      fetchGrantedPermissionKeys(tx, TENANT_A, A_SUBJECT)
    );

    expect(sorted(keys)).toEqual([POLICY_KEY]);
  });
});
