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
 * CI `integration-shards` job (shard 1) executes; this command is the operator form
 * ("is THIS database clean"), for a restored database or an ad-hoc run.
 *
 * The SCHEDULED form against the deployed database is a different command,
 * `payroll:catalog-boundary:job` (Issue #1095), which connects as its own
 * least-privilege role instead of `DATABASE_URL`.
 */
import { runPayrollCatalogCheck } from "./lib/payroll-catalog-check-run";

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
    const result = await runPayrollCatalogCheck(sql, {
      PAYROLL_EXPECTED_OWNERS: process.env.PAYROLL_EXPECTED_OWNERS
    });

    if (!result.ok) {
      for (const line of result.lines) console.error(line);
      process.exitCode = 1;
      return;
    }

    for (const line of result.lines) console.log(line);
  } finally {
    await sql.close();
  }
}

if (import.meta.main) {
  await main();
}
