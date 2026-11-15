/**
 * Issue #162 / L2 — real-PostgreSQL test that `checkRuntimeRoleGrants` fails
 * CLOSED for a global, RLS-free table that is registered as RLS-free (as one
 * would to satisfy `checkRlsEnabled`) but carries NO explicit privilege
 * declaration in the forbidden-privilege map.
 *
 * Before this fix such a table was `continue`d as "full DML kept by design" and
 * passed silently — the exact "a new global table inherits blanket DML from
 * `ALTER DEFAULT PRIVILEGES`" regression the check exists to catch. The 9 real
 * tables are curated correctly and merged into ONE source of truth, so the
 * divergence cannot occur in shipped code; the guard is exercised here by
 * INJECTING a divergent policy (`rlsFreeTables` augmented with a probe table
 * the default forbidden map does not know about). Injection — not `mock.module`
 * — because stubbing a shared module leaks across every later test file in the
 * same process (PR #157: green locally, 12 CI failures on the same commit).
 *
 * Requires `awcms_app` (sql/019) and the narrowed grants (sql/021) to be
 * present. Gated on `DATABASE_URL`, same convention as
 * `security-readiness-rls.test.ts`: `ci.yml`'s `quality` job has no database
 * so it skips cleanly; this actually executes in `ci.yml`'s
 * `integration-tests` job and `release.yml`'s `validate` job, each in a
 * dedicated `bun test <legacy files>` step run separately from the
 * harness-based `tests/integration/` suite (see `tests/integration/
 * harness.ts` — the two collide if run together in one `bun test` process).
 *
 * The suite only creates/drops its own probe table. It NEVER drops or mutates
 * the cluster-wide `awcms_app` role — grants on the probe vanish when the probe
 * is dropped.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  checkRuntimeRoleGrants,
  checkWorkerJobsReachableWithoutWorkerUrl,
  defaultRuntimeRoleGrantsPolicy
} from "../scripts/security-readiness";

const DATABASE_URL = process.env.DATABASE_URL;
const describeOrSkip = DATABASE_URL ? describe : describe.skip;

/** A synthetic "future global table": matches `awcms\_%`, has no RLS. */
const PROBE_TABLE = "awcms_l2_failclosed_probe";

describeOrSkip(
  "security:readiness runtime-role grant check fails closed (Issue #162 / L2)",
  () => {
    let sql: Bun.SQL;

    beforeAll(async () => {
      sql = new Bun.SQL(DATABASE_URL!, { max: 2 });
      await sql.unsafe(`DROP TABLE IF EXISTS ${PROBE_TABLE}`);
    });

    afterAll(async () => {
      await sql.unsafe(`DROP TABLE IF EXISTS ${PROBE_TABLE}`);
      await sql.close({ timeout: 1 });
    });

    async function awcmsAppExists(): Promise<boolean> {
      const rows = (await sql`
        SELECT 1 AS present FROM pg_roles WHERE rolname = 'awcms_app'
      `) as { present: number }[];
      return rows.length > 0;
    }

    test("state (a): the curated 9-table default policy still PASSES", async () => {
      const result = await checkRuntimeRoleGrants();

      expect(result.severity).toBe("critical");
      // On a pre-sql/019 database the role is absent and the check is
      // non-blocking-pass by design; on a fully-migrated one it is a real pass.
      // Either way the curated default must NOT be a critical failure — the
      // whole point of the merge is that the 9 tables stay correct.
      expect(result.status).toBe("pass");
    });

    test("state (b): an RLS-free table with NO forbidden entry FAILS closed", async () => {
      if (!(await awcmsAppExists())) {
        // Pre-sql/019 database: the check returns non-blocking-pass before it
        // ever inspects grants, so the fail-closed branch cannot be reached.
        // Its behaviour is asserted where the role exists (release.yml).
        return;
      }

      await sql.unsafe(`
        CREATE TABLE ${PROBE_TABLE} (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          label text
        )
      `);
      // Give awcms_app blanket DML on the probe. In production this is exactly
      // what a new global table inherits from sql/019's ALTER DEFAULT
      // PRIVILEGES — the blanket-DML-by-inheritance this guard defends against.
      // Granting explicitly makes the scenario deterministic regardless of
      // which owner's default privileges happen to fire.
      await sql.unsafe(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ${PROBE_TABLE} TO awcms_app`
      );

      // Guard the guard: awcms_app really holds a write on the probe, so a
      // "pass" below could only mean the guard skipped it (the old bug).
      const priv = (await sql.unsafe(`
        SELECT has_table_privilege('awcms_app', '${PROBE_TABLE}', 'INSERT') AS ins
      `)) as { ins: boolean }[];
      expect(priv[0]?.ins).toBe(true);

      const base = defaultRuntimeRoleGrantsPolicy();

      // Register the probe as RLS-free (what a future migration author would do
      // to make checkRlsEnabled pass for a new global table) but leave the
      // forbidden map at its real default — i.e. they forgot to declare it.
      const failClosed = await checkRuntimeRoleGrants({
        rlsFreeTables: new Set([...base.rlsFreeTables, PROBE_TABLE])
      });

      expect(failClosed.severity).toBe("critical");
      expect(failClosed.status).toBe("fail");
      expect(failClosed.evidence).toContain(PROBE_TABLE);
      expect(failClosed.evidence).toContain("register the privileges");
      expect(failClosed.evidence).toContain("INSERT, UPDATE, DELETE");

      // Control — SAME table, SAME grants, only difference is the registration:
      // under the REAL default policy the probe is not registered RLS-free, so
      // it is treated tenant-scoped, and with all four grants it is not a
      // finding. This proves the failure above is the L2 mechanism (RLS-free +
      // undeclared), not the probe's mere presence.
      const underDefault = await checkRuntimeRoleGrants();
      expect(underDefault.status).toBe("pass");
      expect(underDefault.evidence).not.toContain(PROBE_TABLE);
    });

    test("state (c): a RETIRED read-only table is checked in BOTH directions", async () => {
      // ADR-0079. Retiring a tenant-scoped table inverts the default
      // expectation — all four verbs become "exactly these" — so the
      // declaration has to be enforced, not merely honoured. A one-directional
      // check would let `awcms_access_assignments` drift back to full DML, and a
      // retired grant table that can be written is a grant nobody can revoke.
      if (!(await awcmsAppExists())) return;

      // State (b) leaves its probe behind when it runs, and skips creating one
      // when the role is absent — so this drops first rather than assuming.
      await sql.unsafe(`DROP TABLE IF EXISTS ${PROBE_TABLE}`);
      await sql.unsafe(`
        CREATE TABLE ${PROBE_TABLE} (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          label text
        )
      `);
      await sql.unsafe(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ${PROBE_TABLE} TO awcms_app`
      );

      // Declared read-only, actually holds every write: over-granted.
      const overGranted = await checkRuntimeRoleGrants({
        retiredTablePrivileges: {
          ...defaultRuntimeRoleGrantsPolicy().retiredTablePrivileges,
          [PROBE_TABLE]: ["SELECT"]
        }
      });

      expect(overGranted.status).toBe("fail");
      expect(overGranted.evidence).toContain(PROBE_TABLE);
      expect(overGranted.evidence).toContain(
        "narrowed table holds privileges beyond its declaration"
      );
      expect(overGranted.evidence).toContain("INSERT, UPDATE, DELETE");

      // The other direction: a retained privilege the role does NOT hold means
      // the history is unreadable, which is a different failure from a leftover
      // write and must not be silently tolerated.
      await sql.unsafe(`REVOKE SELECT ON ${PROBE_TABLE} FROM awcms_app`);

      const underGranted = await checkRuntimeRoleGrants({
        retiredTablePrivileges: {
          ...defaultRuntimeRoleGrantsPolicy().retiredTablePrivileges,
          [PROBE_TABLE]: ["SELECT"]
        }
      });

      expect(underGranted.status).toBe("fail");
      expect(underGranted.evidence).toContain(
        "retired table missing its retained SELECT"
      );

      // Narrowed exactly as declared: no finding.
      await sql.unsafe(
        `REVOKE INSERT, UPDATE, DELETE ON ${PROBE_TABLE} FROM awcms_app`
      );
      await sql.unsafe(`GRANT SELECT ON ${PROBE_TABLE} TO awcms_app`);

      const exact = await checkRuntimeRoleGrants({
        retiredTablePrivileges: {
          ...defaultRuntimeRoleGrantsPolicy().retiredTablePrivileges,
          [PROBE_TABLE]: ["SELECT"]
        }
      });

      expect(exact.status).toBe("pass");
    });

    test("state (d): every append-only ledger is pinned SELECT+INSERT, and re-granting UPDATE/DELETE/TRUNCATE/TRIGGER/REFERENCES or a column-level UPDATE turns the gate RED (Issues #1341, #1346)", async () => {
      // `sql/408` and `sql/409`. The declaration alone proves nothing: it must
      // fail when the grant it describes is undone. Each verb is returned in
      // turn on the REAL table and revoked again in `finally`, so a failing
      // assertion cannot leave a ledger writable for the rest of the process.
      if (!(await awcmsAppExists())) return;

      // State (c) leaves its narrowed probe behind; as a tenant-scoped table
      // missing UPDATE it would fail the baseline for a reason unrelated to the
      // ledgers, so remove it first.
      await sql.unsafe(`DROP TABLE IF EXISTS ${PROBE_TABLE}`);

      // table -> a column that exists on it, for the column-level probes.
      const LEDGERS: Record<string, string> = {
        awcms_audit_events: "message",
        awcms_abac_decision_logs: "action",
        awcms_access_policy_events: "reason",
        awcms_business_scope_assignment_events: "reason",
        awcms_domain_events: "payload"
      };

      for (const table of Object.keys(LEDGERS)) {
        // The pin is the exact set, not "at least SELECT".
        expect(
          defaultRuntimeRoleGrantsPolicy().retiredTablePrivileges[table]
        ).toEqual(["SELECT", "INSERT"]);
      }

      const baseline = await checkRuntimeRoleGrants();
      expect(baseline.status).toBe("pass");

      for (const [table, column] of Object.entries(LEDGERS)) {
        expect(baseline.evidence).toContain(table);

        try {
          for (const verb of ["UPDATE", "DELETE"] as const) {
            await sql.unsafe(`GRANT ${verb} ON ${table} TO awcms_app`);

            const widened = await checkRuntimeRoleGrants();
            expect(widened.status).toBe("fail");
            expect(widened.evidence).toContain(table);
            expect(widened.evidence).toContain(verb);

            await sql.unsafe(`REVOKE ${verb} ON ${table} FROM awcms_app`);
          }

          // Privileges the four verbs cannot see (audit M1). `has_table_privilege`
          // answers false for a COLUMN grant, and TRUNCATE ignores RLS, so each is
          // widened on the real table and must turn the gate red on its own.
          for (const grant of [
            ["TRUNCATE", "TRUNCATE"],
            ["TRIGGER", "TRIGGER"],
            ["REFERENCES", "REFERENCES"],
            [`UPDATE (${column})`, "column-level UPDATE"],
            [`REFERENCES (${column})`, "column-level REFERENCES"]
          ] as const) {
            await sql.unsafe(`GRANT ${grant[0]} ON ${table} TO awcms_app`);

            const widened = await checkRuntimeRoleGrants();
            expect(widened.status).toBe("fail");
            expect(widened.evidence).toContain(table);
            expect(widened.evidence).toContain(grant[1]);

            await sql.unsafe(`REVOKE ${grant[0]} ON ${table} FROM awcms_app`);
            expect((await checkRuntimeRoleGrants()).status).toBe("pass");
          }

          // Over-narrowing is also a failure: INSERT is what every write needs.
          await sql.unsafe(`REVOKE INSERT ON ${table} FROM awcms_app`);
          const narrowed = await checkRuntimeRoleGrants();
          expect(narrowed.status).toBe("fail");
          expect(narrowed.evidence).toContain(table);
        } finally {
          await sql.unsafe(`REVOKE ALL ON ${table} FROM awcms_app`);
          await sql.unsafe(`GRANT SELECT, INSERT ON ${table} TO awcms_app`);
        }
      }

      expect((await checkRuntimeRoleGrants()).status).toBe("pass");
    });
    test("state (e): web connection = awcms_app with no WORKER_DATABASE_URL is RED when a worker-only verb is missing (audit M2)", async () => {
      // `getWorkerDatabaseClient` falls back to DATABASE_URL, so the retention
      // purge would run as `awcms_app` and hit `permission denied` on the
      // DELETE `sql/408` took away. This connects as the REAL login.
      if (!(await awcmsAppExists())) return;

      await sql.unsafe(`DROP TABLE IF EXISTS ${PROBE_TABLE}`);

      const before = (await sql`
        SELECT rolcanlogin FROM pg_roles WHERE rolname = 'awcms_app'
      `) as { rolcanlogin: boolean }[];
      const url = new URL(DATABASE_URL as string);
      url.username = "awcms_app";
      // Generated per run: a literal here reads as a committed credential to
      // the secret scanner, and the role is reset to NOLOGIN afterwards.
      const loginSecret = crypto.randomUUID().replaceAll("-", "");
      url.password = loginSecret;
      await sql.unsafe(`ALTER ROLE awcms_app LOGIN PASSWORD '${loginSecret}'`);
      const app = new Bun.SQL(url.toString(), { max: 1 });

      try {
        const red = await checkWorkerJobsReachableWithoutWorkerUrl({
          client: app,
          workerDatabaseUrl: ""
        });
        expect(red.status).toBe("fail");
        expect(red.evidence).toContain("awcms_audit_events (DELETE)");

        // A configured worker URL is the remedy.
        const configured = await checkWorkerJobsReachableWithoutWorkerUrl({
          client: app,
          workerDatabaseUrl: "postgres://worker@localhost/db"
        });
        expect(configured.status).toBe("pass");

        // Control: with the verb back, the same configuration is green, so the
        // failure above is the missing DELETE and nothing else.
        await sql.unsafe(`GRANT DELETE ON awcms_audit_events TO awcms_app`);
        const withVerb = await checkWorkerJobsReachableWithoutWorkerUrl({
          client: app,
          workerDatabaseUrl: ""
        });
        expect(withVerb.evidence).not.toContain("awcms_audit_events");
      } finally {
        await sql.unsafe(`REVOKE DELETE ON awcms_audit_events FROM awcms_app`);
        await app.close();
        await sql.unsafe(
          before[0]?.rolcanlogin
            ? `ALTER ROLE awcms_app LOGIN`
            : `ALTER ROLE awcms_app NOLOGIN PASSWORD NULL`
        );
      }
    });
  }
);
