/**
 * `ArticlePublicationStatusPort` adapter (Issue #1145, residual L8 of
 * ADR-0157): `blog_content`'s answer to "is this article still published
 * publicly, right now?", asked by the social dispatcher just before it calls a
 * provider.
 *
 * The answer comes from the SECURITY DEFINER function
 * `awcms_social_source_article_state` (`sql/386`), whose EXECUTE is granted to
 * `awcms_social_dispatch` only. The function, not this file, owns the
 * predicate, so the dispatcher's role never needs (and does not have) a read of
 * `awcms_blog_posts`. Anything the function returns other than `PUBLISHED` is a
 * refusal; an unexpected value is a refusal too (fail closed). A database
 * error, a tenant mismatch included, throws.
 *
 * Imports only the port type: the dispatch job's import graph (and with it the
 * secrets `ops/run-job.sh` hands that job, Issue #1120) does not grow.
 */
import type {
  ArticlePublicationStatus,
  ArticlePublicationStatusPort
} from "../../_shared/ports/article-publication-status-port";

export const articlePublicationStatusAdapter: ArticlePublicationStatusPort = {
  async checkArticlePublished(
    tx: Bun.SQL,
    input: { tenantId: string; articleId: string }
  ): Promise<ArticlePublicationStatus> {
    const rows = (await tx`
      SELECT awcms_social_source_article_state(
        ${input.tenantId}::uuid, ${input.articleId}::uuid
      ) AS state
    `) as { state: string | null }[];

    return rows[0]?.state === "PUBLISHED"
      ? { published: true }
      : { published: false, reason: "SOURCE_RETRACTED" };
  }
};
