/**
 * email-queue-purge.ts — `bun run email:queue:purge`.
 *
 * Issue #468, ADR-0072. Internal worker entrypoint — not exposed over HTTP, run
 * on a schedule. Drives `src/modules/email/application/email-queue-purge.ts`
 * per tenant in bounded batches until a pass deletes nothing or
 * `MAX_PASSES_PER_TENANT` is hit, the same safety bound `form-draft-purge.ts`
 * and `push:queue:purge` use.
 *
 * Like those jobs, this one does NOT go through `runJob`
 * (`src/lib/jobs/job-runner.ts`), so it has no advisory lock, no `JobResult`
 * telemetry, and no cooperative cancellation — schedule it from ONE cron entry.
 * Said plainly rather than by mirroring a header that would imply protections
 * this script does not have.
 *
 * Runs regardless of `EMAIL_ENABLED`, unlike `email:dispatch`. A deployment
 * that turned email OFF still holds rows from when it was on, and those are
 * precisely the rows nothing else will ever clean up.
 *
 * ## `--dry-run`
 *
 * There is one, and the difference from `push:queue:purge` — which deliberately
 * has none — is the reason it exists rather than an inconsistency. That job's
 * tables were created by the same PR that created it, so its first run has at
 * most one retention window behind it. These two tables have been accumulating
 * since `sql/014` with no retention at all, so the FIRST run on a live
 * deployment is the largest delete this job will ever do, against rows nobody
 * has ever counted. Seeing that number before it happens is worth one flag.
 */
import { getWorkerDatabaseClient } from "../src/lib/database/client";
import { logScriptFailure } from "../src/lib/logging/error-log";
import { legalHoldGuardPortAdapter } from "../src/modules/data-lifecycle/application/legal-hold-guard-port-adapter";
import {
  EMAIL_ATTEMPT_DEFAULT_RETENTION_DAYS,
  EMAIL_MESSAGE_DEFAULT_RETENTION_DAYS,
  purgeEmailQueue,
  resolveEmailRetentionCutoff
} from "../src/modules/email/application/email-queue-purge";

const MAX_PASSES_PER_TENANT = 50;

type TenantRow = { id: string };
type CountRow = { total: number };

/**
 * Counts what a real run WOULD delete, with the same predicates.
 *
 * Deliberately re-states the terminal statuses rather than importing a shared
 * fragment: a preview that could disagree with the delete is worse than no
 * preview, and the only way to make the two provably identical is a shared SQL
 * builder, which this repo does not have. `tests/email-queue-purge.test.ts`
 * pins the two lists against each other instead.
 */
async function previewTenant(
  sql: Bun.SQL,
  tenantId: string,
  now: Date
): Promise<{ attempts: number; messages: number }> {
  const messageCutoff = resolveEmailRetentionCutoff(
    now,
    EMAIL_MESSAGE_DEFAULT_RETENTION_DAYS
  );
  const attemptCutoff = resolveEmailRetentionCutoff(
    now,
    EMAIL_ATTEMPT_DEFAULT_RETENTION_DAYS
  );

  const attempts = (await sql`
    SELECT count(*)::int AS total
    FROM awcms_email_delivery_attempts
    WHERE tenant_id = ${tenantId} AND attempted_at < ${attemptCutoff}
  `) as CountRow[];

  const messages = (await sql`
    SELECT count(*)::int AS total
    FROM awcms_email_messages
    WHERE tenant_id = ${tenantId}
      AND status IN ('sent', 'failed', 'cancelled', 'suppressed')
      AND updated_at < ${messageCutoff}
  `) as CountRow[];

  return {
    attempts: attempts[0]?.total ?? 0,
    messages: messages[0]?.total ?? 0
  };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const sql = getWorkerDatabaseClient();
  const correlationId = crypto.randomUUID();
  const now = new Date();

  try {
    const tenants = (await sql`
      SELECT id FROM awcms_tenants WHERE status = 'active'
    `) as TenantRow[];

    let totalAttempts = 0;
    let totalMessages = 0;

    for (const tenant of tenants) {
      if (dryRun) {
        // No `withTenantOrThrow`, and therefore no RLS session variable: this
        // runs as `awcms_worker`, which the policies bind, and every query
        // above carries its own `tenant_id = ?`. Counting is the one operation
        // where that is enough — it writes nothing.
        const preview = await previewTenant(sql, tenant.id, now);

        totalAttempts += preview.attempts;
        totalMessages += preview.messages;
        continue;
      }

      for (let pass = 0; pass < MAX_PASSES_PER_TENANT; pass += 1) {
        const result = await purgeEmailQueue(
          sql,
          tenant.id,
          legalHoldGuardPortAdapter,
          { correlationId }
        );

        totalAttempts += result.purgedAttempts;
        totalMessages += result.purgedMessages;

        if (result.purgedAttempts + result.purgedMessages === 0) {
          break;
        }
      }
    }

    console.log(
      `email:queue:purge ${dryRun ? "DRY RUN" : "complete"} — ` +
        `correlationId=${correlationId} tenants=${tenants.length} ` +
        `attempts=${totalAttempts} messages=${totalMessages}`
    );
  } catch (error) {
    logScriptFailure("email:queue:purge FAILED", error);
  } finally {
    await sql.close({ timeout: 1 });
  }
}

if (import.meta.main) {
  await main();
}
