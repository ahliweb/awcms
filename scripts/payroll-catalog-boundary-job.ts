/**
 * payroll-catalog-boundary-job.ts - `bun run payroll:catalog-boundary:job`.
 *
 * Issue #1095 (owner decision K3 of 2026-11-22); `docs/awcms/hr-payroll.md`
 * section 13.3 and `docs/awcms/payroll-catalog-boundary-job.md`.
 *
 * The SCHEDULED form of `payroll:catalog-boundary:check`: once a day it reads
 * the catalog of the DEPLOYED database and fails when a view, rule, function,
 * trigger or grant reaches a payroll table from outside the payroll family
 * (the rule and its limits are in `scripts/lib/payroll-catalog-boundary.ts`).
 *
 * ## It runs as its own role, `awcms_catalog_boundary_audit` (sql/420)
 *
 * Connected through `PAYROLL_CATALOG_AUDIT_DATABASE_URL`, with NO fallback: the
 * role holds CONNECT and nothing else (the catalog is readable by every role),
 * so the login that leaks from a cron container cannot read a single data row.
 * The runner withholds `DATABASE_URL`, `WORKER_DATABASE_URL` and
 * `SETUP_DATABASE_URL` from it unconditionally (`dedicatedRoleTargets`), the job
 * refuses to start if one is present, and it refuses unless the server confirms
 * it is that role.
 *
 * ## Loud, not silent
 *
 * It exits non-zero (the runner and cron mail/alert on that) on a finding, on a
 * refused connection, and on `PAYROLL_EXPECTED_OWNERS` missing from a split-role
 * deployment (the message names the variable). A passing run prints one line, so
 * "the job ran and found nothing" is distinguishable in the log from "the job
 * did not run".
 */
import {
  assertConnectedAsPayrollCatalogAuditRole,
  assertNoSharedLogins,
  getPayrollCatalogAuditDatabaseClient,
  isPayrollCatalogAuditActivated
} from "../src/lib/database/payroll-catalog-audit-client";
import { safeErrorDetail } from "../src/lib/logging/error-sanitizer";
import { log } from "../src/lib/logging/logger";
import {
  runPayrollCatalogCheck,
  type PayrollCatalogRunResult
} from "./lib/payroll-catalog-check-run";

const MODULE_KEY = "hr_commission";
const JOB = "payroll:catalog-boundary:job";

/** The audit role's own connection, or `null` (logged at error level, exit 1): never a broader fallback. */
async function openAuditConnection(): Promise<Bun.SQL | null> {
  try {
    assertNoSharedLogins();

    const connection = getPayrollCatalogAuditDatabaseClient();

    await assertConnectedAsPayrollCatalogAuditRole(connection);

    return connection;
  } catch (error) {
    log("error", "payroll.catalog_boundary.job_refused", {
      moduleKey: MODULE_KEY,
      job: JOB,
      reason: safeErrorDetail(error)
    });
    process.exitCode = 1;

    return null;
  }
}

/**
 * Every outcome is a structured line from the repo logger, so a log shipper
 * filtering on `level: "error"` sees a drift alarm: one line per finding and one
 * summary line (a bare `console.error` text line is not picked up by a JSON
 * pipeline).
 */
function report(result: PayrollCatalogRunResult): void {
  if (result.ok) {
    log("info", "payroll.catalog_boundary.ok", {
      moduleKey: MODULE_KEY,
      job: JOB,
      summary: result.lines[0]
    });

    return;
  }

  for (const finding of result.findings) {
    log("error", "payroll.catalog_boundary.finding", {
      moduleKey: MODULE_KEY,
      job: JOB,
      code: finding.code,
      object: finding.object,
      detail: finding.message
    });
  }

  for (const object of result.staleExemptions) {
    log("error", "payroll.catalog_boundary.stale_exemption", {
      moduleKey: MODULE_KEY,
      job: JOB,
      object
    });
  }

  log("error", "payroll.catalog_boundary.failed", {
    moduleKey: MODULE_KEY,
    job: JOB,
    findingCount: result.findings.length,
    staleExemptionCount: result.staleExemptions.length,
    expectedOwnersMissing: result.expectedOwnersMissing,
    summary: result.lines[0]
  });
  process.exitCode = 1;
}

async function main(): Promise<void> {
  // Not activated: the operator has not given the role a login and set the URL.
  // Exit 0 with an explicit line (a deployment must be able to ship the job before
  // it is activated); `security:readiness` warns about the same state. A URL that
  // IS set but wrong is refused below, and exits 1.
  if (!isPayrollCatalogAuditActivated()) {
    log("warning", "payroll.catalog_boundary.skipped_not_activated", {
      moduleKey: MODULE_KEY,
      job: JOB,
      detail: `${JOB} SKIPPED (not activated): PAYROLL_CATALOG_AUDIT_DATABASE_URL is not set, so no daily payroll drift check ran`
    });
    console.log(`${JOB} SKIPPED (not activated)`);

    return;
  }

  const connection = await openAuditConnection();

  if (connection === null) return;

  const result = await runPayrollCatalogCheck(
    connection,
    { PAYROLL_EXPECTED_OWNERS: process.env.PAYROLL_EXPECTED_OWNERS },
    { requireOwnersOnSplitRole: true }
  )
    .catch((error: unknown) => {
      log("error", "payroll.catalog_boundary.job_failed", {
        moduleKey: MODULE_KEY,
        job: JOB,
        reason: safeErrorDetail(error)
      });
      process.exitCode = 1;

      return null;
    })
    .finally(() => connection.close());

  if (result !== null) report(result);
}

if (import.meta.main) {
  await main();
}
