/**
 * form-draft-purge.ts — `bun run form-drafts:purge`.
 *
 * Issue #484. Internal worker entrypoint — not exposed over HTTP, run on a
 * schedule (cron/systemd timer/k8s CronJob). Two passes per tenant:
 *
 *   1. `expireOverdueFormDrafts` — flips overdue `draft` rows to `expired`.
 *   2. `purgeExpiredFormDrafts` — physically deletes `expired`/`abandoned`
 *      rows older than the retention cutoff.
 *
 * Both loop in bounded batches per tenant until a pass does nothing or
 * `MAX_PASSES_PER_TENANT` is hit, same safety bound as the audit-log job.
 *
 * This job does NOT go through `runJob` (`src/lib/jobs/job-runner.ts`), so it
 * has no advisory lock, no `JobResult` telemetry, and no cooperative
 * cancellation — schedule it from ONE cron entry. Migration is tracked in
 * issue #291; the header used to claim it mirrored `audit-log-purge.ts`, which
 * does use the runner, and a reader who believed that would assume protections
 * this script does not have.
 *
 * Retention (for step 2 only — step 1 always uses each draft's own
 * `expires_at`) is configurable in this priority order: `--retention-
 * days=<n>` CLI flag, then `FORM_DRAFT_RETENTION_DAYS` env var, then
 * `FORM_DRAFT_DEFAULT_RETENTION_DAYS` (30 days).
 *
 * ## `--dry-run`
 *
 * Counts what a real run would expire and DELETE, and changes nothing. Step 2
 * physically removes rows, so the first real run against a database that has
 * never been purged deletes every draft ever abandoned past the cutoff — a
 * preview is the difference between knowing that number and discovering it.
 * The preview shares `resolveFormDraftRetentionCutoff` with the real path, and
 * asks the SAME legal-hold guard: a held descriptor makes a real run delete
 * nothing, so a preview that ignored the hold would report a backlog no run
 * would ever touch.
 */
import { getWorkerDatabaseClient } from "../src/lib/database/client";
import { logScriptFailure } from "../src/lib/logging/error-log";
import {
  FORM_DRAFT_DEFAULT_RETENTION_DAYS,
  countExpirableFormDrafts,
  countPurgeableFormDrafts,
  expireOverdueFormDrafts,
  purgeExpiredFormDrafts,
  resolveFormDraftRetentionCutoff
} from "../src/modules/form-drafts/application/form-draft-purge";
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

  const envValue = process.env.FORM_DRAFT_RETENTION_DAYS;

  if (envValue) {
    const parsed = Number(envValue);

    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return FORM_DRAFT_DEFAULT_RETENTION_DAYS;
}

async function main() {
  // Issue #683 (epic #679): `awcms_worker` role — see migration 045.
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
      const cutoff = resolveFormDraftRetentionCutoff(now, retentionDays);
      let wouldExpire = 0;
      let wouldPurge = 0;

      for (const tenant of tenants) {
        wouldExpire += await countExpirableFormDrafts(sql, tenant.id, now);
        wouldPurge += await countPurgeableFormDrafts(
          sql,
          tenant.id,
          legalHoldGuardPortAdapter,
          cutoff
        );
      }

      console.log(
        `form-drafts:purge DRY RUN — correlationId=${correlationId} ` +
          `retentionDays=${retentionDays} cutoff=${cutoff.toISOString()} ` +
          `tenants=${tenants.length} wouldExpire=${wouldExpire} ` +
          `wouldPurge=${wouldPurge} (nothing was changed)`
      );
      return;
    }

    let totalExpired = 0;
    let totalPurged = 0;
    const now = new Date();
    let cutoffIso = "";

    for (const tenant of tenants) {
      for (let pass = 0; pass < MAX_PASSES_PER_TENANT; pass += 1) {
        const result = await expireOverdueFormDrafts(sql, tenant.id, {
          now,
          correlationId
        });

        totalExpired += result.expiredCount;

        if (result.expiredCount === 0) {
          break;
        }
      }

      for (let pass = 0; pass < MAX_PASSES_PER_TENANT; pass += 1) {
        const result = await purgeExpiredFormDrafts(
          sql,
          tenant.id,
          legalHoldGuardPortAdapter,
          {
            retentionDays,
            now,
            correlationId
          }
        );

        totalPurged += result.purgedCount;
        cutoffIso = result.cutoff.toISOString();

        if (result.purgedCount === 0) {
          break;
        }
      }
    }

    console.log(
      `form-drafts:purge complete — correlationId=${correlationId} ` +
        `retentionDays=${retentionDays} cutoff=${cutoffIso} ` +
        `tenants=${tenants.length} expired=${totalExpired} purged=${totalPurged}`
    );
  } catch (error) {
    logScriptFailure("form-drafts:purge FAILED", error);
  } finally {
    await sql.close({ timeout: 1 });
  }
}

if (import.meta.main) {
  await main();
}
