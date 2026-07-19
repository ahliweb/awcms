/**
 * DB-gated family-conformance contract tests (Issue #183, epic #177, ADR-0032).
 *
 * The half of the family contract that can only be proven against real
 * PostgreSQL: tenant-context FAIL-CLOSED isolation under `FORCE ROW LEVEL
 * SECURITY`, and the FORCE-RLS invariant across the whole migrated schema. A
 * stubbed driver would prove nothing — fail-open/fail-closed is a property of
 * PostgreSQL itself (same reasoning as `security-readiness-rls.test.ts`).
 *
 * Gated on `DATABASE_URL` (skips cleanly in the no-DB `quality` job). Runs in
 * the SAME dedicated `bun test <legacy files>` step as the other ad-hoc DB
 * suites in `ci.yml`'s `integration-tests` job AND `release.yml`'s `validate`
 * job — listed explicitly there so it can't silently drop out (see the
 * two-DB-suite collision note in those workflows).
 *
 * The RLS probe uses its OWN throwaway table and drops it again; it only
 * flips `awcms_app` to LOGIN for the duration and restores NOLOGIN in a
 * `finally`, matching the MFA/OIDC RLS-under-awcms_app pattern.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { checkRlsEnabled } from "../scripts/security-readiness";

const DATABASE_URL = process.env.DATABASE_URL;
const describeOrSkip = DATABASE_URL ? describe : describe.skip;

const PROBE_TABLE = "awcms_family_conf_rls_probe";

function awcmsAppUrl(base: string, password: string): string {
  const url = new URL(base);
  url.username = "awcms_app";
  url.password = password;
  return url.toString();
}

describeOrSkip(
  "family conformance — tenant-context fail-closed under RLS",
  () => {
    let admin: Bun.SQL;
    let appExists = false;
    let appLoginSecret = "";
    const tenantA = crypto.randomUUID();
    const tenantB = crypto.randomUUID();

    beforeAll(async () => {
      admin = new Bun.SQL(DATABASE_URL!, { max: 2 });

      const roles = (await admin`
      SELECT 1 AS present FROM pg_roles WHERE rolname = 'awcms_app'
    `) as { present: number }[];
      appExists = roles.length > 0;

      await admin.unsafe(`DROP TABLE IF EXISTS ${PROBE_TABLE}`);
      await admin.unsafe(`
      CREATE TABLE ${PROBE_TABLE} (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        note text NOT NULL
      )
    `);
      await admin.unsafe(
        `ALTER TABLE ${PROBE_TABLE} ENABLE ROW LEVEL SECURITY`
      );
      await admin.unsafe(`ALTER TABLE ${PROBE_TABLE} FORCE ROW LEVEL SECURITY`);
      await admin.unsafe(`
      CREATE POLICY ${PROBE_TABLE}_tenant_isolation ON ${PROBE_TABLE}
        USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    `);
      // Superuser bypasses RLS, so these seed rows land regardless of any GUC.
      await admin.unsafe(
        `INSERT INTO ${PROBE_TABLE} (tenant_id, note) VALUES ('${tenantA}', 'a1'), ('${tenantA}', 'a2'), ('${tenantB}', 'b1')`
      );

      if (appExists) {
        appLoginSecret = `probe_${Math.random().toString(36).slice(2)}${Math.random()
          .toString(36)
          .slice(2)}`;
        await admin.unsafe(
          `ALTER ROLE awcms_app LOGIN PASSWORD '${appLoginSecret}'`
        );
        await admin.unsafe(`GRANT SELECT ON ${PROBE_TABLE} TO awcms_app`);
      }
    });

    afterAll(async () => {
      try {
        await admin.unsafe(`DROP TABLE IF EXISTS ${PROBE_TABLE}`);
      } finally {
        if (appExists) {
          // Restore the shared cluster-wide role to its default NOLOGIN state.
          await admin.unsafe(`ALTER ROLE awcms_app NOLOGIN`);
        }
        await admin.close({ timeout: 1 });
      }
    });

    test("FORCE RLS invariant holds across the migrated schema", async () => {
      const result = await checkRlsEnabled();
      // Weakening FORCE on any real tenant-scoped table would flip this to fail —
      // that is the FORCE-RLS family contract turning the suite RED.
      expect(result.status).toBe("pass");
      expect(result.evidence).toContain("relforcerowsecurity=true");
    });

    test("a tenant only sees its own rows; no GUC sees ZERO rows (fail-closed)", async () => {
      if (!appExists) {
        // Pre-sql/019 database without the least-privilege role: the fail-closed
        // proof needs a NON-superuser connection (superuser bypasses RLS). Skip
        // rather than assert a scenario we cannot construct here.
        return;
      }

      const app = new Bun.SQL(awcmsAppUrl(DATABASE_URL!, appLoginSecret), {
        max: 1
      });
      try {
        await app.unsafe(`SET app.current_tenant_id = '${tenantA}'`);
        const aRows = (await app.unsafe(
          `SELECT note FROM ${PROBE_TABLE} ORDER BY note`
        )) as { note: string }[];
        expect(aRows.map((r) => r.note)).toEqual(["a1", "a2"]);

        await app.unsafe(`SET app.current_tenant_id = '${tenantB}'`);
        const bRows = (await app.unsafe(`SELECT note FROM ${PROBE_TABLE}`)) as {
          note: string;
        }[];
        expect(bRows.map((r) => r.note)).toEqual(["b1"]);

        // No tenant context at all -> the policy compares against NULL -> zero
        // rows. Fail-CLOSED: absence of a tenant GUC never opens the table.
        await app.unsafe(`RESET app.current_tenant_id`);
        const noGuc = (await app.unsafe(
          `SELECT count(*)::int AS n FROM ${PROBE_TABLE}`
        )) as { n: number }[];
        expect(noGuc[0]!.n).toBe(0);
      } finally {
        await app.close({ timeout: 1 });
      }
    });

    test("MUTATION: a fail-OPEN policy leaks all rows without a GUC (proves the guard bites)", async () => {
      if (!appExists) return;

      const app = new Bun.SQL(awcmsAppUrl(DATABASE_URL!, appLoginSecret), {
        max: 1
      });
      try {
        // Baseline (correct policy): no GUC -> 0 rows.
        await app.unsafe(`RESET app.current_tenant_id`);
        const before = (await app.unsafe(
          `SELECT count(*)::int AS n FROM ${PROBE_TABLE}`
        )) as { n: number }[];
        expect(before[0]!.n).toBe(0);

        // Weaken the isolation policy to fail-open, as a real RLS regression would.
        await admin.unsafe(
          `ALTER POLICY ${PROBE_TABLE}_tenant_isolation ON ${PROBE_TABLE} USING (true)`
        );

        // Now the SAME "no GUC" query leaks every tenant's rows — demonstrating
        // that the fail-closed "0 rows" assertion above is a real guard, not a
        // vacuous one.
        const after = (await app.unsafe(
          `SELECT count(*)::int AS n FROM ${PROBE_TABLE}`
        )) as { n: number }[];
        expect(after[0]!.n).toBe(3);
      } finally {
        // Restore the correct fail-closed policy before the table is dropped.
        await admin.unsafe(
          `ALTER POLICY ${PROBE_TABLE}_tenant_isolation ON ${PROBE_TABLE} USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)`
        );
        await app.close({ timeout: 1 });
      }
    });
  }
);
