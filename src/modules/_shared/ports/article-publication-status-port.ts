/**
 * `ArticlePublicationStatusPort` (Issue #1145, residual L8 of ADR-0157) — the
 * capability `blog_content` PROVIDES (`article_publication_status`) and
 * `social_publishing`'s dispatcher consumes: "is this article STILL published
 * publicly, right now?"
 *
 * A social publication freezes its content at enqueue (ADR-0157 section 4), so
 * an edit never changes what is sent. That freeze must not also mean an article
 * unpublished, archived, made private or deleted after the job was queued is
 * posted anyway: the dispatcher asks this port immediately before the provider
 * call and, on anything but `published`, fails the job terminally without
 * sending it.
 *
 * Same neutral-ground rule as every other port here: this file imports NOTHING
 * from any module. The concrete adapter
 * (`blog-content/application/article-publication-status-adapter.ts`) calls the
 * narrow SECURITY DEFINER function `awcms_social_source_article_state`
 * (`sql/386`), whose EXECUTE is granted to the dispatcher's role only: the
 * dispatcher learns one closed code for one id and gains no read of the posts
 * table. Only the composition root (`scripts/social-publishing-dispatch.ts`)
 * wires the adapter in.
 */

/** The only reason an article stops being publishable. A closed vocabulary: it is written to a job row. */
export type ArticlePublicationRefusal = "SOURCE_RETRACTED";

export type ArticlePublicationStatus =
  { published: true } | { published: false; reason: ArticlePublicationRefusal };

export type ArticlePublicationStatusPort = {
  /**
   * `published: true` only when the article of `tenantId` exists, is not
   * deleted, is `published` and publicly reachable (`public` or `unlisted`),
   * its publication moment has passed and its scheduled unpublish moment (if
   * any) has not. Every other case, an unknown id and another tenant's id
   * included, is `SOURCE_RETRACTED` (no existence oracle). `tx` must already be
   * scoped to `tenantId`; a mismatch THROWS (a bug, never a verdict). A database
   * error throws as well: it is never read as "published".
   */
  checkArticlePublished(
    tx: Bun.SQL,
    input: { tenantId: string; articleId: string }
  ): Promise<ArticlePublicationStatus>;
};
