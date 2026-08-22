import type { APIRoute } from "astro";

import { getDatabaseClient } from "../../../lib/database/client";
import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import { resolvePublicTenantByCode } from "../../../lib/tenant/public-tenant-resolver";
import { escapeXmlText } from "../../../lib/html/escape";
import { resolveRequestOrigin } from "../../../lib/http/site-origin";
import { DEFAULT_LOCALE } from "../../../lib/i18n/locales";
import { coerceLocale } from "../../../lib/i18n/negotiate";
import {
  buildHreflangAlternates,
  withPublicLocalePrefix
} from "../../../lib/i18n/public-locale-path";
import {
  notFoundXmlResponse,
  serverErrorXmlResponse
} from "../../../lib/html/error-responses";
import { log } from "../../../lib/logging/logger";
import {
  listPublicBlogPagesForSitemap,
  listPublicBlogPostsForFeed
} from "../../../modules/blog-content/application/public-blog-directory";
import { fetchBlogSettings } from "../../../modules/blog-content/application/blog-settings-directory";
import { isLegacyTenantRouteEnabled } from "../../../modules/blog-content/application/public-route-settings";
import { resolveNewsArticlePreviewImage } from "../../../modules/blog-content/application/news-article-seo-metadata";
import { mediaLibraryPortAdapter } from "../../../modules/media-library/application/media-library-port-adapter";
import { publishEdgeCacheTenant } from "../../../lib/edge-cache/publish-tenant";

/**
 * `GET /blog/{tenantCode}/sitemap-blog.xml` (Issue #540) — sitemap
 * protocol 0.9, same public visibility predicate as the RSS feed/index
 * (doc issue #540 §Sitemap Requirements: same exclusion list as RSS).
 * Issue #543 §Settings Page adds `sitemapEnabled` — same disabled-looks-
 * like-404 behavior as the RSS feed above. Issue #564 adds the same
 * generic 404 when the tenant's `legacyTenantRouteEnabled` setting is
 * `false`.
 */
export const GET: APIRoute = async ({ locals, params, request, url }) => {
  const tenantCode = params.tenantCode;

  if (!tenantCode) {
    return notFoundXmlResponse();
  }

  try {
    const sql = getDatabaseClient();
    const tenant = await resolvePublicTenantByCode(sql, tenantCode);

    if (!tenant) {
      return notFoundXmlResponse();
    }

    return await withTenantOrThrow(sql, tenant.tenantId, async (tx) => {
      if (!(await isLegacyTenantRouteEnabled(tx, tenant.tenantId))) {
        return notFoundXmlResponse();
      }

      const settings = await fetchBlogSettings(tx, tenant.tenantId);

      if (!settings.sitemapEnabled) {
        return notFoundXmlResponse();
      }

      const posts = await listPublicBlogPostsForFeed(tx, tenant.tenantId);
      // ADR-0098 — a sitemap must list the CANONICAL URL, and after this ADR the
      // canonical URL of every blog page carries a locale. Listing the bare path
      // would tell a crawler that the real document is the alias answering
      // `307`, contradicting the `<link rel="canonical">` on the page it points
      // at — the two would disagree, and search engines resolve that
      // disagreement by trusting neither.
      //
      // `<loc>` names the tenant default's spelling and the `xhtml:link`
      // alternates name every locale, which is the sitemap half of the same
      // `hreflang` set the page emits in its head.
      const origin = resolveRequestOrigin(url, request);
      const tenantDefaultLocale =
        coerceLocale(tenant.defaultLocale) ?? DEFAULT_LOCALE;
      const localisedUrl = (barePath: string): string =>
        `${origin}${withPublicLocalePrefix(barePath, tenantDefaultLocale)}`;
      const alternatesXml = (barePath: string): string =>
        buildHreflangAlternates(barePath, tenantDefaultLocale)
          .map(
            (alternate) =>
              `<xhtml:link rel="alternate" hreflang="${escapeXmlText(alternate.hreflang)}" href="${escapeXmlText(origin + alternate.pathname)}" />`
          )
          .join("\n");
      const channelPath = `/blog/${tenantCode}`;
      const channelLink = localisedUrl(channelPath);

      // Issue #649 — see `/news/sitemap-news.xml.ts`'s identical comment:
      // resolved sequentially, one query at a time on the shared transaction.
      const urlParts: string[] = [];
      for (const post of posts) {
        const postPath = `${channelPath}/${post.slug}`;
        const link = localisedUrl(postPath);
        const previewImage = await resolveNewsArticlePreviewImage(
          tx,
          tenant.tenantId,
          mediaLibraryPortAdapter,
          settings,
          post
        );
        const imageTag = previewImage
          ? `<image:image><image:loc>${escapeXmlText(previewImage.url)}</image:loc></image:image>`
          : "";

        urlParts.push(`<url>
<loc>${escapeXmlText(link)}</loc>
${alternatesXml(postPath)}
<lastmod>${post.publishedAt.toISOString()}</lastmod>
${imageTag}
</url>`);
      }

      // Issue #594 — static pages became publicly reachable in the same change
      // that added them here. A sitemap that omitted them would leave the one
      // surface a press council is expected to FIND (Pedoman Media Siber,
      // Redaksi) discoverable only by someone who already knew its URL.
      //
      // No `<image:image>`: pages carry no `seoImageMediaId`, so there is no
      // preview-image chain to resolve and nothing to emit.
      const pages = await listPublicBlogPagesForSitemap(tx, tenant.tenantId);

      for (const page of pages) {
        const pagePath = `${channelPath}/pages/${page.slug}`;

        urlParts.push(`<url>
<loc>${escapeXmlText(localisedUrl(pagePath))}</loc>
${alternatesXml(pagePath)}
<lastmod>${page.updatedAt.toISOString()}</lastmod>
</url>`);
      }

      const urls = urlParts.join("\n");

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" xmlns:xhtml="http://www.w3.org/1999/xhtml">
<url>
<loc>${escapeXmlText(channelLink)}</loc>
${alternatesXml(channelPath)}
</url>
${urls}
</urlset>`;

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

      return new Response(xml, {
        status: 200,
        headers: { "content-type": "application/xml; charset=utf-8" }
      });
    });
  } catch (error) {
    log("error", "public_blog.sitemap.failed", {
      tenantCode,
      error: error instanceof Error ? error.message : String(error)
    });
    return serverErrorXmlResponse();
  }
};
