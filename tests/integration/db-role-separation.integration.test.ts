/**
 * Makes the migration-017/019 verification PERMANENT (Issue #154, pinning
 * PR #139's "RLS inert on 23 tables" finding and Issue #141's least-privilege
 * `awcms_app` role).
 *
 * #139 was verified ONCE, by hand: run every migration in a throwaway
 * database under a non-superuser owner, seed two tenants, read tenant B's
 * rows with the GUC set to tenant A, observe the leak before `FORCE` and its
 * absence after. That procedure is exactly what belongs in a permanent test
 * rather than in a commit message — which is what this file is.
 *
 * TWO POSTURES, BOTH REAL, BOTH TESTED. Migration 019 ships `awcms_app`
 * `NOLOGIN`, and `getNamedDatabaseClient` falls back to `DATABASE_URL`, so a
 * deployment that has not explicitly activated the role still connects as the
 * migration OWNER. Both are therefore live production shapes and both are
 * covered here:
 *
 *   - OWNER (`getOwnerSql()`)  — `FORCE` (migration 017) is the ONLY thing
 *     stopping cross-tenant reads. Without it, `ENABLE` is inert and every
 *     policy is skipped. This is the #139 regression's exact habitat.
 *   - APP (`getAppRoleSql()`)  — non-owner, so RLS applies regardless of
 *     `FORCE`; what is being pinned here is #141's grant matrix and the
 *     fail-closed all-zero `app.current_tenant_id` default. A DEDICATED
 *     `awcms_app` connection this harness owns, never the process-wide
 *     `getDatabaseClient()` pool (which a full `bun test` run pins to a
 *     different database entirely — see harness.ts).
 *
 * THE CONTROL TEST is `awcms_tenants`, which deliberately has no RLS (it is
 * the root table every tenant-scoped policy resolves against). It stays
 * visible cross-tenant, which proves that every "0 rows" result below is RLS
 * doing its job rather than a broken connection or a missing grant — without
 * it, a harness bug that silently pointed at an empty database would make
 * this whole file pass.
 *
 * `awcms_app` assertions SKIP — loudly — if migration 019 is absent, rather
 * than hard-failing a run on work that has not landed.
 *
 * Skipped entirely unless `DATABASE_URL` is set (see harness.ts §Gating).
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
  APP_ROLE_NAME,
  appRoleActivated,
  assertRejected,
  getAdminSql,
  getAppRoleSql,
  getOwnerSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { withTenant } from "../../src/lib/database/tenant-context";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/**
 * The exact 23 tables migration 017 turned from `ENABLE`-only (inert for the
 * owner) into `FORCE`. Spelled out as a literal list, NOT derived from the
 * migration file or from `pg_class`, on purpose: a test that computes its
 * expectation from the same source as the thing under test can only ever
 * assert "the code agrees with itself". Deleting a `FORCE` line from 017 must
 * fail HERE.
 */
const FORCED_RLS_TABLES = [
  "awcms_offices",
  "awcms_tenant_settings",
  "awcms_profiles",
  "awcms_profile_identifiers",
  "awcms_profile_entity_links",
  "awcms_identities",
  "awcms_tenant_users",
  "awcms_sessions",
  "awcms_roles",
  "awcms_role_permissions",
  "awcms_access_assignments",
  "awcms_abac_policies",
  "awcms_abac_decision_logs",
  "awcms_audit_events",
  "awcms_tenant_modules",
  "awcms_module_settings",
  "awcms_sync_nodes",
  "awcms_sync_outbox",
  "awcms_sync_inbox",
  "awcms_sync_push_batches",
  "awcms_sync_aggregate_versions",
  "awcms_sync_conflicts",
  "awcms_object_sync_queue"
];

/**
 * Seeded through the RLS-BYPASSING admin connection: arranging a cross-tenant
 * fixture is exactly the operation RLS is supposed to prevent the app from
 * performing, so it cannot be arranged through the app's own connection.
 */
async function seedTwoTenants(): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${TENANT_A}, 'rls-tenant-a', 'RLS Tenant A'),
           (${TENANT_B}, 'rls-tenant-b', 'RLS Tenant B')
  `;

  // `awcms_offices` is a FORCE'd, tenant-scoped table carrying the standard
  // `tenant_id = current_setting('app.current_tenant_id')::uuid` policy —
  // representative of all 23.
  await admin`
    INSERT INTO awcms_offices (tenant_id, office_code, office_name)
    VALUES (${TENANT_A}, 'hq-a', 'HQ A'),
           (${TENANT_B}, 'hq-b', 'HQ B')
  `;
}

const suite = integrationEnabled ? describe : describe.skip;

suite(
  "db role separation + RLS enforcement (Issue #154, pins #139/#141)",
  () => {
    beforeAll(async () => {
      await setupIntegrationDatabase();
    });

    afterAll(async () => {
      await teardownIntegrationDatabase();
    });

    beforeEach(async () => {
      await resetDatabase();
    });

    describe("the harness's own premises (if these fail, nothing else here means anything)", () => {
      test("the OWNER role is non-superuser, non-BYPASSRLS, and really owns the tables", async () => {
        const sql = getOwnerSql();

        const rows = (await sql`
        SELECT rolname, rolsuper, rolbypassrls
        FROM pg_roles WHERE rolname = current_user
      `) as { rolname: string; rolsuper: boolean; rolbypassrls: boolean }[];

        expect(rows[0]?.rolsuper).toBe(false);
        expect(rows[0]?.rolbypassrls).toBe(false);

        // Owning the tables is what makes FORCE load-bearing rather than
        // incidental — a non-owner would be subject to RLS anyway.
        const owner = (await sql`
        SELECT tableowner FROM pg_tables WHERE tablename = 'awcms_offices'
      `) as { tableowner: string }[];

        expect(owner[0]?.tableowner).toBe(rows[0]!.rolname);
      });

      test("the ADMIN fixture connection really does bypass RLS (otherwise the cross-tenant read-backs below would be vacuous)", async () => {
        await seedTwoTenants();

        const rows = (await getAdminSql()`
        SELECT office_code FROM awcms_offices ORDER BY office_code
      `) as { office_code: string }[];

        // No tenant GUC set, no WHERE clause — a superuser sees everything.
        expect(rows.map((row) => row.office_code)).toEqual(["hq-a", "hq-b"]);
      });
    });

    describe("FORCE ROW LEVEL SECURITY — the owner posture (migration 017, PR #139)", () => {
      test("all 23 tables migration 017 covers have RLS both ENABLED and FORCED (ENABLE alone is inert for the owner)", async () => {
        // Fetched unfiltered and narrowed in JS rather than with
        // `= ANY(${FORCED_RLS_TABLES})`: Bun.SQL binds a JS array as a single
        // text parameter, which Postgres then rejects as a malformed array
        // literal (`22P02`). Not worth a driver-specific workaround for a
        // catalog query this small.
        const all = (await getOwnerSql()`
        SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'awcms\\_%'
      `) as {
          relname: string;
          relrowsecurity: boolean;
          relforcerowsecurity: boolean;
        }[];

        const byName = new Map(all.map((row) => [row.relname, row]));

        // Every listed table must exist — a typo here would otherwise make the
        // assertion below pass while covering nothing.
        const missing = FORCED_RLS_TABLES.filter((name) => !byName.has(name));
        expect(missing).toEqual([]);

        const notForced = FORCED_RLS_TABLES.filter((name) => {
          const row = byName.get(name);
          return !row?.relrowsecurity || !row?.relforcerowsecurity;
        });

        expect(notForced).toEqual([]);
      });

      test("NO awcms_* table anywhere ENABLEs RLS without also FORCEing it (catches a NEW table shipped with the exact #139 defect)", async () => {
        const rows = (await getOwnerSql()`
        SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND c.relname LIKE 'awcms\\_%'
          AND c.relrowsecurity
          AND NOT c.relforcerowsecurity
        ORDER BY c.relname
      `) as { relname: string }[];

        // An empty-list assertion over a LIVE catalog query, not over a
        // hardcoded list: this is what fires when someone adds migration 021
        // with `ENABLE ROW LEVEL SECURITY` and forgets `FORCE`.
        expect(rows.map((row) => row.relname)).toEqual([]);
      });

      test("cross-tenant SELECT returns zero rows for the OWNER: tenant A's context never sees tenant B's offices", async () => {
        await seedTwoTenants();
        const sql = getOwnerSql();

        const asTenantA = await withTenant(sql, TENANT_A, async (tx) => {
          return (await tx`
          SELECT office_code FROM awcms_offices ORDER BY office_code
        `) as { office_code: string }[];
        });

        // Note the absence of any `WHERE tenant_id = ...`: the filtering here is
        // RLS and nothing else. Before migration 017 this returned BOTH rows.
        expect(asTenantA.map((row) => row.office_code)).toEqual(["hq-a"]);

        // And an explicit, adversarial `WHERE tenant_id = <B>` — the shape a
        // buggy service layer or a parameter-injection would produce — still
        // yields nothing, because Postgres ANDs the policy in itself.
        const targeted = await withTenant(sql, TENANT_A, async (tx) => {
          return (await tx`
          SELECT office_code FROM awcms_offices WHERE tenant_id = ${TENANT_B}
        `) as { office_code: string }[];
        });

        expect(targeted).toEqual([]);
      });

      test("CONTROL: the same OWNER connection DOES see both tenants in awcms_tenants (no RLS there), proving the zero-row results are RLS and not a dead connection", async () => {
        await seedTwoTenants();

        const rows = await withTenant(getOwnerSql(), TENANT_A, async (tx) => {
          return (await tx`
          SELECT tenant_code FROM awcms_tenants ORDER BY tenant_code
        `) as { tenant_code: string }[];
        });

        expect(rows.map((row) => row.tenant_code)).toEqual([
          "rls-tenant-a",
          "rls-tenant-b"
        ]);
      });

      test("cross-tenant UPDATE and DELETE are blocked too, not just SELECT", async () => {
        await seedTwoTenants();

        await withTenant(getOwnerSql(), TENANT_A, async (tx) => {
          const updated = await tx`
          UPDATE awcms_offices SET office_name = 'HIJACKED' WHERE tenant_id = ${TENANT_B}
        `;
          expect(updated.count).toBe(0);

          const deleted = await tx`
          DELETE FROM awcms_offices WHERE tenant_id = ${TENANT_B}
        `;
          expect(deleted.count).toBe(0);
        });

        // Read back over the RLS-bypassing admin connection. Asserting only
        // `count: 0` above would not distinguish "blocked" from "applied to a
        // row I then could not see".
        const rows = (await getAdminSql()`
        SELECT office_name FROM awcms_offices WHERE tenant_id = ${TENANT_B}
      `) as { office_name: string }[];

        expect(rows).toHaveLength(1);
        expect(rows[0]!.office_name).toBe("HQ B");
      });

      test("INSERTing a row for another tenant is rejected outright (the policy's USING supplies the WITH CHECK)", async () => {
        await seedTwoTenants();

        const error = await withTenant(getOwnerSql(), TENANT_A, async (tx) =>
          assertRejected(
            tx`
            INSERT INTO awcms_offices (tenant_id, office_code, office_name)
            VALUES (${TENANT_B}, 'smuggled', 'Smuggled')
          `,
            "an INSERT of a tenant-B row from tenant A's context"
          )
        );

        expect(error.message).toMatch(/row-level security/i);

        const rows = (await getAdminSql()`
        SELECT 1 FROM awcms_offices WHERE office_code = 'smuggled'
      `) as unknown[];

        expect(rows).toHaveLength(0);
      });

      test("with NO tenant GUC, a FORCE'd table is unreadable for the OWNER rather than fully readable (fail-closed)", async () => {
        await seedTwoTenants();

        // Deliberately bypasses `withTenant`: this is the "somebody queried
        // outside the tenant-context wrapper" case. The owner has no
        // `app.current_tenant_id` default (only `awcms_app` gets one, from
        // migration 019), so evaluating the policy FAILS and the query errors
        // out. That is the correct outcome — the dangerous alternative is a
        // policy that silently matches everything.
        const error = await assertRejected(
          getOwnerSql()`SELECT office_code FROM awcms_offices`,
          "a SELECT on a FORCE'd table with no app.current_tenant_id set"
        );

        // TWO error shapes are legitimate here, and which one appears depends on
        // whether this pooled connection has previously served a `withTenant`
        // transaction:
        //   - never has  -> `current_setting/1` on an undefined placeholder GUC
        //                   throws `unrecognized configuration parameter`.
        //   - has        -> `SET LOCAL` DEFINED the placeholder for that
        //                   session, and at COMMIT it reverts to '' (empty
        //                   string) rather than becoming undefined again, so the
        //                   policy's `::uuid` cast throws instead.
        // Both are hard errors, i.e. both are fail-closed, which is the actual
        // invariant. Asserting only one of the two messages would make this test
        // flaky on pool-assignment order — it already did, once.
        expect(error.message).toMatch(
          /app\.current_tenant_id|invalid input syntax for type uuid/i
        );

        // The load-bearing half: whatever the message, no tenant's rows came
        // back.
        expect(error.message).not.toMatch(/hq-a|hq-b/);
      });
    });

    describe("global, deliberately RLS-free tables", () => {
      test("the migration ledger, the permission catalog, the tenant root, and the setup lock are NOT RLS-protected (asserted so an 'add RLS everywhere' sweep cannot silently break setup and every ABAC check)", async () => {
        const rows = (await getOwnerSql()`
        SELECT c.relname, c.relrowsecurity
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname IN (
            'awcms_schema_migrations', 'awcms_permissions',
            'awcms_tenants', 'awcms_setup_state'
          )
        ORDER BY c.relname
      `) as { relname: string; relrowsecurity: boolean }[];

        expect(rows.map((row) => [row.relname, row.relrowsecurity])).toEqual([
          ["awcms_permissions", false],
          ["awcms_schema_migrations", false],
          ["awcms_setup_state", false],
          ["awcms_tenants", false]
        ]);
      });
    });

    describe(`least-privilege ${APP_ROLE_NAME} role (migration 019, Issue #141)`, () => {
      /**
       * `appRoleActivated` is resolved by the harness during `beforeAll`, so it
       * cannot gate a `describe` (those bodies run at collection time, before
       * any hook). Each test checks it and returns early with an explanation
       * instead — a clean, visible skip rather than a hard failure, per the
       * requirement that #141 not being merged must not redden this suite.
       */
      function skipUnlessAppRole(): boolean {
        if (appRoleActivated) {
          return false;
        }

        console.warn(
          `[skip] role "${APP_ROLE_NAME}" does not exist — migration ` +
            `019_awcms_db_role_separation.sql (Issue #141) is not present. ` +
            `These assertions activate automatically once it lands; nothing ` +
            `in this file needs to change.`
        );
        return true;
      }

      test(`${APP_ROLE_NAME} is NOSUPERUSER/NOBYPASSRLS and does NOT own the tables — otherwise FORCE RLS would be decorative`, async () => {
        if (skipUnlessAppRole()) return;

        const rows = (await getAppRoleSql()`
        SELECT rolname, rolsuper, rolbypassrls
        FROM pg_roles WHERE rolname = current_user
      `) as { rolname: string; rolsuper: boolean; rolbypassrls: boolean }[];

        expect(rows[0]?.rolname).toBe(APP_ROLE_NAME);
        expect(rows[0]?.rolsuper).toBe(false);
        expect(rows[0]?.rolbypassrls).toBe(false);

        const owner = (await getAppRoleSql()`
        SELECT tableowner FROM pg_tables WHERE tablename = 'awcms_offices'
      `) as { tableowner: string }[];

        expect(owner[0]?.tableowner).not.toBe(APP_ROLE_NAME);
      });

      test(`${APP_ROLE_NAME} is subject to RLS: cross-tenant offices are invisible`, async () => {
        if (skipUnlessAppRole()) return;
        await seedTwoTenants();

        const rows = await withTenant(getAppRoleSql(), TENANT_A, async (tx) => {
          return (await tx`
          SELECT office_code FROM awcms_offices ORDER BY office_code
        `) as { office_code: string }[];
        });

        expect(rows.map((row) => row.office_code)).toEqual(["hq-a"]);
      });

      test(`${APP_ROLE_NAME} with NO tenant context reads ZERO rows rather than erroring — migration 019's all-zero app.current_tenant_id default is what makes a missing SET LOCAL "no data" instead of a 500`, async () => {
        if (skipUnlessAppRole()) return;
        await seedTwoTenants();

        // Deliberately outside `withTenant`, so no `SET LOCAL` ever runs. This
        // is the assertion that distinguishes the app role's fail-closed
        // backstop from the owner's fail-loud one (see the owner test above,
        // which asserts the opposite outcome for the opposite reason).
        const guc = (await getAppRoleSql()`
        SELECT current_setting('app.current_tenant_id') AS tenant_id
      `) as { tenant_id: string }[];

        expect(guc[0]?.tenant_id).toBe("00000000-0000-0000-0000-000000000000");

        const rows = (await getAppRoleSql()`
        SELECT office_code FROM awcms_offices
      `) as { office_code: string }[];

        expect(rows).toEqual([]);
      });

      test(`${APP_ROLE_NAME} holds DML but never DDL/ownership on a tenant-scoped table`, async () => {
        if (skipUnlessAppRole()) return;

        const rows = (await getAdminSql()`
        SELECT
          has_table_privilege(${APP_ROLE_NAME}, 'awcms_offices', 'SELECT') AS can_select,
          has_table_privilege(${APP_ROLE_NAME}, 'awcms_offices', 'INSERT') AS can_insert,
          has_table_privilege(${APP_ROLE_NAME}, 'awcms_offices', 'UPDATE') AS can_update,
          has_table_privilege(${APP_ROLE_NAME}, 'awcms_offices', 'DELETE') AS can_delete,
          has_schema_privilege(${APP_ROLE_NAME}, 'public', 'CREATE') AS can_create_in_schema
      `) as {
          can_select: boolean;
          can_insert: boolean;
          can_update: boolean;
          can_delete: boolean;
          can_create_in_schema: boolean;
        }[];

        expect(rows[0]?.can_select).toBe(true);
        expect(rows[0]?.can_insert).toBe(true);
        expect(rows[0]?.can_update).toBe(true);
        expect(rows[0]?.can_delete).toBe(true);
        // No DDL: the app must never be able to create a table, and — more to
        // the point — must never be able to `ALTER TABLE ... DISABLE ROW LEVEL
        // SECURITY` its way out of the isolation boundary.
        expect(rows[0]?.can_create_in_schema).toBe(false);
      });

      test(`${APP_ROLE_NAME} cannot DROP or ALTER a table it does not own (RLS cannot be turned off from the runtime connection)`, async () => {
        if (skipUnlessAppRole()) return;

        const error = await assertRejected(
          getAppRoleSql().unsafe(
            `ALTER TABLE awcms_offices NO FORCE ROW LEVEL SECURITY`
          ),
          "the runtime role turning FORCE RLS off"
        );

        expect(error.message).toMatch(/must be owner|permission denied/i);
      });

      test(`ALTER DEFAULT PRIVILEGES (migration 019 §4) means a table created LATER by the owner is automatically reachable by ${APP_ROLE_NAME} — so a new tenant-scoped table cannot ship unreachable at runtime`, async () => {
        if (skipUnlessAppRole()) return;

        // Mimics exactly what migration 021+ would do: the OWNER creates a new
        // table, with no explicit GRANT of its own.
        await getOwnerSql().unsafe(
          `CREATE TABLE awcms_default_privileges_probe (id int PRIMARY KEY)`
        );

        try {
          const rows = (await getAdminSql()`
          SELECT has_table_privilege(${APP_ROLE_NAME}, 'awcms_default_privileges_probe', 'SELECT') AS can_select
        `) as { can_select: boolean }[];

          expect(rows[0]?.can_select).toBe(true);
        } finally {
          await getOwnerSql().unsafe(
            `DROP TABLE IF EXISTS awcms_default_privileges_probe`
          );
        }
      });
    });
  }
);
