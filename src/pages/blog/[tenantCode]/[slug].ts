import type { APIRoute } from "astro";

import { getDatabaseClient } from "../../../lib/database/client";
import { withTenant } from "../../../lib/database/tenant-context";
import { resolvePublicTenantByCode } from "../../../lib/tenant/public-tenant-resolver";
import { escapeHtml } from "../../../lib/html/escape";
import {
  notFoundHtmlResponse,
  serverErrorHtmlResponse
} from "../../../lib/html/error-responses";
import { log } from "../../../lib/logging/logger";
import { fetchPublicBlogPostBySlug } from "../../../modules/blog-content/application/public-blog-directory";
import { isLegacyTenantRouteEnabled } from "../../../modules/blog-content/application/public-route-settings";
import { fetchBlogSettings } from "../../../modules/blog-content/application/blog-settings-directory";
import { buildNewsArticleSeoMetadata } from "../../../modules/blog-content/application/news-article-seo-metadata";
import { newsMediaPortAdapter } from "../../../modules/news-portal/application/news-media-port-adapter";
import { resolveBlogShareConfig } from "../../../modules/blog-content/domain/social-share-config";
import { renderContentJsonToHtml } from "../../../modules/blog-content/domain/content-block-rendering";
import { renderContentHtmlWithInternalTagLinks } from "../../../modules/blog-content/application/internal-tag-link-rendering";
import {
  resolveCanonicalUrl,
  resolveMetaDescription,
  resolveSeoTitle
} from "../../../modules/blog-content/domain/seo-rendering";
import { renderPublicPageShell } from "../../../modules/blog-content/domain/public-page-rendering";
import { renderSocialShareButtonsHtml } from "../../../modules/blog-content/domain/social-share-links";

const NEWS_SHARE_CLIENT_SCRIPT_SRC = "/js/news-share.js";

/**
 * `GET /blog/{tenantCode}/{slug}` (Issue #540) — public post detail.
 * Reachable for `visibility IN ('public', 'unlisted')` (unlisted = direct
 * link only, excluded from every listing surface — see
 * `public-blog-directory.ts`'s doc comment); `private`, non-`published`,
 * scheduled-future, and soft-deleted posts always 404. Issue #564: also
 * 404s (same generic shape) when the tenant's `legacyTenantRouteEnabled`
 * setting is `false`.
 */
export const GET: APIRoute = async ({ params, url }) => {
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

    return await withTenant(sql, tenant.tenantId, async (tx) => {
      if (!(await isLegacyTenantRouteEnabled(tx, tenant.tenantId))) {
        return notFoundHtmlResponse();
      }

      const post = await fetchPublicBlogPostBySlug(tx, tenant.tenantId, slug);

      if (!post) {
        return notFoundHtmlResponse();
      }

      const selfUrl = `${url.origin}/blog/${tenantCode}/${post.slug}`;
      const seoTitle = resolveSeoTitle(post);
      const metaDescription = resolveMetaDescription(post);
      const canonicalUrl = resolveCanonicalUrl(post, selfUrl);

      // Issue #649 — see `/news/[slug].ts`'s identical comment: one shared
      // orchestration builds every SEO/social preview metadata value from a
      // single bulk media resolution, reusing Issue #636's exact
      // R2-verification primitive rather than re-deriving it.
      const blogSettings = await fetchBlogSettings(tx, tenant.tenantId);
      const seoMetadata = await buildNewsArticleSeoMetadata(
        tx,
        tenant.tenantId,
        newsMediaPortAdapter,
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

      // Issue #641 — see `/news/[slug].ts`'s identical comment: pure
      // render-time internal tag linking, never touching stored content.
      const contentHtml = await renderContentHtmlWithInternalTagLinks(
        tx,
        tenant.tenantId,
        renderedContentHtml,
        post.autoInternalTagLinksDisabled,
        `/blog/${tenantCode}`
      );

      // Issue #642 — see `/news/[slug].ts`'s identical comment: share
      // buttons only for this already-gated public/published post, built
      // from the resolved canonical URL only.
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
<p><a href="/blog/${escapeHtml(tenantCode)}">Back to blog</a></p>`;

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
    });
  } catch (error) {
    log("error", "public_blog.detail.failed", {
      tenantCode,
      slug,
      error: error instanceof Error ? error.message : String(error)
    });
    return serverErrorHtmlResponse();
  }
};
