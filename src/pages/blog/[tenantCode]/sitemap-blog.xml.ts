import type { APIRoute } from "astro";

import { getDatabaseClient } from "../../../lib/database/client";
import { withTenant } from "../../../lib/database/tenant-context";
import { resolvePublicTenantByCode } from "../../../lib/tenant/public-tenant-resolver";
import { escapeHtml } from "../../../lib/html/escape";
import {
  notFoundXmlResponse,
  serverErrorXmlResponse
} from "../../../lib/html/error-responses";
import { log } from "../../../lib/logging/logger";
import { listPublicBlogPostsForFeed } from "../../../modules/blog-content/application/public-blog-directory";
import { fetchBlogSettings } from "../../../modules/blog-content/application/blog-settings-directory";
import { isLegacyTenantRouteEnabled } from "../../../modules/blog-content/application/public-route-settings";
import { resolveNewsArticlePreviewImage } from "../../../modules/blog-content/application/news-article-seo-metadata";
import { noopNewsMediaPortAdapter } from "../../../modules/blog-content/application/news-media-port-noop-adapter";

/**
 * `GET /blog/{tenantCode}/sitemap-blog.xml` (Issue #540) — sitemap
 * protocol 0.9, same public visibility predicate as the RSS feed/index
 * (doc issue #540 §Sitemap Requirements: same exclusion list as RSS).
 * Issue #543 §Settings Page adds `sitemapEnabled` — same disabled-looks-
 * like-404 behavior as the RSS feed above. Issue #564 adds the same
 * generic 404 when the tenant's `legacyTenantRouteEnabled` setting is
 * `false`.
 */
export const GET: APIRoute = async ({ params, url }) => {
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

    return await withTenant(sql, tenant.tenantId, async (tx) => {
      if (!(await isLegacyTenantRouteEnabled(tx, tenant.tenantId))) {
        return notFoundXmlResponse();
      }

      const settings = await fetchBlogSettings(tx, tenant.tenantId);

      if (!settings.sitemapEnabled) {
        return notFoundXmlResponse();
      }

      const posts = await listPublicBlogPostsForFeed(tx, tenant.tenantId);
      const channelLink = `${url.origin}/blog/${tenantCode}`;

      // Issue #649 — see `/news/sitemap-news.xml.ts`'s identical comment:
      // resolved sequentially, one query at a time on the shared transaction.
      const urlParts: string[] = [];
      for (const post of posts) {
        const link = `${channelLink}/${post.slug}`;
        const previewImage = await resolveNewsArticlePreviewImage(
          tx,
          tenant.tenantId,
          noopNewsMediaPortAdapter,
          settings,
          post
        );
        const imageTag = previewImage
          ? `<image:image><image:loc>${escapeHtml(previewImage.url)}</image:loc></image:image>`
          : "";

        urlParts.push(`<url>
<loc>${escapeHtml(link)}</loc>
<lastmod>${post.publishedAt.toISOString()}</lastmod>
${imageTag}
</url>`);
      }

      const urls = urlParts.join("\n");

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
<url>
<loc>${escapeHtml(channelLink)}</loc>
</url>
${urls}
</urlset>`;

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
