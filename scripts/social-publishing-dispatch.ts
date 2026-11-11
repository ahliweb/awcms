/**
 * social-publishing-dispatch.ts — `bun run social-publishing:dispatch`.
 *
 * Issue #1145 (ADR-0157), credential path Issue #1146. Internal worker
 * entrypoint for the social publish dispatcher
 * (`src/modules/social-publishing/application/social-publish-dispatch.ts`) —
 * run on a schedule, never exposed over HTTP. Iterates every `active` tenant and
 * drains its due `awcms_social_publish_jobs` backlog in bounded passes, looping
 * per tenant until a pass claims nothing or `MAX_PASSES_PER_TENANT` is hit.
 *
 * No-op (opens no connection, exits 0) when `SOCIAL_PUBLISHING_ENABLED` is not
 * `"true"`, which is what makes it safe to schedule on every deployment profile
 * including offline/LAN. A pass that throws for one tenant is logged for THAT
 * tenant and does not stop the other tenants.
 *
 * ## It runs as its own role, `awcms_social_dispatch` (ADR-0157 section 6)
 *
 * Connected through `SOCIAL_PUBLISHING_DATABASE_URL`, with NO fallback: without
 * it the job refuses to run. It refuses as well when a shared login (the app,
 * worker or setup connection string) is in its environment, and when the server
 * says the connection is not exactly that role. The role (`sql/358` +
 * `sql/373`) holds only the columns the dispatcher touches and, of the channel
 * secrets, only the access token of a live, publish-granted social account. It
 * is neither `awcms_app` (every channel secret of every tenant) nor
 * `awcms_worker` (every WhatsApp sender credential, `sql/328`), so the key ring
 * this job holds meets no login that could read a WhatsApp, Mailketing or
 * Telegram secret.
 *
 * ## The credential path is composed behind a flag (default OFF)
 *
 * With `SOCIAL_PUBLISHING_FACEBOOK_ENABLED` not `"true"` the dispatcher is
 * composed with `noPublishCredentialPort` (every request refused, nothing
 * decrypted) and no connector is available. With it on, and only then, the
 * real `resolvePublishCredential` (the `channel_accounts` credential adapter,
 * which alone holds the key ring) is composed, together with the health port
 * that degrades an account whose token the provider refused.
 */
import {
  assertConnectedAsSocialDispatchRole,
  assertNoSharedLogins,
  getSocialPublishingDispatchDatabaseClient
} from "../src/lib/database/social-publishing-dispatch-client";
import { logScriptFailure } from "../src/lib/logging/error-log";
import type { ChannelPublisherCredentialPort } from "../src/modules/_shared/ports/channel-account-port";
import { channelAccountPortAdapter } from "../src/modules/channel-accounts/application/channel-account-port-adapter";
import { channelSenderCredentialAdapter } from "../src/modules/channel-accounts/application/channel-sender-credential-adapter";
import { articlePublicationStatusAdapter } from "../src/modules/blog-content/application/article-publication-status-adapter";
import { mediaPublicationRecheckAdapter } from "../src/modules/media-library/application/media-publication-recheck-adapter";
import {
  dispatchSocialPublishQueue,
  noPublishCredentialPort,
  type PublicationSourceChecks
} from "../src/modules/social-publishing/application/social-publish-dispatch";
import {
  isSocialPublishCredentialPathEnabled,
  isSocialPublishingEnabled
} from "../src/modules/social-publishing/domain/social-publishing-constants";

const MAX_PASSES_PER_TENANT = 10;

/**
 * The dispatch-time source re-check (ADR-0157 L8), composed unconditionally:
 * the article and media facts belong to `blog_content` and `media_library`, and
 * each adapter calls its narrow SECURITY DEFINER function (`sql/386`), whose
 * EXECUTE only this job's role holds.
 */
export const PUBLICATION_SOURCE_CHECKS: PublicationSourceChecks = {
  articles: articlePublicationStatusAdapter,
  media: mediaPublicationRecheckAdapter
};

type TenantRow = { id: string };

/**
 * The credential port this run is composed with. Only the PUBLISH method of
 * the channel credential adapter is exposed (never the WhatsApp one), and only
 * while a connector is switched on.
 */
export function composePublishCredentialPort(
  env: NodeJS.ProcessEnv = process.env
): ChannelPublisherCredentialPort {
  if (!isSocialPublishCredentialPathEnabled(env)) {
    return noPublishCredentialPort;
  }

  return {
    resolvePublishCredential: (tx, input) =>
      channelSenderCredentialAdapter.resolvePublishCredential(tx, input)
  };
}

/** The dispatcher's own connection, or `null` (logged, exit 1): never a broader fallback. */
async function openDispatchConnection(): Promise<Bun.SQL | null> {
  try {
    assertNoSharedLogins();

    const connection = getSocialPublishingDispatchDatabaseClient();

    await assertConnectedAsSocialDispatchRole(connection);

    return connection;
  } catch (error) {
    logScriptFailure("social-publishing:dispatch REFUSED", error);
    process.exitCode = 1;

    return null;
  }
}

async function main() {
  if (!isSocialPublishingEnabled()) {
    console.log(
      "social-publishing:dispatch skipped — SOCIAL_PUBLISHING_ENABLED is not true"
    );

    return;
  }

  const sql = await openDispatchConnection();

  if (sql === null) return;

  const correlationId = crypto.randomUUID();
  const credentials = composePublishCredentialPort();

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
    let unknown = 0;
    let failedTenants = 0;

    for (const tenant of tenants) {
      try {
        for (let pass = 0; pass < MAX_PASSES_PER_TENANT; pass += 1) {
          const result = await dispatchSocialPublishQueue(sql, tenant.id, {
            correlationId,
            publishers: channelAccountPortAdapter,
            credentials,
            health: channelAccountPortAdapter,
            sources: PUBLICATION_SOURCE_CHECKS
          });

          claimed += result.claimed;
          published += result.published;
          retried += result.retried;
          failed += result.failed;
          held += result.held;
          superseded += result.superseded;
          unknown += result.unknown;

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
        `unknown=${unknown} superseded=${superseded} ` +
        `failedTenants=${failedTenants} ` +
        `credentialPath=${credentials === noPublishCredentialPort ? "off" : "on"}`
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
