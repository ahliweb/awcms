/**
 * `hr-commission:intents:post` (Issue #1189, Issue #1211, ADR-0147 section 3):
 * the job body. Runs on the APP client: this is the only scheduled job that holds
 * the payroll privileges.
 *
 * - Idle tenants (neither `commission_intake_enabled` nor any rows in
 *   `awcms_hr_commission_intents`) are skipped up front via the narrow
 *   `awcms_hr_commission_intake_non_idle_tenants()` discovery function and cost
 *   zero tenant transactions per tick (Issue #1211).
 * - Non-idle tenants are drained in round-robin single-batch passes (`1` pass of
 *   up to `claimBatch` rows per tenant per round, up to `maxPasses` rounds), so a
 *   flood in one tenant cannot starve another tenant's rows (Issue #1211).
 * - One tenant failing never stops the others; a tenant that throws is counted and
 *   the run ends `partial` so the exit code is non-zero.
 */
import { fetchActiveTenants } from "../../../lib/jobs/batching";
import { log } from "../../../lib/logging/logger";
import { INTAKE_CLAIM_BATCH } from "../domain/hr-commission-intake";
import {
  describeError,
  emptyPosterResult,
  runIntakePosterForTenant,
  settled,
  type PosterOptions,
  type PosterTenantResult
} from "./hr-commission-intake-poster";

const DEFAULT_JOB_MAX_PASSES = 20;

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

async function fetchNonIdleTenants(sql: Bun.SQL): Promise<Set<string>> {
  const rows = (await sql`
    SELECT tenant_id
    FROM awcms_hr_commission_intake_non_idle_tenants()
  `) as { tenant_id: string }[];

  return new Set(rows.map((row) => row.tenant_id));
}

export async function runIntakePosterJob(
  sql: Bun.SQL,
  options: PosterOptions & {
    signal?: AbortSignal;
    stalledAfterSeconds?: number;
  }
): Promise<IntakeJobSummary> {
  const tenants = await fetchActiveTenants(sql);
  const nonIdle = await fetchNonIdleTenants(sql);
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
  const batch = options.claimBatch ?? INTAKE_CLAIM_BATCH;
  const maxPasses = options.maxPasses ?? DEFAULT_JOB_MAX_PASSES;
  const candidateTenants: { id: string }[] = [];

  for (const tenant of tenants) {
    if (options.signal?.aborted) {
      summary.aborted = true;
      break;
    }

    if (!nonIdle.has(tenant.id)) {
      summary.tenantsChecked += 1;
      summary.tenantsSkipped += 1;
      continue;
    }

    candidateTenants.push(tenant);
  }

  if (summary.aborted || candidateTenants.length === 0) {
    return summary;
  }

  const perTenantResults = new Map<string, PosterTenantResult>();
  let activeRoundTenants = candidateTenants;

  for (
    let pass = 0;
    pass < maxPasses && activeRoundTenants.length > 0;
    pass += 1
  ) {
    const nextRoundTenants: { id: string }[] = [];

    for (const tenant of activeRoundTenants) {
      if (options.signal?.aborted) {
        summary.aborted = true;
        break;
      }

      if (pass === 0) {
        summary.tenantsChecked += 1;
      }

      const run = await settled(() =>
        runIntakePosterForTenant(sql, tenant.id, {
          ...options,
          maxPasses: 1,
          skipPurge: pass > 0
        })
      );

      if (!run.ok) {
        summary.tenantsErrored += 1;
        perTenantResults.delete(tenant.id);
        log("error", "hr_commission.intake.tenant_error", {
          tenantId: tenant.id,
          ...describeError(run.error)
        });
        continue;
      }

      const result = run.value;
      const accumulated =
        perTenantResults.get(tenant.id) ?? emptyPosterResult();

      accumulated.skipped = result.skipped;
      accumulated.intakeActor = result.intakeActor;
      accumulated.claimed += result.claimed;
      accumulated.posted += result.posted;
      accumulated.refused += result.refused;
      accumulated.failed += result.failed;
      accumulated.retried += result.retried;
      accumulated.deferred += result.deferred;
      accumulated.purged += result.purged;
      accumulated.oldestLiveAgeSeconds = result.oldestLiveAgeSeconds;
      perTenantResults.set(tenant.id, accumulated);

      if (
        !options.dryRun &&
        result.skipped === null &&
        result.claimed >= batch
      ) {
        nextRoundTenants.push(tenant);
      }
    }

    if (summary.aborted) {
      break;
    }

    activeRoundTenants = nextRoundTenants;
  }

  for (const result of perTenantResults.values()) {
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
