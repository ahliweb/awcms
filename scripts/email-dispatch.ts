/**
 * email-dispatch.ts — `bun run email:dispatch`.
 *
 * Issue #495 (epic #492). Internal worker entrypoint for the email
 * dispatcher (`src/modules/email/application/email-dispatch.ts`) — intended
 * to run on a schedule (cron/systemd timer/k8s CronJob), not exposed over
 * HTTP. Mirrors `scripts/object-sync-dispatch.ts` exactly: iterates every
 * `active` tenant and drains its due `awcms_email_messages` backlog in
 * batches, looping per tenant until a batch claims nothing or
 * `MAX_PASSES_PER_TENANT` is hit.
 *
 * No-op (claims nothing, exits 0) when `EMAIL_ENABLED` is not `"true"` —
 * see `dispatchEmailQueue`'s own early return.
 */
import { getWorkerDatabaseClient } from "../src/lib/database/client";
import { logScriptFailure } from "../src/lib/logging/error-log";
import { dispatchEmailQueue } from "../src/modules/email/application/email-dispatch";

const MAX_PASSES_PER_TENANT = 20;

type TenantRow = { id: string };

async function main() {
  // `getWorkerDatabaseClient` connects as the least-privilege worker role
  // when configured, falling back to DATABASE_URL otherwise.
  const sql = getWorkerDatabaseClient();
  const correlationId = crypto.randomUUID();

  try {
    const tenants = (await sql`
      SELECT id FROM awcms_tenants WHERE status = 'active'
    `) as TenantRow[];

    let totalClaimed = 0;
    let totalSent = 0;
    let totalRetried = 0;
    let totalFailed = 0;
    // Finding D6 gave the dispatcher a fourth outcome, and a number the
    // summary does not print is a number nobody reads. `deferred` rows were
    // claimed and released without any contact; `suppressed` ones were never
    // going to be sent. Both used to hide inside `claimed`, so a pass that
    // sent nothing at all could still print `sent=0 failed=0` and look idle.
    let totalDeferred = 0;
    let totalSuppressed = 0;
    let breakerSeenOpen = false;

    for (const tenant of tenants) {
      for (let pass = 0; pass < MAX_PASSES_PER_TENANT; pass += 1) {
        const result = await dispatchEmailQueue(sql, tenant.id, {
          correlationId
        });

        totalClaimed += result.claimed;
        totalSent += result.sent;
        totalRetried += result.retried;
        totalFailed += result.failed;
        totalDeferred += result.deferred;
        totalSuppressed += result.suppressed;
        breakerSeenOpen ||= result.breakerOpen;

        if (result.claimed === 0) {
          break;
        }
      }
    }

    console.log(
      `email:dispatch complete — correlationId=${correlationId} ` +
        `tenants=${tenants.length} claimed=${totalClaimed} sent=${totalSent} ` +
        `retried=${totalRetried} failed=${totalFailed} ` +
        `deferred=${totalDeferred} suppressed=${totalSuppressed} ` +
        `breakerOpen=${breakerSeenOpen}`
    );

    if (totalDeferred > 0 || breakerSeenOpen) {
      // Deliberately not a non-zero exit, unlike `site-search:reconcile`. An
      // open breaker is transient and self-healing, the deferred rows are back
      // in `queued` with their retries intact, and the next scheduled pass
      // sends them. Paging on it would page on the provider's weather.
      console.warn(
        `email:dispatch — the Mailketing circuit breaker was open; ` +
          `${totalDeferred} claimed message(s) were released back to 'queued' ` +
          "without an attempt. They go out on the next pass once the breaker closes."
      );
    }
  } catch (error) {
    logScriptFailure("email:dispatch FAILED", error);
  } finally {
    await sql.close({ timeout: 1 });
  }
}

if (import.meta.main) {
  await main();
}
