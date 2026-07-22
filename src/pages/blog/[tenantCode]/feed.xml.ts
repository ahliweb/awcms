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
import { newsMediaPortAdapter } from "../../../modules/news-portal/application/news-media-port-adapter";
import { resolveMetaDescription } from "../../../modules/blog-content/domain/seo-rendering";

/**
 * `GET /blog/{tenantCode}/feed.xml` (Issue #540) — RSS 2.0, only
 * `published`+`public` posts (same predicate as the index/sitemap, doc
 * issue #540 §RSS Requirements: excludes unlisted/private/archived/
 * scheduled-future/draft/review/deleted). Hand-built XML string (no RSS
 * library dependency — Bun-only, AGENTS.md rule 14), escaped through the
 * same `escapeHtml` used for HTML (XML and HTML share the same five
 * entity escapes). Issue #543 §Settings Page adds `rssEnabled` — a tenant
 * that has turned the feed off gets the same 404 shape as an unknown
 * tenant/post (no distinguishable signal for a disabled vs. nonexistent
 * feed). Issue #564 adds the same generic 404 when the tenant's
 * `legacyTenantRouteEnabled` setting is `false`.
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

      if (!settings.rssEnabled) {
        return notFoundXmlResponse();
      }

      const posts = await listPublicBlogPostsForFeed(tx, tenant.tenantId);
      const channelLink = `${url.origin}/blog/${tenantCode}`;

      // Issue #649 — see `/news/feed.xml.ts`'s identical comment: resolved
      // sequentially, one query at a time on the shared transaction.
      const itemParts: string[] = [];
      for (const post of posts) {
        const link = `${channelLink}/${post.slug}`;
        const description = resolveMetaDescription(post);
        const previewImage = await resolveNewsArticlePreviewImage(
          tx,
          tenant.tenantId,
          newsMediaPortAdapter,
          settings,
          post
        );
        const enclosure = previewImage
          ? `<enclosure url="${escapeHtml(previewImage.url)}" length="${previewImage.sizeBytes ?? 0}" type="${escapeHtml(previewImage.mimeType)}" />`
          : "";

        itemParts.push(`<item>
<title>${escapeHtml(post.title)}</title>
<link>${escapeHtml(link)}</link>
<guid isPermaLink="true">${escapeHtml(link)}</guid>
<pubDate>${post.publishedAt.toUTCString()}</pubDate>
<description>${escapeHtml(description)}</description>
${enclosure}
</item>`);
      }

      const items = itemParts.join("\n");

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>${escapeHtml(tenant.tenantName)} Blog</title>
<link>${escapeHtml(channelLink)}</link>
<description>Latest posts from ${escapeHtml(tenant.tenantName)}.</description>
<language>${escapeHtml(tenant.defaultLocale)}</language>
${items}
</channel>
</rss>`;

      return new Response(xml, {
        status: 200,
        headers: { "content-type": "application/rss+xml; charset=utf-8" }
      });
    });
  } catch (error) {
    log("error", "public_blog.feed.failed", {
      tenantCode,
      error: error instanceof Error ? error.message : String(error)
    });
    return serverErrorXmlResponse();
  }
};
