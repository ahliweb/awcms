import { ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { composeHomepage } from "../../../../../modules/blog-content/application/homepage-composition";
import { mediaLibraryPortAdapter } from "../../../../../modules/media-library/application/media-library-port-adapter";

/**
 * `GET /api/v1/news-portal/homepage-sections/composed` (Issue #594) — the
 * RESOLVED homepage, for a build client that renders its own templates.
 *
 * ## Resolved, not configured
 *
 * `GET /api/v1/news-portal/homepage-sections` already returns the configuration,
 * and a consumer could in principle resolve it itself. It must not: doing so
 * would mean re-implementing the publication predicate — published, `visibility
 * = 'public'`, a reached `published_at`, not soft-deleted — in a second
 * repository on a second deploy cadence. The first time those two disagree, the
 * disagreement is a draft article on somebody's front page.
 *
 * So the same `composeHomepage` this repo's own `/blog/{tenantCode}` renders
 * from answers here, including its deterministic fallback and its caps. One
 * definition of "what is on the front page", two renderers.
 *
 * ## Guarded, not anonymous
 *
 * Same decision as `GET /api/v1/site-profile/composed` (ADR-0102) and
 * `GET /api/v1/media/public-origin`: "public read" means the public site's
 * BUILDER can read it, not that anyone can. The guard is this module's own
 * `blog_content.homepage_sections.read`.
 *
 * That is not ceremony. A curated homepage names which articles an editor
 * considers most important before they are on any page — an anonymous endpoint
 * would publish the front page ahead of the front page, and there is no reason
 * to hand that out to callers who are not building the site.
 *
 * ## Media arrives as URLs here, unlike everywhere else
 *
 * `composeHomepage` resolves media through `MediaLibraryPort` and yields public
 * URLs, so that is what is returned. The `site-profile` composed endpoint
 * deliberately returns media IDS instead, and the difference is real rather than
 * an inconsistency: a logo is one long-lived reference a consumer resolves once,
 * while a homepage is thirty cards whose images change every hour. Making a
 * build client resolve those one by one would turn one request into thirty-one.
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: {
    moduleKey: "blog_content",
    activityCode: "homepage_sections",
    action: "read"
  },
  handler: async ({ tx, tenantId, now }) => {
    const composed = await composeHomepage(
      tx,
      tenantId,
      mediaLibraryPortAdapter,
      now
    );

    return ok(composed);
  }
});
