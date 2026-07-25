/**
 * form-draft-purge.ts — `bun run form-drafts:purge`.
 *
 * Issue #484. Internal worker entrypoint mirroring
 * `scripts/audit-log-purge.ts` (Issue #447) — not exposed over HTTP, run on
 * a schedule (cron/systemd timer/k8s CronJob). Two passes per tenant:
 *
 *   1. `expireOverdueFormDrafts` — flips overdue `draft` rows to `expired`.
 *   2. `purgeExpiredFormDrafts` — physically deletes `expired`/`abandoned`
 *      rows older than the retention cutoff.
 *
 * Both loop in bounded batches per tenant until a pass does nothing or
 * `MAX_PASSES_PER_TENANT` is hit, same safety bound as the audit-log job.
 *
 * Retention (for step 2 only — step 1 always uses each draft's own
 * `expires_at`) is configurable in this priority order: `--retention-
 * days=<n>` CLI flag, then `FORM_DRAFT_RETENTION_DAYS` env var, then
 * `FORM_DRAFT_DEFAULT_RETENTION_DAYS` (30 days).
 */
import { getWorkerDatabaseClient } from "../src/lib/database/client";
import { logScriptFailure } from "../src/lib/logging/error-log";
import {
  FORM_DRAFT_DEFAULT_RETENTION_DAYS,
  expireOverdueFormDrafts,
  purgeExpiredFormDrafts
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

  try {
    const tenants = (await sql`
      SELECT id FROM awcms_tenants WHERE status = 'active'
    `) as TenantRow[];

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
