/**
 * workflow-escalations-dispatch.ts — `bun run workflow:escalations:dispatch`.
 *
 * Scheduled worker that escalates workflow tasks past their `due_at` (see
 * `src/modules/workflow-approval/application/workflow-escalation.ts` for
 * the idempotency guard). Ported from awcms-mini. Built on the shared
 * worker runner (`src/lib/jobs/job-runner.ts`) — advisory lock, timeout +
 * SIGTERM/SIGINT cancellation, `--dry-run`, `--json-output=<path>`, and
 * JSON telemetry all come from `runJob`, matching
 * `domain-events-dispatch.ts`'s template exactly.
 *
 * Runs through `getWorkerDatabaseClient()` — the least-privilege
 * `awcms_worker` role (`sql/022`, Issue #163) when `WORKER_DATABASE_URL`
 * points at it, else the `DATABASE_URL` fallback (opt-in — see
 * `src/lib/database/client.ts`).
 */
import { getWorkerDatabaseClient } from "../src/lib/database/client";
import {
  fetchActiveTenants,
  iterateTenantsInBatches
} from "../src/lib/jobs/batching";
import {
  applyJobExitCode,
  formatJobOutcomeLine,
  isJobResultOk,
  parseJobCliArgs,
  printJobTelemetry,
  runJob,
  writeJobTelemetry,
  type JobContext
} from "../src/lib/jobs/job-runner";
import {
  escalateDueTasksForTenant,
  recordWorkflowBacklogGauges
} from "../src/modules/workflow-approval/application/workflow-escalation";

export type WorkflowEscalationsDispatchOptions = {
  limit?: number;
  now?: Date;
  maxPasses?: number;
};

export type WorkflowEscalationsDispatchRunResult = {
  tenantsChecked: number;
  escalated: number;
  tenantsHitPassLimit: string[];
};

/** Core logic, extracted from `main()` so integration tests can exercise it directly without spawning a subprocess (same pattern `runDomainEventsDispatch` established). */
export async function runWorkflowEscalationsDispatch(
  sql: Bun.SQL,
  ctx: Pick<JobContext, "dryRun" | "correlationId"> &
    Partial<Pick<JobContext, "signal">>,
  options: WorkflowEscalationsDispatchOptions = {}
): Promise<WorkflowEscalationsDispatchRunResult> {
  const now = options.now ?? new Date();

  if (ctx.dryRun) {
    const tenants = await fetchActiveTenants(sql);
    return {
      tenantsChecked: tenants.length,
      escalated: 0,
      tenantsHitPassLimit: []
    };
  }

  const { tenants, perTenant } = await iterateTenantsInBatches(
    sql,
    async (tenantId) => {
      const result = await escalateDueTasksForTenant(
        sql,
        tenantId,
        now,
        options.limit,
        ctx.correlationId
      );
      await recordWorkflowBacklogGauges(sql, tenantId, now);
      return result;
    },
    { signal: ctx.signal, maxPasses: options.maxPasses }
  );

  const tenantsHitPassLimit = [...perTenant.entries()]
    .filter(([, outcome]) => outcome.hitPassLimit)
    .map(([tenantId]) => tenantId);

  const escalated = [...perTenant.values()]
    .flatMap((outcome) => outcome.passes)
    .reduce((sum, pass) => sum + pass.count, 0);

  return { tenantsChecked: tenants.length, escalated, tenantsHitPassLimit };
}

async function main() {
  const sql = getWorkerDatabaseClient();
  const cliOptions = parseJobCliArgs(process.argv.slice(2));

  try {
    const result = await runJob(
      {
        name: "workflow:escalations:dispatch",
        description:
          "Escalates awcms_workflow_tasks rows past their due_at for every active tenant, bounded batch + idempotent per escalation step.",
        handler: async (ctx) => {
          const dispatchResult = await runWorkflowEscalationsDispatch(sql, ctx);
          const hitPassLimit = dispatchResult.tenantsHitPassLimit.length > 0;

          console.log(
            `workflow:escalations:dispatch complete — correlationId=${ctx.correlationId} ` +
              `tenants=${dispatchResult.tenantsChecked} escalated=${dispatchResult.escalated}` +
              (ctx.dryRun ? " (dry-run: nothing was escalated)" : "") +
              (hitPassLimit
                ? ` (WARNING: ${dispatchResult.tenantsHitPassLimit.length} tenant(s) still had backlog remaining after the pass-count safety bound)`
                : "")
          );

          return {
            status: hitPassLimit ? "partial" : "success",
            itemCounts: {
              tenantsChecked: dispatchResult.tenantsChecked,
              escalated: dispatchResult.escalated
            },
            detail: hitPassLimit
              ? `Backlog not fully drained for: ${dispatchResult.tenantsHitPassLimit.join(", ")}`
              : undefined
          };
        }
      },
      { sql, dryRun: cliOptions.dryRun }
    );

    printJobTelemetry(result);
    await writeJobTelemetry(result, cliOptions.jsonOutputPath);

    if (!isJobResultOk(result)) {
      console.error(formatJobOutcomeLine(result));
    }

    applyJobExitCode(result);
  } finally {
    await sql.close({ timeout: 1 });
  }
}

if (import.meta.main) {
  await main();
}
