/**
 * `SocialPublishingPort` (Issue #643, epic `social_publishing`) — the
 * capability `blog_content` consumes from `social_publishing`: "an eligible
 * article just became published, create outbox jobs for it if applicable."
 * Lives in neutral ground (`_shared`, imports NOTHING from either module),
 * same reasoning `media-library-port.ts`/`public-content-port.ts` document in
 * their own headers.
 *
 * `optional: true` on `blog_content`'s `capabilities.consumes` entry for
 * this port (see `blog-content/module.ts`) — a deployment that never
 * enables `social_publishing` (the default; see
 * `social-publishing/domain/social-publishing-config.ts`) still publishes
 * articles exactly as before, this call simply becomes a documented no-op
 * (`{ jobsCreated: 0 }`) rather than an error.
 *
 * The concrete implementation
 * (`social-publishing/application/social-publishing-port-adapter.ts`) is a
 * FACTORY (`createSocialPublishingPortAdapter(mediaPort)`), not a ready-made
 * singleton — it itself needs `media_library`'s `MediaLibraryPort` (to resolve a
 * verified R2 image URL for the article, per the issue's own "Integration
 * with news content" section) but must not import `news_portal`'s concrete
 * adapter from within `social_publishing/application` (that would be the
 * exact anti-pattern Issue #681 fixed for `blog_content`/`news_portal`).
 * Only the TRUE composition root — `pages/api/v1/blog/posts/[id]/publish.ts`
 * and `scripts/blog-scheduled-publish.ts` — imports both concrete adapters
 * and wires them together: it imports `newsMediaPortAdapter` (the
 * `news_portal` media-port implementation) and
 * `createSocialPublishingPortAdapter` (this port's factory, from
 * `social-publishing/application/social-publishing-port-adapter.ts`), then
 * calls `createSocialPublishingPortAdapter(newsMediaPortAdapter)` once to
 * build the concrete `socialPublishingPort` value used at that call site.
 * (Deliberately described in prose, not a fenced code sample containing a
 * literal import statement — `tests/unit/module-boundary.test.ts`'s
 * text-pattern scan cannot distinguish a real import from one shown only as
 * an example inside a comment.)
 */
export type SocialPublishingTriggerEvent =
  "post_published" | "scheduled_published" | "manual_editor_action";

export type ArticlePublishedEventInput = {
  articleId: string;
  title: string;
  slug: string;
  excerpt: string | null;
  featuredMediaId: string | null;
  trigger: SocialPublishingTriggerEvent;
};

export type ArticlePublishedPortResult = {
  jobsCreated: number;
};

export type SocialPublishingPort = {
  /**
   * Enqueues outbox jobs for every enabled rule/account matching
   * `event.trigger`, snapshot-captures article content, and is fully
   * idempotent (a repeated call for the same article/trigger/account never
   * creates a second job — see `social-publish-idempotency.ts`). Runs
   * entirely as plain DB writes inside the CALLER's transaction (`tx`) —
   * no external provider call happens here (ADR-0006); the actual publish
   * attempt is made later, outside any transaction, by
   * `social-publish-dispatch.ts`.
   */
  onArticlePublished(
    tx: Bun.SQL,
    tenantId: string,
    event: ArticlePublishedEventInput,
    correlationId?: string
  ): Promise<ArticlePublishedPortResult>;
};
