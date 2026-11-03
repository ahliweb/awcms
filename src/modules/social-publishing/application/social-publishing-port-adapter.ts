/**
 * The concrete `SocialPublishingPort` (Issue #1145, ADR-0157 section 7). A
 * FACTORY, not a singleton: it needs `media_library`'s `MediaLibraryPort`, and
 * `social_publishing/application` must not import `media_library`'s concrete
 * adapter. Only a TRUE composition root (`POST /api/v1/blog/posts/{id}/publish`,
 * `scripts/blog-scheduled-publish.ts`) builds it, through
 * {@link resolveSocialPublishingPort}, which returns the real adapter ONLY when
 * the deployment enables the module and otherwise the existing no-op.
 *
 * ## Runs inside the article's publish transaction, and must never break it
 *
 * `onArticlePublished` is called by `blog_content` inside the transaction that
 * publishes the article. A thrown error there would abort the publication of an
 * article because a SOCIAL post could not be queued. So the whole body runs in a
 * savepoint: a failure rolls back only this module's writes, is logged with a
 * fixed code (never the thrown message), and the port answers
 * `{ jobsCreated: 0 }`.
 *
 * It makes plain DB writes only: no provider call, no network, no secret read.
 */
import type { ChannelPublisherPort } from "../../_shared/ports/channel-account-port";
import type { MediaLibraryPort } from "../../_shared/ports/media-library-port";
import type {
  ArticlePublishedEventInput,
  ArticlePublishedPortResult,
  SocialPublishingPort
} from "../../_shared/ports/social-publishing-port";
import { resolveDeclaredBaseUrl } from "../../../lib/http/site-origin";
import { log } from "../../../lib/logging/logger";
import { recordAuditEvent } from "../../logging/application/audit-log";
import {
  buildContentSnapshot,
  composeArticleCaption,
  type MediaFacts
} from "../domain/social-publish-content";
import {
  SOCIAL_PUBLISHING_MODULE_KEY,
  isSocialPublishingEnabled
} from "../domain/social-publishing-constants";
import { loadChannelPublisherPort } from "../infrastructure/channel-account-port-loader";
import {
  socialAdapterRegistry,
  type SocialAdapterRegistry
} from "../infrastructure/social-adapter-registry";
import {
  enqueuePublication,
  recordRefusedArticlePublication
} from "./publication-enqueue";
import { fetchSettings, listEnabledRuleAccountIds } from "./settings-directory";

export type SocialPublishingPortDeps = {
  mediaPort: MediaLibraryPort;
  /** Loads the channel-account publisher port. Defaults to the lazy loader; a failed load refuses every account (fail closed). */
  loadPublishers?: () => Promise<ChannelPublisherPort>;
  registry?: SocialAdapterRegistry;
  env?: NodeJS.ProcessEnv;
};

/** The article's public URL: this repo's path-scoped `/blog/{tenantCode}/{slug}` (ADR-0009) under the operator-declared origin. `null` when it cannot be made a safe `https` URL. */
async function buildArticleUrl(
  tx: Bun.SQL,
  tenantId: string,
  slug: string,
  env: NodeJS.ProcessEnv
): Promise<string> {
  const rows = (await tx`
    SELECT tenant_code FROM awcms_tenants WHERE id = ${tenantId}
  `) as { tenant_code: string }[];
  const code = rows[0]?.tenant_code ?? "";
  let origin = "";

  try {
    origin = new URL(resolveDeclaredBaseUrl(env)).origin;
  } catch {
    origin = "";
  }

  return `${origin}/blog/${encodeURIComponent(code)}/${encodeURIComponent(slug)}`;
}

export function createSocialPublishingPortAdapter(
  deps: SocialPublishingPortDeps
): SocialPublishingPort {
  const env = deps.env ?? process.env;
  const registry = deps.registry ?? socialAdapterRegistry;
  const loadPublishers = deps.loadPublishers ?? loadChannelPublisherPort;

  async function run(
    tx: Bun.SQL,
    tenantId: string,
    event: ArticlePublishedEventInput,
    correlationId: string | undefined
  ): Promise<ArticlePublishedPortResult> {
    const settings = await fetchSettings(tx, tenantId);

    if (!settings.autoPublishEnabled) return { jobsCreated: 0 };

    const accountIds = await listEnabledRuleAccountIds(
      tx,
      tenantId,
      event.trigger
    );

    if (accountIds.length === 0) return { jobsCreated: 0 };

    const linkUrl = await buildArticleUrl(tx, tenantId, event.slug, env);
    const caption = composeArticleCaption(event.title, event.excerpt);
    let media: MediaFacts | null = null;
    let mediaRefused = false;

    if (event.featuredMediaId) {
      const resolved = await deps.mediaPort.resolveMediaReferences(
        tx,
        tenantId,
        [event.featuredMediaId]
      );
      const found = resolved.get(event.featuredMediaId);

      if (found) {
        media = {
          publicUrl: found.publicUrl,
          altText: found.altText,
          mimeType: found.mimeType,
          sizeBytes: found.sizeBytes,
          creditLine: found.creditLine,
          copyrightStatus: found.copyrightStatus
        };
      } else {
        // The id names media that is not verified, not this tenant's or gone.
        mediaRefused = true;
      }
    }

    const snapshot = mediaRefused
      ? ({ ok: false, code: "MEDIA_NOT_ELIGIBLE" } as const)
      : buildContentSnapshot({
          title: event.title,
          caption,
          linkUrl,
          media
        });

    if (!snapshot.ok) {
      const recorded = await recordRefusedArticlePublication(tx, tenantId, {
        articleId: event.articleId,
        trigger: event.trigger,
        title: event.title,
        caption,
        refusalCode: snapshot.code,
        approvalRequired: settings.approvalRequired,
        correlationId
      });

      if (recorded.created) {
        await recordAuditEvent(tx, {
          tenantId,
          moduleKey: SOCIAL_PUBLISHING_MODULE_KEY,
          action: "social_publishing.publication.refused",
          resourceType: "social_publication",
          resourceId: recorded.publicationId,
          severity: "warning",
          message:
            "An article event was not queued for social publishing: its content cannot be published.",
          attributes: {
            articleId: event.articleId,
            trigger: event.trigger,
            refusalCode: snapshot.code
          },
          correlationId
        });
      }

      return { jobsCreated: 0 };
    }

    let publishers: ChannelPublisherPort | null = null;

    try {
      publishers = await loadPublishers();
    } catch {
      // A module import, not a query: every account is refused as unavailable.
      publishers = null;
    }

    const result = await enqueuePublication(
      tx,
      tenantId,
      {
        source: {
          kind: "article",
          articleId: event.articleId,
          trigger: event.trigger
        },
        snapshot: snapshot.snapshot,
        mediaObjectId: event.featuredMediaId,
        accountIds,
        approvalRequired: settings.approvalRequired,
        notBefore: null,
        actorTenantUserId: null,
        correlationId
      },
      { publishers, registry }
    );

    const refused = result.accounts.filter(
      (account) => account.outcome === "refused"
    );

    if (result.jobsCreated > 0 || refused.length > 0) {
      await recordAuditEvent(tx, {
        tenantId,
        moduleKey: SOCIAL_PUBLISHING_MODULE_KEY,
        action: "social_publishing.publication.enqueued",
        resourceType: "social_publication",
        ...(result.publicationId ? { resourceId: result.publicationId } : {}),
        severity: refused.length > 0 ? "warning" : "info",
        message: "An article event was queued for social publishing.",
        attributes: {
          articleId: event.articleId,
          trigger: event.trigger,
          jobsCreated: result.jobsCreated,
          refused: refused.map((account) => ({
            accountId: account.accountId,
            reason: account.outcome === "refused" ? account.reason : null
          }))
        },
        correlationId
      });
    }

    return { jobsCreated: result.jobsCreated };
  }

  return {
    async onArticlePublished(
      tx: Bun.SQL,
      tenantId: string,
      event: ArticlePublishedEventInput,
      correlationId?: string
    ): Promise<ArticlePublishedPortResult> {
      if (!isSocialPublishingEnabled(env)) return { jobsCreated: 0 };

      try {
        // The port is declared over `Bun.SQL`; every caller passes the
        // transaction it is publishing in, which has `savepoint`.
        const transaction = tx as Partial<Bun.TransactionSQL>;

        return typeof transaction.savepoint === "function"
          ? await transaction.savepoint((sp) =>
              run(sp, tenantId, event, correlationId)
            )
          : await run(tx, tenantId, event, correlationId);
      } catch {
        // tx-swallow-ok: the failure happened INSIDE `transaction.savepoint`,
        // which rolled back only this module's writes, so the article's own
        // transaction is not aborted and its publication proceeds. (Only the
        // no-savepoint fallback above runs unguarded, and it exists for a caller
        // that is not in a transaction at all.) Only a fixed code is logged: a
        // thrown message could carry content.
        log("error", "social_publishing.enqueue.failed", {
          tenantId,
          moduleKey: SOCIAL_PUBLISHING_MODULE_KEY,
          articleId: event.articleId,
          correlationId
        });

        return { jobsCreated: 0 };
      }
    }
  };
}

/**
 * The composition-root choice (ADR-0157 section 7): the real adapter only when
 * `SOCIAL_PUBLISHING_ENABLED` is on, otherwise the no-op the caller passes in
 * (`blog_content`'s own). A deployment that configures nothing therefore behaves
 * byte for byte as before this module existed.
 */
export function resolveSocialPublishingPort(
  noop: SocialPublishingPort,
  mediaPort: MediaLibraryPort,
  env: NodeJS.ProcessEnv = process.env
): SocialPublishingPort {
  return isSocialPublishingEnabled(env)
    ? createSocialPublishingPortAdapter({ mediaPort, env })
    : noop;
}
