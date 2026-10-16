/**
 * payroll-catalog-boundary-check.ts - `bun run payroll:catalog-boundary:check`.
 *
 * Issue #1015 (M-B); `docs/awcms/hr-payroll.md` section 13.3.
 *
 * The catalog half of the payroll SQL boundary: it connects to a database where
 * every migration has run (`DATABASE_URL`) and fails when a view, rule,
 * function, trigger or grant reaches a payroll table from outside the payroll
 * family. The rule and its limits are in `scripts/lib/payroll-catalog-boundary.ts`.
 *
 * It is NOT in `bun run check` (that chain runs with no database). The same
 * analysis runs, with the probes that prove it, in
 * `tests/integration/payroll-catalog-boundary.integration.test.ts`, which the
 * CI `integration-tests` job executes; this command is the operator form
 * ("is THIS database clean"), for a deployed or restored database.
 */
import { PAYROLL_EXPECTED_OWNERS } from "../src/modules/_shared/payroll-data-boundary";
import {
  analysePayrollCatalog,
  loadPayrollCatalogSnapshot,
  staleCatalogExemptions
} from "./lib/payroll-catalog-boundary";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;

  if (!url) {
    console.error(
      "payroll:catalog-boundary:check needs DATABASE_URL (a database where every migration has run). It is the catalog layer; the static layer is payroll:sql-boundary:check."
    );
    process.exitCode = 1;
    return;
  }

  const sql = new Bun.SQL(url);

  try {
    const snapshot = await loadPayrollCatalogSnapshot(
      sql as unknown as Parameters<typeof loadPayrollCatalogSnapshot>[0]
    );
    // Split-role deployments (migrations run by one role, payroll objects owned
    // by another) name the owner role(s) here; the default is the owner of the
    // migration ledger (docs/awcms/hr-payroll.md section 13.3).
    const configuredOwners = (process.env.PAYROLL_EXPECTED_OWNERS ?? "")
      .split(",")
      .map((owner) => owner.trim())
      .filter(Boolean);
    const findings = analysePayrollCatalog(snapshot, {
      expectedOwners: [...PAYROLL_EXPECTED_OWNERS, ...configuredOwners]
    });
    const stale = staleCatalogExemptions(snapshot);

    if (findings.length > 0 || stale.length > 0) {
      console.error("payroll:catalog-boundary:check FAILED -");

      for (const finding of findings) {
        console.error(`  - [${finding.code}] ${finding.message}`);
      }

      for (const object of stale) {
        console.error(
          `  - stale PAYROLL_CATALOG_EXEMPTIONS entry: ${object} no longer exists.`
        );
      }

      process.exitCode = 1;
      return;
    }

    console.log(
      `payroll:catalog-boundary:check OK - ${snapshot.rules.length} rule(s), ${snapshot.functions.length} function(s), ${snapshot.triggers.length} trigger(s), ${snapshot.grants.length} grant(s), ${snapshot.relations.length} relation(s), ${snapshot.memberships.length} role membership(s), ${snapshot.publications.length} publication(s), ${snapshot.foreignTables.length} foreign table(s) and ${snapshot.dependencies.length} dependency row(s) read from the catalog; nothing outside the payroll family reaches a payroll table.`
    );
  } finally {
    await sql.close();
  }
}

if (import.meta.main) {
  await main();
}
