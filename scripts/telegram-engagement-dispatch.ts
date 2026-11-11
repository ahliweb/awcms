/**
 * telegram-engagement-dispatch.ts — `bun run telegram-engagement:dispatch`.
 *
 * Issue #1156 (ADR-0152). Internal worker entrypoint, run on a schedule and
 * never exposed over HTTP: for every `active` tenant, the connector phase
 * (getMe / setWebhook / deleteWebhook for registrations, rotations and
 * revocations) and the customer outbound queue (`dispatch.ts`), in bounded
 * passes per tenant.
 *
 * No-op (claims nothing, exits 0) when `TELEGRAM_ENGAGEMENT_ENABLED` is not
 * `"true"`, which makes it safe to schedule on every profile including
 * offline/LAN. A pass that throws for one tenant is logged for THAT tenant and
 * does not stop the others.
 *
 * ## It runs as its own role, `awcms_telegram_engagement_dispatch`
 *
 * Connected through `TELEGRAM_ENGAGEMENT_DATABASE_URL`, with NO fallback: without
 * it the job refuses to run (audit H-2 of PR #1260). The role (`sql/353`) holds
 * only the columns the dispatcher touches, and of `awcms_channel_secrets` only a
 * live customer bot's token and its endpoint's webhook seed (a RESTRICTIVE
 * policy). It is neither `awcms_app` (which sees every channel secret of every
 * tenant) nor `awcms_worker` (which must never see a bot token, `sql/328`).
 */
import {
  assertConnectedAsDispatchRole,
  assertNoSharedLogins,
  getTelegramEngagementDispatchDatabaseClient
} from "../src/lib/database/telegram-engagement-dispatch-client";
import { logScriptFailure } from "../src/lib/logging/error-log";
import { snapshotSecretDecryptCounts } from "../src/modules/channel-accounts/application/secret-store";
import { dispatchTelegramEngagement } from "../src/modules/telegram-engagement/application/dispatch";
import { isTelegramEngagementEnabled } from "../src/modules/telegram-engagement/domain/telegram-engagement-config";

const MAX_PASSES_PER_TENANT = 10;

type TenantRow = { id: string };

/**
 * The dispatcher's own connection, or `null` (logged, exit 1): never a broader
 * fallback, never with a shared login in the environment, and never unless the
 * server confirms it is the dispatch role (audits H-A / L-A of PR #1260).
 */
async function openDispatchConnection() {
  try {
    assertNoSharedLogins();

    const connection = getTelegramEngagementDispatchDatabaseClient();

    await assertConnectedAsDispatchRole(connection);

    return connection;
  } catch (error) {
    logScriptFailure("telegram-engagement:dispatch REFUSED", error);
    process.exitCode = 1;

    return null;
  }
}

async function main() {
  if (!isTelegramEngagementEnabled()) {
    console.log(
      "telegram-engagement:dispatch skipped — TELEGRAM_ENGAGEMENT_ENABLED is not true"
    );

    return;
  }

  const sql = await openDispatchConnection();

  if (sql === null) return;
  const correlationId = crypto.randomUUID();

  try {
    const tenants = (await sql`
      SELECT id FROM awcms_tenants WHERE status = 'active'
    `) as TenantRow[];

    const totals = {
      endpointsActivated: 0,
      endpointsFailed: 0,
      webhooksDeleted: 0,
      claimed: 0,
      sent: 0,
      uncertain: 0,
      failed: 0,
      retried: 0,
      cancelled: 0,
      deferred: 0
    };
    let failedTenants = 0;

    for (const tenant of tenants) {
      try {
        for (let pass = 0; pass < MAX_PASSES_PER_TENANT; pass += 1) {
          const result = await dispatchTelegramEngagement(sql, tenant.id, {
            correlationId
          });

          for (const key of Object.keys(totals) as (keyof typeof totals)[]) {
            totals[key] += result[key];
          }

          if (result.claimed === 0) break;
        }
      } catch (error) {
        failedTenants += 1;
        logScriptFailure(
          "telegram-engagement:dispatch tenant pass FAILED",
          error
        );
      }
    }

    // Counts per purpose only (no tenant id in a log line): a rate nobody
    // scheduled is the signal (ADR-0152 section 10, the decrypt counter).
    const decrypts: Record<string, number> = {};

    for (const entry of snapshotSecretDecryptCounts()) {
      decrypts[entry.purpose] = (decrypts[entry.purpose] ?? 0) + entry.count;
    }

    console.log(
      `telegram-engagement:dispatch complete — correlationId=${correlationId} ` +
        `tenants=${tenants.length} ` +
        Object.entries(totals)
          .map(([key, value]) => `${key}=${value}`)
          .join(" ") +
        ` failedTenants=${failedTenants} secretDecrypts=${JSON.stringify(decrypts)}`
    );
  } catch (error) {
    logScriptFailure("telegram-engagement:dispatch FAILED", error);
  } finally {
    await sql.close({ timeout: 1 });
  }
}

if (import.meta.main) {
  await main();
}
