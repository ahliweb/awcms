import type { APIRoute } from "astro";

import { getDatabaseClient } from "../../../../lib/database/client";
import { withTenantOrThrow } from "../../../../lib/database/tenant-context";
import { resolvePublicTenantByCode } from "../../../../lib/tenant/public-tenant-resolver";
import { escapeHtml } from "../../../../lib/html/escape";
import { resolveRequestOrigin } from "../../../../lib/http/site-origin";
import { DEFAULT_LOCALE } from "../../../../lib/i18n/locales";
import { coerceLocale } from "../../../../lib/i18n/negotiate";
import { buildLocalisedPublicUrls } from "../../../../lib/i18n/public-locale-path";
import {
  notFoundHtmlResponse,
  serverErrorHtmlResponse
} from "../../../../lib/html/error-responses";
import { log } from "../../../../lib/logging/logger";
import { fetchPublicBlogPageBySlug } from "../../../../modules/blog-content/application/public-blog-directory";
import { isLegacyTenantRouteEnabled } from "../../../../modules/blog-content/application/public-route-settings";
import { mediaLibraryPortAdapter } from "../../../../modules/media-library/application/media-library-port-adapter";
import {
  collectBlogBodyMediaObjectIds,
  renderBlogBodyHtml
} from "../../../../modules/blog-content/domain/blog-body-rendering";
import {
  resolveCanonicalUrl,
  resolveMetaDescription,
  resolveRobotsMetaContent,
  resolveSeoTitle
} from "../../../../modules/blog-content/domain/seo-rendering";
import { renderPublicPageShell } from "../../../../modules/blog-content/domain/public-page-rendering";
import { publishEdgeCacheTenant } from "../../../../lib/edge-cache/publish-tenant";

/**
 * `GET /blog/{tenantCode}/pages/{slug}` (Issue #594) — the public route for
 * `awcms_blog_pages`.
 *
 * ## Why this route had to exist
 *
 * `awcms_blog_pages` has had full CRUD, lifecycle, revisions and a quality
 * checklist since Issue #539, an admin screen since ADR-0051 — and no reader
 * could reach a single one of them. Redaksi, the Pedoman Media Siber, the
 * disclaimer and the privacy policy are exactly the pages a news site is
 * REQUIRED to keep reachable (PRD §35; the Dewan Pers requires the Pedoman Media
 * Siber to be displayed), and every one of them was writable and unservable.
 *
 * ## Why `/pages/` and not `/blog/{tenantCode}/{slug}`
 *
 * Posts and pages have SEPARATE slug uniqueness (`awcms_blog_posts_slug_dedup`
 * and `awcms_blog_pages_slug_dedup` are two indexes over two tables), so serving
 * both from one segment would make `redaksi` resolvable to two different
 * documents with nothing to break the tie. A reserved segment is the same
 * decision `category/` and `tag/` already made, and it makes the collision
 * impossible rather than merely unlikely.
 *
 * The cost is one more reserved post slug — a post slugged `pages` is shadowed
 * by this directory, exactly as one slugged `category`, `tag` or `search`
 * already is. That is a pre-existing property of the route family, not something
 * this route introduces.
 *
 * ## Which stored body renders (Issue #624)
 *
 * Neither column unconditionally: `renderBlogBodyHtml` reads the canonical
 * Portable Text body (ADR-0100) when it holds something and the lossy
 * `content_json` projection when it does not, because `sql/134` leaves the
 * canonical column `'[]'` until `bun run blog:portable-text:backfill` runs and
 * an unconditional switch would blank every page on a deployment that has not.
 * The decision lives in that one function, and this route and the post route
 * moved together — as the earlier version of this comment said they had to.
 *
 * Mirrors the post detail route in every other respect: anonymous, tenant
 * resolved from the path segment (ADR-0009), `isLegacyTenantRouteEnabled` as the
 * first statement inside the transaction (Issue #564), a generic 404 for every
 * not-found reason so nothing distinguishes "no such tenant" from "no such page"
 * from "that page is a draft", and a generic 500 that never leaks a stack trace.
 */
export const GET: APIRoute = async ({ locals, params, request, url }) => {
  const tenantCode = params.tenantCode;
  const slug = params.slug;

  if (!tenantCode || !slug) {
    return notFoundHtmlResponse();
  }

  try {
    const sql = getDatabaseClient();
    const tenant = await resolvePublicTenantByCode(sql, tenantCode);

    if (!tenant) {
      return notFoundHtmlResponse();
    }

    return await withTenantOrThrow(sql, tenant.tenantId, async (tx) => {
      if (!(await isLegacyTenantRouteEnabled(tx, tenant.tenantId))) {
        return notFoundHtmlResponse();
      }

      const page = await fetchPublicBlogPageBySlug(tx, tenant.tenantId, slug);

      if (!page) {
        return notFoundHtmlResponse();
      }

      const urls = buildLocalisedPublicUrls(
        resolveRequestOrigin(url, request),
        `/blog/${tenantCode}/pages/${page.slug}`,
        locals.locale,
        coerceLocale(tenant.defaultLocale) ?? DEFAULT_LOCALE
      );
      const blogRootPath = buildLocalisedPublicUrls(
        resolveRequestOrigin(url, request),
        `/blog/${tenantCode}`,
        locals.locale,
        coerceLocale(tenant.defaultLocale) ?? DEFAULT_LOCALE
      ).basePath;

      const seoTitle = resolveSeoTitle(page);
      const metaDescription = resolveMetaDescription(page);
      const canonicalUrl = resolveCanonicalUrl(page, urls.canonicalUrl);

      // One bulk resolution for both embed kinds, same as the post route —
      // an id that does not resolve to a verified media object renders nothing
      // rather than a broken `<img>`. Issue #624: collected from both stored
      // body shapes, so the ids follow whichever one renders below.
      const bodyMedia = collectBlogBodyMediaObjectIds(page);
      const mediaObjectIds = [
        ...new Set([
          ...bodyMedia.galleryImageMediaObjectIds,
          ...bodyMedia.videoThumbnailMediaObjectIds
        ])
      ];
      const resolvedMedia =
        await mediaLibraryPortAdapter.resolveMediaReferences(
          tx,
          tenant.tenantId,
          mediaObjectIds
        );
      const resolvedMediaUrls = new Map(
        [...resolvedMedia].map(([id, media]) => [id, media.publicUrl])
      );

      const contentHtml = renderBlogBodyHtml(page, resolvedMediaUrls);

      // No share buttons and no `NewsArticle` JSON-LD: a privacy policy is not
      // an article, and stamping one with `datePublished`/`author` would tell a
      // crawler something untrue about what it is looking at.
      const bodyHtml = `<article>
  <h1>${escapeHtml(page.title)}</h1>
  ${contentHtml}
</article>
<p><a href="${escapeHtml(blogRootPath)}">Back to blog</a></p>`;

      const html = renderPublicPageShell({
        title: seoTitle,
        description: metaDescription,
        canonicalUrl,
        hreflangAlternates: urls.hreflangAlternates,
        bodyHtml,
        locale: page.locale,
        siteName: tenant.tenantName,
        robotsContent: resolveRobotsMetaContent(page.visibility),
        variant: "article"
      });

      // Finding B3 — publish the tenant this response belongs to, so middleware
      // does not repeat the `awcms_tenants` lookup this route already made on
      // every cache MISS. `discovery-route.ts:145` is the working precedent.
      //
      // HERE and not earlier, which is the rule `publish-tenant.ts` states: a
      // 404 is a cacheable status, so publishing before the missing-resource
      // branch would annotate that 404 differently from the unknown-tenant one
      // and answer "is this tenant code live?" from a single request. Every
      // `return notFound…` above is therefore left unpublished, and this sits
      // immediately before the only response that serves the resource.
      publishEdgeCacheTenant(locals, tenant.tenantId);

      return new Response(html, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" }
      });
    });
  } catch (error) {
    log("error", "public_blog.page_detail.failed", {
      tenantCode,
      slug,
      error: error instanceof Error ? error.message : String(error)
    });
    return serverErrorHtmlResponse();
  }
};
