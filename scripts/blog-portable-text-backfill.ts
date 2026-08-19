/**
 * blog-portable-text-backfill.ts — `bun run blog:portable-text:backfill`.
 *
 * Converts every legacy `content_json.blocks` body into `body_portable_text`
 * (ADR-0100, Issue #588), for every active tenant.
 *
 * **DRY-RUN BY DEFAULT.** It reports what it would convert and writes nothing
 * unless `--commit` is passed — the same contract `idn-regions:import` uses,
 * and for the same reason: a one-shot content migration is the kind of thing an
 * operator should be able to inspect before it happens.
 *
 * Idempotent and re-runnable. The selection predicate is
 * `body_portable_text = '[]'::jsonb`, so an already-converted row is never
 * selected twice, and the converter is deterministic (position-derived keys, no
 * clock, no randomness) so a second run after a crash converts only the
 * remainder rather than rewriting every row with fresh keys.
 *
 * Bounded per run. A tenant with more rows than the batch limit reports
 * `partial: true` and is finished by the next run — the same "partial this run,
 * remainder next run" convention the scheduled-publish job and the audit-log
 * purge already use.
 *
 * Not a scheduled job: it is a one-shot cutover step, so it carries no job
 * descriptor and no crontab entry. An operator runs it once with `--commit`
 * after `sql/134` is applied, repeating until `partial` is false.
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
import { fetchActiveTenants } from "../src/lib/jobs/batching";
import { backfillPortableTextForTenant } from "../src/modules/blog-content/application/portable-text-backfill";

async function main() {
  const sql = getWorkerDatabaseClient();
  const cliOptions = parseJobCliArgs(process.argv.slice(2));

  // `--commit` is this script's own flag, deliberately distinct from the shared
  // runner's `--dry-run`: the DEFAULT here is dry, so an operator who forgets a
  // flag inspects rather than writes.
  const commit = process.argv.slice(2).includes("--commit");

  try {
    const result = await runJob(
      {
        name: "blog:portable-text:backfill",
        description:
          "Converts legacy content_json.blocks bodies to body_portable_text for every active tenant. Dry-run unless --commit.",
        handler: async (ctx) => {
          const tenants = await fetchActiveTenants(sql);
          let scanned = 0;
          let converted = 0;
          let skippedNoBlocks = 0;
          let partialTenants = 0;

          for (const tenant of tenants) {
            if (ctx.signal.aborted) {
              break;
            }

            const tenantResult = await backfillPortableTextForTenant(
              sql,
              tenant.id,
              { commit, correlationId: ctx.correlationId }
            );

            scanned += tenantResult.scanned;
            converted += tenantResult.converted;
            skippedNoBlocks += tenantResult.skippedNoBlocks;
            if (tenantResult.partial) {
              partialTenants += 1;
            }
          }

          return {
            status:
              partialTenants > 0 ? ("partial" as const) : ("success" as const),
            itemCounts: {
              tenantsChecked: tenants.length,
              scanned,
              converted,
              skippedNoBlocks,
              partialTenants
            },
            detail: commit
              ? partialTenants > 0
                ? `${partialTenants} tenant(s) still have rows to convert; run again.`
                : undefined
              : `dry-run: ${converted} row(s) WOULD be converted. Re-run with --commit to write.`
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
