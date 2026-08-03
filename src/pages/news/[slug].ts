import type { APIRoute } from "astro";

import { getDatabaseClient } from "../../lib/database/client";
import { escapeHtml } from "../../lib/html/escape";
import {
  notFoundHtmlResponse,
  serverErrorHtmlResponse
} from "../../lib/html/error-responses";
import { log } from "../../lib/logging/logger";
import { fetchBlogSettings } from "../../modules/blog-content/application/blog-settings-directory";
import { renderContentHtmlWithInternalTagLinks } from "../../modules/blog-content/application/internal-tag-link-rendering";
import { buildNewsArticleSeoMetadata } from "../../modules/blog-content/application/news-article-seo-metadata";
import { fetchPublicBlogPostBySlug } from "../../modules/blog-content/application/public-blog-directory";
import {
  HOST_RESOLVED_PUBLIC_BASE_PATH,
  withHostResolvedBlogTenant
} from "../../modules/blog-content/application/public-host-route-tenant-resolution";
import { renderContentJsonToHtml } from "../../modules/blog-content/domain/content-block-rendering";
import { renderPublicPageShell } from "../../modules/blog-content/domain/public-page-rendering";
import {
  resolveCanonicalUrl,
  resolveMetaDescription,
  resolveSeoTitle
} from "../../modules/blog-content/domain/seo-rendering";
import { resolveBlogShareConfig } from "../../modules/blog-content/domain/social-share-config";
import { renderSocialShareButtonsHtml } from "../../modules/blog-content/domain/social-share-links";
import { mediaLibraryPortAdapter } from "../../modules/media-library/application/media-library-port-adapter";

const NEWS_SHARE_CLIENT_SCRIPT_SRC = "/js/news-share.js";

/**
 * `GET /news/{slug}` (ADR-0059 §A) — the host-resolved post detail, and the
 * page every `<loc>`/canonical/feed link points at once the family is live for
 * a tenant (`resolvePublicContentBasePath`).
 *
 * Byte-for-byte the same rendering pipeline as `/blog/{tenantCode}/{slug}` —
 * same visibility rules (`public`/`unlisted` reachable, everything else 404),
 * same SEO/social metadata orchestration over one bulk media resolution, same
 * render-time internal tag linking, same share widget — differing only in the
 * tenant resolution and therefore in the base path every self-referential link
 * is built under.
 */
export const GET: APIRoute = async ({ params, request, url }) => {
  const slug = params.slug;

  if (!slug) {
    return notFoundHtmlResponse();
  }

  try {
    const sql = getDatabaseClient();

    const result = await withHostResolvedBlogTenant(
      sql,
      request,
      async (tx, tenant) => {
        const post = await fetchPublicBlogPostBySlug(tx, tenant.tenantId, slug);

        // Same generic `null` as an unresolved host: a missing post must not be
        // distinguishable from a host this deployment does not serve.
        if (!post) {
          return null;
        }

        const selfUrl = `${url.origin}${HOST_RESOLVED_PUBLIC_BASE_PATH}/${post.slug}`;
        const seoTitle = resolveSeoTitle(post);
        const metaDescription = resolveMetaDescription(post);
        const canonicalUrl = resolveCanonicalUrl(post, selfUrl);

        const blogSettings = await fetchBlogSettings(tx, tenant.tenantId);
        const seoMetadata = await buildNewsArticleSeoMetadata(
          tx,
          tenant.tenantId,
          mediaLibraryPortAdapter,
          blogSettings,
          {
            post,
            tenantName: tenant.tenantName,
            canonicalUrl,
            seoTitle,
            metaDescription
          }
        );

        const renderedContentHtml = renderContentJsonToHtml(
          post.contentJson,
          seoMetadata.resolvedGalleryUrls
        );

        const contentHtml = await renderContentHtmlWithInternalTagLinks(
          tx,
          tenant.tenantId,
          renderedContentHtml,
          post.autoInternalTagLinksDisabled,
          HOST_RESOLVED_PUBLIC_BASE_PATH
        );

        const shareButtonsHtml = canonicalUrl
          ? renderSocialShareButtonsHtml(
              { canonicalUrl, title: seoTitle, excerpt: metaDescription },
              resolveBlogShareConfig(),
              NEWS_SHARE_CLIENT_SCRIPT_SRC
            )
          : "";

        const bodyHtml = `<article>
  <h1>${escapeHtml(post.title)}</h1>
  <p><time datetime="${post.publishedAt.toISOString()}">${escapeHtml(post.publishedAt.toDateString())}</time></p>
  ${contentHtml}
</article>
${shareButtonsHtml}
<p><a href="${HOST_RESOLVED_PUBLIC_BASE_PATH}">Back to all posts</a></p>`;

        const html = renderPublicPageShell({
          title: seoTitle,
          description: metaDescription,
          canonicalUrl,
          bodyHtml,
          locale: post.locale,
          ogImageUrl: seoMetadata.ogImageUrl,
          ogImageAlt: seoMetadata.ogImageAlt,
          ogImageMimeType: seoMetadata.ogImageMimeType,
          ogImageWidth: seoMetadata.ogImageWidth,
          ogImageHeight: seoMetadata.ogImageHeight,
          siteName: tenant.tenantName,
          ogType: "article",
          articlePublishedTime: post.publishedAt.toISOString(),
          articleModifiedTime: post.updatedAt.toISOString(),
          articleSection: seoMetadata.articleSection,
          articleTags: seoMetadata.articleTags,
          robotsContent: seoMetadata.robotsContent,
          structuredDataJsonLd: seoMetadata.structuredDataJsonLd,
          variant: "article"
        });

        return new Response(html, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" }
        });
      }
    );

    return result ?? notFoundHtmlResponse();
  } catch (error) {
    log("error", "public_news.detail.failed", {
      slug,
      error: error instanceof Error ? error.message : String(error)
    });
    return serverErrorHtmlResponse();
  }
};
