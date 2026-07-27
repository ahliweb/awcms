/**
 * comments-retention.ts — `bun run comments:retention`.
 *
 * ADR-0041, ported from awcms-micro Issue #271. Internal worker entrypoint —
 * not exposed over HTTP, run on a schedule (cron/systemd timer/k8s CronJob).
 * Two bounded passes per active tenant:
 *
 *   1. `anonymizeAgedComments` — NULLs author identity fields on comments older
 *      than the retention cutoff, RETAINING the row, its body, and its
 *      append-only moderation history, and appending an `anonymize` moderation
 *      event. SKIPPED for a tenant whose comment-content descriptor is under an
 *      active legal hold (legal hold overrides retention, ADR-0037).
 *   2. `purgeUnconfirmedReplySubscriptions` — deletes double-opt-in reply
 *      subscriptions never confirmed within the confirmation window. They can
 *      never be used to notify anyone, so retaining a recipient reference serves
 *      no purpose.
 *
 * The abuse-event and long-stale confirmed-subscription purges are NOT here —
 * those are `generic` data_lifecycle descriptors handled by that engine
 * (`module.ts`). This job owns only what the generic engine cannot express.
 *
 * Each pass loops in bounded batches per tenant until it does nothing or
 * `MAX_PASSES_PER_TENANT` is hit, the same safety bound the other purge jobs use.
 *
 * This job does NOT go through `runJob` (`src/lib/jobs/job-runner.ts`), so it
 * has no advisory lock, no `JobResult` telemetry, and no cooperative
 * cancellation — schedule it from ONE cron entry. Migration is tracked in
 * issue #291; the header used to claim it mirrored `form-draft-purge.ts` and
 * `audit-log-purge.ts`, and a reader who believed that would assume
 * protections this script does not have.
 *
 * Retention is configurable in priority order: `--retention-days=<n>`, then
 * `COMMENTS_RETENTION_DAYS`, then `COMMENTS_DEFAULT_ANONYMIZE_DAYS` (365).
 *
 * ## `--dry-run`
 *
 * Counts what each pass would touch and changes nothing — no UPDATE, no DELETE,
 * and no `anonymize` moderation event. Anonymization is IRREVERSIBLE (the
 * identity columns are NULLed, not archived) and step 2 physically deletes
 * rows, so a preview is the difference between knowing the first run's blast
 * radius and discovering it. It shares `resolveCommentsRetentionCutoff` with
 * the real path and asks the SAME legal-hold guard, reporting held tenants
 * rather than counting rows no run would touch.
 *
 * Runs as the least-privilege `awcms_worker` role. RLS is FORCE'd for that role
 * too, so every pass is wrapped in `withTenant` — without it the queries would
 * see nothing rather than crossing tenants.
 */
import { getWorkerDatabaseClient } from "../src/lib/database/client";
import { withTenantOrThrow } from "../src/lib/database/tenant-context";
import { logScriptFailure } from "../src/lib/logging/error-log";
import {
  COMMENTS_DEFAULT_ANONYMIZE_DAYS,
  anonymizeAgedComments,
  previewCommentsRetention,
  purgeUnconfirmedReplySubscriptions
} from "../src/modules/comments/application/comment-retention";
import { legalHoldGuardPortAdapter } from "../src/modules/data-lifecycle/application/legal-hold-guard-port-adapter";

const MAX_PASSES_PER_TENANT = 50;

type TenantRow = { id: string };

function resolveRetentionDays(): number {
  const flag = process.argv.find((arg) => arg.startsWith("--retention-days="));

  if (flag) {
    const parsed = Number(flag.split("=")[1]);

    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  const envValue = process.env.COMMENTS_RETENTION_DAYS;

  if (envValue) {
    const parsed = Number(envValue);

    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return COMMENTS_DEFAULT_ANONYMIZE_DAYS;
}

async function main() {
  const sql = getWorkerDatabaseClient();
  const correlationId = crypto.randomUUID();
  const retentionDays = resolveRetentionDays();
  const dryRun = process.argv.includes("--dry-run");

  try {
    const tenants = (await sql`
      SELECT id FROM awcms_tenants WHERE status = 'active'
    `) as TenantRow[];

    if (dryRun) {
      const now = new Date();
      let wouldAnonymize = 0;
      let wouldPurge = 0;
      let heldTenants = 0;
      let anonymizeCutoffIso = "";

      for (const tenant of tenants) {
        const preview = await withTenantOrThrow(sql, tenant.id, (tx) =>
          previewCommentsRetention(tx, tenant.id, legalHoldGuardPortAdapter, {
            retentionDays,
            now
          })
        );

        wouldAnonymize += preview.wouldAnonymize;
        wouldPurge += preview.wouldPurgeSubscriptions;
        if (preview.skippedForLegalHold) heldTenants += 1;
        anonymizeCutoffIso = preview.anonymizeCutoff.toISOString();
      }

      console.log(
        `comments:retention DRY RUN — correlationId=${correlationId} ` +
          `retentionDays=${retentionDays} cutoff=${anonymizeCutoffIso} ` +
          `tenants=${tenants.length} wouldAnonymize=${wouldAnonymize} ` +
          `wouldPurgeSubscriptions=${wouldPurge} heldTenants=${heldTenants} ` +
          `(nothing was changed)`
      );
      return;
    }

    let totalAnonymized = 0;
    let totalPurged = 0;
    let heldTenants = 0;
    const now = new Date();
    let cutoffIso = "";

    for (const tenant of tenants) {
      for (let pass = 0; pass < MAX_PASSES_PER_TENANT; pass += 1) {
        const result = await withTenantOrThrow(sql, tenant.id, (tx) =>
          anonymizeAgedComments(tx, tenant.id, legalHoldGuardPortAdapter, {
            retentionDays,
            now
          })
        );

        cutoffIso = result.cutoff.toISOString();

        if (result.skippedForLegalHold) {
          if (pass === 0) heldTenants += 1;
          break;
        }

        totalAnonymized += result.anonymizedCount;

        if (result.anonymizedCount === 0) {
          break;
        }
      }

      for (let pass = 0; pass < MAX_PASSES_PER_TENANT; pass += 1) {
        const result = await withTenantOrThrow(sql, tenant.id, (tx) =>
          purgeUnconfirmedReplySubscriptions(tx, tenant.id, { now })
        );

        totalPurged += result.purgedCount;

        if (result.purgedCount === 0) {
          break;
        }
      }
    }

    console.log(
      `comments:retention complete — correlationId=${correlationId} ` +
        `retentionDays=${retentionDays} cutoff=${cutoffIso} ` +
        `tenants=${tenants.length} anonymized=${totalAnonymized} ` +
        `unconfirmedSubscriptionsPurged=${totalPurged} legalHoldSkipped=${heldTenants}`
    );
  } catch (error) {
    logScriptFailure("comments:retention FAILED", error);
  } finally {
    await sql.close({ timeout: 1 });
  }
}

if (import.meta.main) {
  await main();
}
