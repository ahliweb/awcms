/**
 * PORT-TIME ADDITION (not present in awcms-mini) — a no-op
 * `SocialPublishingPort` implementation, injected at every composition root
 * (the manual `POST /api/v1/blog/posts/{id}/publish` route and the
 * `blog:publish:scheduled` worker) instead of
 * `social-publishing/application/social-publishing-port-adapter.ts`'s
 * `createSocialPublishingPortAdapter(...)` factory.
 *
 * `social_publishing` is NOT ported to this base yet. The port's own header
 * comment (`_shared/ports/social-publishing-port.ts`) already documents this
 * exact fallback: "a deployment that never enables `social_publishing` ...
 * still publishes articles exactly as before, this call simply becomes a
 * documented no-op (`{ jobsCreated: 0 }`) rather than an error." This
 * adapter IS that no-op, made explicit as a real value instead of an
 * `undefined`/optional-chained call, so `onArticlePublished` never needs a
 * conditional at its call sites.
 *
 * Swapping this for the real `social_publishing` adapter, once that module
 * is ported, is a pure composition-root change — no file in this module
 * needs to change.
 */
import type {
  ArticlePublishedPortResult,
  SocialPublishingPort
} from "../../_shared/ports/social-publishing-port";

export const noopSocialPublishingPortAdapter: SocialPublishingPort = {
  async onArticlePublished(): Promise<ArticlePublishedPortResult> {
    return { jobsCreated: 0 };
  }
};
