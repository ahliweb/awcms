/**
 * news-media-r2-reconcile.ts — `bun run news-media:reconcile`.
 *
 * Issue #690 (epic #679, platform-hardening — "runtime/worker hardening"
 * wave, following #691/#689/#694/#695/#687/#697). Pending/orphan R2 media
 * lifecycle cleanup and DB-vs-R2 reconciliation for the news-portal
 * full-online R2-only media registry (`awcms_news_media_objects`,
 * `sql/041_awcms_news_media_object_registry_schema.sql`). Ported from
 * awcms-mini (`scripts/news-media-r2-reconcile.ts`).
 *
 * Built on the shared worker runner (`src/lib/jobs/job-runner.ts`, Issue
 * #697) from day one — this is a NEW job, not a migration of an existing
 * script, so there is no "before" behavior to preserve; every concern
 * (advisory lock, timeout, correlation id, exit code, JSON telemetry) comes
 * straight from `runJob`, same as `logs:audit:purge`/`modules:sync` (the two
 * jobs #697 already migrated).
 *
 * ## Feature gate — this entire job is a no-op unless R2-only news media is enabled
 *
 * `NEWS_MEDIA_R2_ENABLED` (`news-media-r2-config.ts`) is the SAME master
 * switch the upload/finalize endpoints already gate on. When it is not
 * `"true"`, this job returns `status: "skipped"` immediately (before
 * acquiring the advisory lock or touching R2/DB) — safe to schedule
 * unconditionally on every deployment profile, including offline/LAN ones
 * where R2-only news media is never enabled at all.
 *
 * ## No local filesystem fallback, no binary payload in Postgres
 *
 * This job only ever talks to Cloudflare R2 (via `NewsMediaR2Client`, Bun's
 * native `Bun.S3Client`) and to `awcms_news_media_objects` metadata —
 * it never reads/writes a local file, and never stores object bytes
 * anywhere (this table has no binary column and never will,
 * `sql/041_awcms_news_media_object_registry_schema.sql`'s own header).
 *
 * ## Never logs signed URLs, credentials, or object bytes
 *
 * Every log line/telemetry field below is a bare `object_key` (e.g.
 * `news-media/{tenantId}/2026/07/uuid.jpg` — no PII, no credential, per
 * `news-media-object-key.ts`'s own design), a count, or a provider error
 * message already truncated/sanitized by `news-media-r2-client.ts`. Nothing
 * here ever constructs or logs a presigned URL.
 *
 * ## `--dry-run`
 *
 * Categorizes every active tenant's media rows against the real R2 bucket
 * listing WITHOUT deleting or modifying anything — safe to run in
 * production to preview impact. See `news-media-reconciliation.ts`'s own
 * header for the exact categories (`healthy`/`orphanInDb`/`expiredPending`/
 * `staleOrphaned`/`orphanInR2`) and the ordering/race-safety guarantees the
 * REAL (non-dry-run) path applies.
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
import { createNewsMediaR2Client } from "../src/modules/media-library/infrastructure/media-r2-client";
import { resolveNewsMediaR2Config } from "../src/modules/media-library/domain/media-r2-config";
import { reconcileNewsMediaForAllTenants } from "../src/modules/media-library/application/media-reconciliation";

async function main() {
  const config = resolveNewsMediaR2Config();
  const cliOptions = parseJobCliArgs(process.argv.slice(2));

  if (!config.enabled) {
    console.log(
      'news-media:reconcile skipped — NEWS_MEDIA_R2_ENABLED is not "true" (no R2-only news media in use).'
    );
    return;
  }

  // `awcms_worker` least-privilege role — see
  // `sql/041_awcms_news_media_object_registry_schema.sql`'s
  // `GRANT SELECT, UPDATE, DELETE ON awcms_news_media_objects TO awcms_worker`.
  const sql = getWorkerDatabaseClient();
  const r2Client = createNewsMediaR2Client({
    accountId: config.accountId,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    bucket: config.bucket
  });

  try {
    const result = await runJob(
      {
        name: "news-media:reconcile",
        description:
          "Reconciles awcms_news_media_objects metadata against the real R2 bucket contents; cleans up expired pending uploads and grace-period-expired orphans in bounded batches.",
        // R2 network calls (list/delete, each individually timeout-bound at
        // 10s default) across every active tenant can run long on a large
        // bucket — generous but still bounded, same reasoning
        // `email:dispatch`'s own timeout override uses.
        timeoutMs: 30 * 60 * 1000,
        handler: async (ctx) => {
          const summary = await reconcileNewsMediaForAllTenants(
            sql,
            config,
            r2Client,
            { dryRun: ctx.dryRun, signal: ctx.signal }
          );

          const { totals } = summary;
          const hadFailures =
            totals.tenantsWithR2ListFailure > 0 ||
            totals.expiredPendingDeferred > 0 ||
            totals.staleOrphanedDeferred > 0 ||
            totals.orphanInR2Deferred > 0;

          console.log(
            `news-media:reconcile complete — correlationId=${ctx.correlationId} ` +
              `tenants=${totals.tenantsChecked} healthy=${totals.healthy} ` +
              `orphanInDb=${totals.orphanInDb} ` +
              `expiredPending(total=${totals.expiredPendingTotal},deleted=${totals.expiredPendingDeleted},racedSkipped=${totals.expiredPendingRacedSkipped},deferred=${totals.expiredPendingDeferred}) ` +
              `staleOrphaned(total=${totals.staleOrphanedTotal},deleted=${totals.staleOrphanedDeleted},deferred=${totals.staleOrphanedDeferred}) ` +
              `orphanInR2(total=${totals.orphanInR2Total},eligible=${totals.orphanInR2Eligible},deleted=${totals.orphanInR2Deleted},raceAverted=${totals.orphanInR2RaceAverted},deferred=${totals.orphanInR2Deferred})` +
              (ctx.dryRun ? " (dry-run: nothing was deleted/modified)" : "") +
              (totals.tenantsWithR2ListFailure > 0
                ? ` (WARNING: ${totals.tenantsWithR2ListFailure} tenant(s) had an R2 listing failure this run — skipped, retried next run)`
                : "")
          );

          if (totals.orphanInDb > 0) {
            console.log(
              `news-media:reconcile — ${totals.orphanInDb} object(s) reported as orphan-in-DB (DB row expects an R2 object that is missing) — REPORT ONLY, no automatic remediation; follow the news_portal R2 backup lifecycle operator SOP.`
            );
          }

          return {
            status: summary.aborted || hadFailures ? "partial" : "success",
            itemCounts: {
              tenantsChecked: totals.tenantsChecked,
              healthy: totals.healthy,
              orphanInDb: totals.orphanInDb,
              expiredPendingDeleted: totals.expiredPendingDeleted,
              staleOrphanedDeleted: totals.staleOrphanedDeleted,
              orphanInR2Deleted: totals.orphanInR2Deleted
            },
            detail: summary.aborted
              ? "Aborted before every active tenant was processed (timeout/termination) — remaining tenants retried next run."
              : hadFailures
                ? "One or more R2 operations were deferred/failed this run (provider outage or listing failure) — retried next run."
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
