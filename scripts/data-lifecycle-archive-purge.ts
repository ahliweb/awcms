/**
 * data-lifecycle-archive-purge.ts — `bun run data-lifecycle:archive-purge`.
 *
 * ADR-0037 (ported from awcms-micro Issue #745). Scheduled worker entrypoint for
 * `runDataLifecycleArchivePurge`
 * (`src/modules/data-lifecycle/application/archive-purge-job.ts`) — same shape as
 * `scripts/audit-log-purge.ts`: built on the shared worker runner (advisory
 * lock, timeout, SIGTERM/SIGINT-aware cancellation, JSON telemetry), not exposed
 * over HTTP (an unattended maintenance operation, not a user action).
 *
 * `--dry-run`: computes and records dry-run snapshots for every registered
 * descriptor (both `"delegated"` and `"generic"`) without any mutation — safe to
 * run in production to preview backlog/held/purgeable counts before scheduling
 * for real.
 */
import { getWorkerDatabaseClient } from "../src/lib/database/client";
import {
  applyJobExitCode,
  formatJobOutcomeLine,
  isJobResultOk,
  parseJobCliArgs,
  printJobTelemetry,
  runJob,
  writeJobTelemetry
} from "../src/lib/jobs/job-runner";
import {
  runDataLifecycleArchivePurge,
  summarizeArchivePurgeOutcome
} from "../src/modules/data-lifecycle/application/archive-purge-job";
import { resolveDataLifecycleConfig } from "../src/modules/data-lifecycle/domain/data-lifecycle-config";
import { createLocalArchiveAdapter } from "../src/modules/data-lifecycle/infrastructure/local-archive-adapter";

async function main() {
  // `awcms_worker` role (sql/022) — see migration 055's own grants.
  const sql = getWorkerDatabaseClient();
  const cliOptions = parseJobCliArgs(process.argv.slice(2));
  const config = resolveDataLifecycleConfig();
  const archivePort = createLocalArchiveAdapter(config.archiveRootPath);

  try {
    const result = await runJob(
      {
        name: "data-lifecycle:archive-purge",
        description:
          "Archives (where applicable) and purges rows past retention for every registered generic-execution high-volume table descriptor, and records a dry-run backlog snapshot for every delegated (existing-adopter) descriptor.",
        handler: async (ctx) => {
          const purgeResult = await runDataLifecycleArchivePurge(sql, ctx, {
            archivePort
          });
          const hitPassLimit = purgeResult.tenantsHitPassLimit.length > 0;
          const failures = purgeResult.descriptorFailures.length;
          const outcome = summarizeArchivePurgeOutcome(purgeResult);
          const knownUnreadable = purgeResult.knownUnreadableDelegated.length;

          console.log(
            `data-lifecycle:archive-purge complete — correlationId=${ctx.correlationId} ` +
              `tenants=${purgeResult.tenantsChecked} generic=${purgeResult.descriptorsGeneric} ` +
              `delegated=${purgeResult.descriptorsDelegated} archived=${purgeResult.totalArchived} ` +
              `purged=${purgeResult.totalPurged} dryRunEligible=${purgeResult.totalDryRunEligible}` +
              (ctx.dryRun ? " (dry-run: nothing was archived/purged)" : "") +
              (knownUnreadable > 0
                ? ` knownUnreadableDelegated=${knownUnreadable} (expected: delegated snapshot of a table awcms_worker may not read; not a failure)`
                : "") +
              (failures > 0
                ? ` (WARNING: ${failures} descriptor pass(es) failed and were recorded as failed runs; see data_lifecycle.descriptor_failed log lines)`
                : "") +
              (hitPassLimit
                ? ` (WARNING: ${purgeResult.tenantsHitPassLimit.length} tenant(s) still had backlog remaining after the pass-count safety bound)`
                : "")
          );

          return {
            status: outcome.status,
            itemCounts: {
              tenantsChecked: purgeResult.tenantsChecked,
              archived: purgeResult.totalArchived,
              purged: purgeResult.totalPurged,
              dryRunEligible: purgeResult.totalDryRunEligible,
              tenantsHitPassLimit: purgeResult.tenantsHitPassLimit.length,
              descriptorFailures: failures,
              knownUnreadableDelegated: knownUnreadable
            },
            detail: outcome.detail
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
