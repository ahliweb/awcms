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
  }
);
