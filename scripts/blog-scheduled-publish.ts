/**
 * blog-scheduled-publish.ts — `bun run blog:publish:scheduled`.
 *
 * Ported from awcms-mini (`scripts/blog-scheduled-publish.ts`). Internal
 * worker entrypoint, not exposed over HTTP, run on a schedule (cron/systemd
 * timer). Runs BOTH scheduled transitions for every active tenant:
 * `publishDueScheduledPosts` (`status = 'scheduled' AND scheduled_at <= now()`
 * -> `published`) and then `unpublishDuePosts` (`status = 'published' AND
 * unpublish_at <= now()` -> `archived`, Issue #591).
 *
 * The two sweeps share ONE command deliberately. Two job descriptors would mean
 * two schedules, and two schedules drift — an operator disables one, or a
 * container ships a crontab with a single line, and posts publish forever while
 * nothing ever withdraws them. That failure is invisible, because the site
 * looks like it is working. One command cannot half-run.
 *
 * Publish runs FIRST so a post whose window opens and closes inside the same
 * tick is published and then withdrawn in the correct order rather than being
 * skipped entirely. Both are idempotent: a post already in the target status
 * does not match the next run's `WHERE`.
 *
 * Built on the shared worker runner (`../src/lib/jobs/job-runner.ts` —
 * advisory lock, timeout, SIGTERM/SIGINT-aware cancellation, JSON
 * telemetry), the current convention for a NEW job in this base (mini's own
 * script predates that runner and used a hand-rolled try/catch loop).
 *
 * This script is the composition root (ADR-0011) that wires the
 * `MediaLibraryPort` and `SocialPublishingPort` implementations into
 * `blog_content`'s scheduled-publish job. `media_library` IS ported
 * (ADR-0036), so this injects its real `mediaLibraryPortAdapter`;
 * `social_publishing` is NOT ported to this base yet, so this still injects
 * `blog_content`'s own `noopSocialPublishingPortAdapter` — see that adapter's
 * header. `blog-scheduled-publish.ts` (the application-layer file) itself never
 * imports either adapter directly, only the port TYPES — this script is the
 * only place that changes once `social_publishing` is ported too.
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
import {
  publishDueScheduledPosts,
  unpublishDuePosts
} from "../src/modules/blog-content/application/blog-scheduled-publish";
import { mediaLibraryPortAdapter } from "../src/modules/media-library/application/media-library-port-adapter";
import { noopSocialPublishingPortAdapter } from "../src/modules/blog-content/application/social-publishing-port-noop-adapter";

async function main() {
  const sql = getWorkerDatabaseClient();
  const cliOptions = parseJobCliArgs(process.argv.slice(2));

  try {
    const result = await runJob(
      {
        name: "blog:publish:scheduled",
        description:
          "Publishes every due status='scheduled' blog post (scheduled_at <= now()), gated by the content quality checklist, then archives every due status='published' post (unpublish_at <= now()), for every active tenant.",
        handler: async (ctx) => {
          if (ctx.dryRun) {
            const tenants = await fetchActiveTenants(sql);
            return {
              status: "success" as const,
              itemCounts: {
                tenantsChecked: tenants.length,
                published: 0,
                blocked: 0,
                unpublished: 0,
                partialTenants: 0
              },
              detail: "dry-run: no post was published, blocked or unpublished."
            };
          }

          const tenants = await fetchActiveTenants(sql);
          let totalPublished = 0;
          let totalBlocked = 0;
          let totalUnpublished = 0;
          let partialTenants = 0;

          for (const tenant of tenants) {
            if (ctx.signal.aborted) {
              break;
            }

            const tenantResult = await publishDueScheduledPosts(
              sql,
              tenant.id,
              mediaLibraryPortAdapter,
              { now: new Date(), correlationId: ctx.correlationId },
              noopSocialPublishingPortAdapter
            );

            totalPublished += tenantResult.publishedCount;
            totalBlocked += tenantResult.blockedCount;

            // Issue #591 — the withdrawing half, in the same iteration so a
            // tenant is never left half-swept if the loop is cancelled midway.
            const unpublishResult = await unpublishDuePosts(sql, tenant.id, {
              now: new Date(),
              correlationId: ctx.correlationId
            });
            totalUnpublished += unpublishResult.unpublishedCount;

            if (tenantResult.partial || unpublishResult.partial) {
              // This tenant had a full batch this run; its remaining due
              // posts are picked up on the next scheduled run (idempotent).
              partialTenants += 1;
            }
          }

          return {
            status: partialTenants > 0 ? "partial" : "success",
            itemCounts: {
              tenantsChecked: tenants.length,
              published: totalPublished,
              blocked: totalBlocked,
              unpublished: totalUnpublished,
              partialTenants
            },
            detail:
              partialTenants > 0
                ? `${partialTenants} tenant(s) still had a due-post backlog remaining after this run's batch bound.`
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
