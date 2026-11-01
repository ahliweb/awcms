/**
 * `hr-commission:intents:post` (Issue #1189, ADR-0147 section 3): the job body.
 * Every active tenant in turn, through `runIntakePosterForTenant`, on the APP
 * client: this is the only scheduled job that holds the payroll privileges.
 *
 * One tenant failing never stops the others; a tenant that throws is counted and
 * the run ends `partial` so the exit code is non-zero.
 */
import { fetchActiveTenants } from "../../../lib/jobs/batching";
import { log } from "../../../lib/logging/logger";
import {
  describeError,
  runIntakePosterForTenant,
  settled,
  type PosterOptions
} from "./hr-commission-intake-poster";

export type IntakeJobTotals = {
  claimed: number;
  posted: number;
  refused: number;
  failed: number;
  retried: number;
  deferred: number;
  purged: number;
  stalledTenants: number;
};

export type IntakeJobSummary = {
  tenantsChecked: number;
  tenantsSkipped: number;
  tenantsErrored: number;
  aborted: boolean;
  totals: IntakeJobTotals;
};

export async function runIntakePosterJob(
  sql: Bun.SQL,
  options: PosterOptions & {
    signal?: AbortSignal;
    stalledAfterSeconds?: number;
  }
): Promise<IntakeJobSummary> {
  const tenants = await fetchActiveTenants(sql);
  const summary: IntakeJobSummary = {
    tenantsChecked: 0,
    tenantsSkipped: 0,
    tenantsErrored: 0,
    aborted: false,
    totals: {
      claimed: 0,
      posted: 0,
      refused: 0,
      failed: 0,
      retried: 0,
      deferred: 0,
      purged: 0,
      stalledTenants: 0
    }
  };
  const stalledAfter = options.stalledAfterSeconds ?? 900;

  for (const tenant of tenants) {
    if (options.signal?.aborted) {
      summary.aborted = true;
      break;
    }

    summary.tenantsChecked += 1;

    const run = await settled(() =>
      runIntakePosterForTenant(sql, tenant.id, options)
    );

    if (!run.ok) {
      summary.tenantsErrored += 1;
      log("error", "hr_commission.intake.tenant_error", {
        tenantId: tenant.id,
        ...describeError(run.error)
      });
      continue;
    }

    const result = run.value;

    if (result.skipped !== null) {
      summary.tenantsSkipped += 1;
    }

    summary.totals.claimed += result.claimed;
    summary.totals.posted += result.posted;
    summary.totals.refused += result.refused;
    summary.totals.failed += result.failed;
    summary.totals.retried += result.retried;
    summary.totals.deferred += result.deferred;
    summary.totals.purged += result.purged;

    if (
      result.skipped === null &&
      result.oldestLiveAgeSeconds !== null &&
      result.oldestLiveAgeSeconds > stalledAfter
    ) {
      summary.totals.stalledTenants += 1;
    }
  }

  return summary;
}
