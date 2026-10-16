/**
 * The payroll boundary read from a REAL migrated catalog (Issue #1015, M-B).
 *
 * `payroll:sql-boundary:check` reads migration text; this reads `pg_catalog`
 * after every migration has run, which is the only place a run-time name, a
 * rename, a function chain or a grant cannot hide. Three things are proved:
 *
 *   1. BASELINE: the repository's own migrated database has no object outside
 *      the payroll family that reaches a payroll table, and no grant outside
 *      the allowed roles.
 *   2. PROBES: every evasion the #978 re-audit wrote (plus the ones only the
 *      catalog can see) is applied inside a transaction that is rolled back,
 *      the catalog is read INSIDE that transaction, and the expected finding
 *      codes must be present. Each probe is also run through the static gate
 *      so the two layers' coverage is pinned side by side.
 *   3. CLEAN TWINS: the same shapes kept inside the payroll family produce no
 *      finding, so the check is not simply red about everything.
 *
 * Gated on `DATABASE_URL` (harness section Gating).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  getAdminSql,
  integrationEnabled,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import {
  analysePayrollCatalog,
  loadPayrollCatalogSnapshot,
  staleCatalogExemptions,
  type CatalogFinding
} from "../../scripts/lib/payroll-catalog-boundary";
import { findPayrollSqlLeaks } from "../../scripts/payroll-sql-boundary-check";
import { splitSqlStatements } from "../../scripts/lib/sql-statements";
import {
  PAYROLL_BOUNDARY_CLEAN_TWINS,
  PAYROLL_BOUNDARY_PROBES
} from "../fixtures/payroll-boundary-probes";

class Rollback extends Error {}

type Tag = Parameters<typeof loadPayrollCatalogSnapshot>[0];

/** Apply `sql` in a transaction, read the catalog inside it, then roll everything back. */
async function findingsAfter(
  sql: string,
  workerExecuteAllowlist: string[] = []
): Promise<CatalogFinding[]> {
  let findings: CatalogFinding[] = [];

  try {
    await getAdminSql().begin(async (tx) => {
      for (const statement of splitSqlStatements(sql)) {
        await tx.unsafe(statement);
      }

      // The probe objects are created by the admin connection, which is not the
      // role that ran the migrations; that role is the expected owner here.
      const [me] = (await tx`SELECT current_user::text AS name`) as {
        name: string;
      }[];

      const snapshot = await loadPayrollCatalogSnapshot(tx as unknown as Tag);

      // A probe that removes the migration ledger must see "no expected owner".
      findings = analysePayrollCatalog(snapshot, {
        workerExecuteAllowlist,
        expectedOwners: snapshot.migrationOwner === null ? [] : [me!.name]
      });

      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }

  return findings;
}

const suite = integrationEnabled ? describe : describe.skip;

suite("payroll catalog boundary (Issue #1015)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  test("baseline: the migrated database is clean, and the probes' target table is a payroll table", async () => {
    const snapshot = await loadPayrollCatalogSnapshot(
      getAdminSql() as unknown as Tag
    );

    // The premise: the accrual ledger exists and is what the probes attack.
    expect(
      snapshot.grants.some(
        (grant) => grant.relation === "public.awcms_hr_commission_accruals"
      )
    ).toBe(true);
    expect(snapshot.functions.length).toBeGreaterThan(50);
    expect(snapshot.triggers.length).toBeGreaterThan(20);

    expect(analysePayrollCatalog(snapshot)).toEqual([]);
    expect(staleCatalogExemptions(snapshot)).toEqual([]);
  });

  test.each(PAYROLL_BOUNDARY_PROBES.map((probe) => [probe.id, probe] as const))(
    "probe %s",
    async (_id, probe) => {
      const found = (await findingsAfter(probe.sql)).map(
        (finding) => finding.code
      );

      if (probe.catalogCodes.length === 0) {
        // Honest limit: a one-shot copy leaves no dependency to read.
        expect(found).toEqual([]);
      } else {
        for (const code of probe.catalogCodes) expect(found).toContain(code);
      }

      // At least one layer holds every probe.
      const staticFailures = findPayrollSqlLeaks([
        { name: "999_probe.sql", sql: probe.sql }
      ]);

      expect(staticFailures.length > 0 || found.length > 0).toBe(true);
      expect(staticFailures.length > 0).toBe(probe.staticCaught);
    }
  );

  test.each(
    PAYROLL_BOUNDARY_CLEAN_TWINS.map((twin) => [twin.id, twin] as const)
  )("clean twin %s: no finding", async (_id, twin) => {
    expect(
      await findingsAfter(twin.sql, twin.workerExecuteAllowlist ?? [])
    ).toEqual([]);
  });

  test("a probe leaves nothing behind (the transaction really rolled back)", async () => {
    await findingsAfter(PAYROLL_BOUNDARY_PROBES[0]!.sql);

    const rows = (await getAdminSql()`
      SELECT count(*)::int AS n FROM pg_class WHERE relname LIKE 'awcms\\_probe\\_%'
    `) as { n: number }[];

    expect(rows[0]!.n).toBe(0);
  });
});
