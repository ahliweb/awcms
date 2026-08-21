import { ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { listPublicBlogPagesForSitemap } from "../../../../../modules/blog-content/application/public-blog-directory";

/**
 * `GET /api/v1/blog/pages/public` (Issue #594) — the static pages a reader can
 * actually reach, for a build client that renders its own templates.
 *
 * ## Why this is not `GET /api/v1/blog/pages?status=published`
 *
 * Because that endpoint answers a different question and answers it correctly.
 * The admin list is an EDITOR's view: it returns `private` and `unlisted` pages
 * too, because an editor needs to see the page they marked private. A consumer
 * that reached for it with a status filter would publish every private page the
 * newsroom has, and nothing would report an error.
 *
 * The predicate here is the one the public route enforces —
 * `listPublicBlogPagesForSitemap`, shared with `sitemap-blog.xml` so the two
 * cannot disagree about what is public. One definition, three readers.
 *
 * ## Metadata only
 *
 * A body is fetched per page from `/{slug}` below, not inlined here. A tenant's
 * legal and identity pages are few but long, and a consumer discovering the set
 * should not have to download every disclaimer to find out there are four of
 * them.
 *
 * Guarded on `blog_content.pages.read` — the same "the builder authenticates"
 * decision as `GET /api/v1/site-profile/composed` (ADR-0102).
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: {
    moduleKey: "blog_content",
    activityCode: "pages",
    action: "read"
  },
  handler: async ({ tx, tenantId }) => {
    const pages = await listPublicBlogPagesForSitemap(tx, tenantId);

    return ok({ pages });
  }
});
