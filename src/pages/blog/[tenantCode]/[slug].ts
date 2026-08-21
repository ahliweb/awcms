import type { APIRoute } from "astro";

import { getDatabaseClient } from "../../../lib/database/client";
import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import { resolvePublicTenantByCode } from "../../../lib/tenant/public-tenant-resolver";
import { escapeHtml } from "../../../lib/html/escape";
import { resolveRequestOrigin } from "../../../lib/http/site-origin";
import { DEFAULT_LOCALE } from "../../../lib/i18n/locales";
import { coerceLocale } from "../../../lib/i18n/negotiate";
import { buildLocalisedPublicUrls } from "../../../lib/i18n/public-locale-path";
import {
  notFoundHtmlResponse,
  serverErrorHtmlResponse
} from "../../../lib/html/error-responses";
import { log } from "../../../lib/logging/logger";
import { fetchPublicBlogPostBySlug } from "../../../modules/blog-content/application/public-blog-directory";
import { isLegacyTenantRouteEnabled } from "../../../modules/blog-content/application/public-route-settings";
import { fetchBlogSettings } from "../../../modules/blog-content/application/blog-settings-directory";
import { buildNewsArticleSeoMetadata } from "../../../modules/blog-content/application/news-article-seo-metadata";
import { mediaLibraryPortAdapter } from "../../../modules/media-library/application/media-library-port-adapter";
import { resolveBlogShareConfig } from "../../../modules/blog-content/domain/social-share-config";
import { renderBlogBodyHtml } from "../../../modules/blog-content/domain/blog-body-rendering";
import { renderContentHtmlWithInternalTagLinks } from "../../../modules/blog-content/application/internal-tag-link-rendering";
import {
  resolveCanonicalUrl,
  resolveMetaDescription,
  resolveSeoTitle
} from "../../../modules/blog-content/domain/seo-rendering";
import { renderPublicPageShell } from "../../../modules/blog-content/domain/public-page-rendering";
import { renderSocialShareButtonsHtml } from "../../../modules/blog-content/domain/social-share-links";
import { composeAdSlots } from "../../../modules/blog-content/application/ad-slot-composition";
import { AD_SLOT_AVAILABLE_LABEL } from "../../../modules/blog-content/domain/ad-slot-labels";
import { insertMidArticleSlotHtml } from "../../../modules/blog-content/domain/ad-slot-rendering";

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

      const post = await fetchPublicBlogPostBySlug(tx, tenant.tenantId, slug);

      if (!post) {
        return notFoundHtmlResponse();
      }

      // ADR-0098 — `selfUrl` is the PREFIXED spelling, because it becomes the
      // canonical URL when the post declares no external one. Leaving it bare
      // would point every crawler at the alias that answers `307`, and the two
      // real documents would be indexed as duplicates of a redirect.
      const urls = buildLocalisedPublicUrls(
        resolveRequestOrigin(url, request),
        `/blog/${tenantCode}/${post.slug}`,
        locals.locale,
        coerceLocale(tenant.defaultLocale) ?? DEFAULT_LOCALE
      );
      const blogRootPath = buildLocalisedPublicUrls(
        resolveRequestOrigin(url, request),
        `/blog/${tenantCode}`,
        locals.locale,
        coerceLocale(tenant.defaultLocale) ?? DEFAULT_LOCALE
      ).basePath;
      const selfUrl = urls.canonicalUrl;
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

      // Issue #624 — the CANONICAL body (ADR-0100) when it holds something,
      // the lossy `content_json` projection when it does not. Before this, a
      // phrase an editor bolded reached the reader plain, because nothing in
      // production called the Portable Text renderer at all.
      const renderedContentHtml = renderBlogBodyHtml(
        post,
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

      // Issue #594 — four slots on an article, and the target is THIS article:
      // `listActiveAdPlacementsForRendering` unions the placements scoped to it
      // with every global placement for the same slot, so a site-wide banner
      // still appears here without the editor booking it twice.
      const ads = await composeAdSlots(
        tx,
        tenant.tenantId,
        ["header_banner", "article_top", "article_middle", "article_bottom"],
        {
          target: { targetType: "post", targetId: post.id },
          placeholderLabel: AD_SLOT_AVAILABLE_LABEL
        }
      );

      const bodyHtml = `${ads.get("header_banner") ?? ""}
<article>
  <h1>${escapeHtml(post.title)}</h1>
  <p><time datetime="${post.publishedAt.toISOString()}">${escapeHtml(post.publishedAt.toDateString())}</time></p>
  ${ads.get("article_top") ?? ""}
  ${insertMidArticleSlotHtml(contentHtml, ads.get("article_middle") ?? "")}
</article>
${shareButtonsHtml}
${ads.get("article_bottom") ?? ""}
<p><a href="${escapeHtml(blogRootPath)}">Back to blog</a></p>`;

      const html = renderPublicPageShell({
        title: seoTitle,
        description: metaDescription,
        canonicalUrl,
        hreflangAlternates: urls.hreflangAlternates,
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
