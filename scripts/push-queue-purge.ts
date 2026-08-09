/**
 * push-queue-purge.ts — `bun run push:queue:purge`.
 *
 * Issue #465 (epic #463, ADR-0074). Internal worker entrypoint — not exposed
 * over HTTP, run on a schedule. Drives
 * `src/modules/push-delivery/application/push-queue-purge.ts` per tenant in
 * bounded batches until a pass deletes nothing or `MAX_PASSES_PER_TENANT` is
 * hit, the same safety bound `form-draft-purge.ts` uses.
 *
 * Like that job, this one does NOT go through `runJob`
 * (`src/lib/jobs/job-runner.ts`), so it has no advisory lock, no `JobResult`
 * telemetry, and no cooperative cancellation — schedule it from ONE cron entry.
 * Said plainly rather than by mirroring a header that would imply protections
 * this script does not have.
 *
 * Runs regardless of `PUSH_ENABLED`, unlike `push:dispatch`. A deployment that
 * turned push OFF still has rows from when it was on, and those are precisely
 * the rows nothing else will ever clean up.
 *
 * ## `--dry-run`
 *
 * There is deliberately none yet, and that is worth stating rather than
 * leaving as a gap a reader has to discover. `form-drafts:purge` needs one
 * because its first real run can delete years of accumulated drafts. This
 * table set is created by the same PR as this job: on every deployment, the
 * first run has at most one retention window of rows behind it, and the job's
 * own audit event records exactly what it removed. A preview would be added
 * the moment that stops being true.
 */
import { getWorkerDatabaseClient } from "../src/lib/database/client";
import { logScriptFailure } from "../src/lib/logging/error-log";
import { legalHoldGuardPortAdapter } from "../src/modules/data-lifecycle/application/legal-hold-guard-port-adapter";
import { purgePushQueue } from "../src/modules/push-delivery/application/push-queue-purge";

const MAX_PASSES_PER_TENANT = 50;

type TenantRow = { id: string };

async function main() {
  const sql = getWorkerDatabaseClient();
  const correlationId = crypto.randomUUID();

  try {
    const tenants = (await sql`
      SELECT id FROM awcms_tenants WHERE status = 'active'
    `) as TenantRow[];

    let totalAttempts = 0;
    let totalMessages = 0;
    let totalSubscriptions = 0;

    for (const tenant of tenants) {
      for (let pass = 0; pass < MAX_PASSES_PER_TENANT; pass += 1) {
        const result = await purgePushQueue(
          sql,
          tenant.id,
          legalHoldGuardPortAdapter,
          { correlationId }
        );

        totalAttempts += result.purgedAttempts;
        totalMessages += result.purgedMessages;
        totalSubscriptions += result.purgedSubscriptions;

        const purgedThisPass =
          result.purgedAttempts +
          result.purgedMessages +
          result.purgedSubscriptions;

        if (purgedThisPass === 0) {
          break;
        }
      }
    }

    console.log(
      `push:queue:purge complete — correlationId=${correlationId} ` +
        `tenants=${tenants.length} attempts=${totalAttempts} ` +
        `messages=${totalMessages} subscriptions=${totalSubscriptions}`
    );
  } catch (error) {
    logScriptFailure("push:queue:purge FAILED", error);
  } finally {
    await sql.close({ timeout: 1 });
  }
}

if (import.meta.main) {
  await main();
}
