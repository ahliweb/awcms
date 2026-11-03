/**
 * social-publishing-dispatch.ts — `bun run social-publishing:dispatch`.
 *
 * Issue #1145 (ADR-0157). Internal worker entrypoint for the social publish
 * dispatcher (`src/modules/social-publishing/application/social-publish-dispatch.ts`)
 * — run on a schedule, never exposed over HTTP. Iterates every `active` tenant
 * and drains its due `awcms_social_publish_jobs` backlog in bounded passes,
 * looping per tenant until a pass claims nothing or `MAX_PASSES_PER_TENANT` is
 * hit.
 *
 * No-op (claims nothing, exits 0) when `SOCIAL_PUBLISHING_ENABLED` is not
 * `"true"` — see `dispatchSocialPublishQueue`'s own early return — which is what
 * makes it safe to schedule on every deployment profile including offline/LAN.
 * It also publishes nothing until a provider adapter is registered below: in this
 * slice no connector exists (#1146 to #1151), so `registerSocialAdapters()` is
 * empty by design.
 *
 * A pass that throws for one tenant is logged for THAT tenant and does not stop
 * the other tenants.
 *
 * ## Composition root of the credential port (Issue #1145)
 *
 * This script is the ONLY place the publisher credential port is composed: it is
 * what lets the dispatcher decrypt a tenant-owned account's credential
 * (`CHANNEL_SECRETS_ENCRYPTION_KEYS`, granted to this job in
 * `scripts/jobs-env-allowlist.ts`). The key ring is read in memory inside the
 * dispatch call, for the claimed row's tenant, and a decrypt count is printed in
 * the summary line (telemetry only: it lives in this process).
 */
import { getWorkerDatabaseClient } from "../src/lib/database/client";
import { logScriptFailure } from "../src/lib/logging/error-log";
import { channelAccountPortAdapter } from "../src/modules/channel-accounts/application/channel-account-port-adapter";
import { channelSenderCredentialAdapter } from "../src/modules/channel-accounts/application/channel-sender-credential-adapter";
import { snapshotSecretDecryptCounts } from "../src/modules/channel-accounts/application/secret-store";
import { dispatchSocialPublishQueue } from "../src/modules/social-publishing/application/social-publish-dispatch";

const MAX_PASSES_PER_TENANT = 10;

type TenantRow = { id: string };

/**
 * Provider connectors register their adapter here when they are admitted
 * (#1146 to #1151). Empty in this slice: with no adapter a job fails closed
 * (`PROVIDER_ADAPTER_UNAVAILABLE`) and enqueue refuses the account first.
 */
function registerSocialAdapters(): void {
  // Intentionally empty.
}

async function main() {
  const sql = getWorkerDatabaseClient();

  registerSocialAdapters();

  const correlationId = crypto.randomUUID();

  try {
    const tenants = (await sql`
      SELECT id FROM awcms_tenants WHERE status = 'active'
    `) as TenantRow[];

    let claimed = 0;
    let published = 0;
    let retried = 0;
    let failed = 0;
    let held = 0;
    let superseded = 0;
    let failedTenants = 0;

    for (const tenant of tenants) {
      try {
        for (let pass = 0; pass < MAX_PASSES_PER_TENANT; pass += 1) {
          const result = await dispatchSocialPublishQueue(sql, tenant.id, {
            correlationId,
            publishers: channelAccountPortAdapter,
            credentials: channelSenderCredentialAdapter
          });

          claimed += result.claimed;
          published += result.published;
          retried += result.retried;
          failed += result.failed;
          held += result.held;
          superseded += result.superseded;

          if (result.claimed === 0) break;
        }
      } catch (error) {
        failedTenants += 1;
        logScriptFailure(
          "social-publishing:dispatch tenant pass FAILED",
          error
        );
      }
    }

    console.log(
      `social-publishing:dispatch complete — correlationId=${correlationId} ` +
        `tenants=${tenants.length} claimed=${claimed} published=${published} ` +
        `retried=${retried} failed=${failed} held=${held} ` +
        `superseded=${superseded} ` +
        // A count per tenant and purpose, never a value: a compromised worker
        // enumerating credentials shows up as a rate nobody scheduled.
        `credentialDecrypts=${snapshotSecretDecryptCounts().reduce((sum, row) => sum + row.count, 0)} ` +
        `failedTenants=${failedTenants}`
    );
  } catch (error) {
    logScriptFailure("social-publishing:dispatch FAILED", error);
  } finally {
    await sql.close({ timeout: 1 });
  }
}

if (import.meta.main) {
  await main();
}
