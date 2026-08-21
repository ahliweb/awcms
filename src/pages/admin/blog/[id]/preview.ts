import type { APIRoute } from "astro";

import { loadAdminScreen } from "../../../../lib/auth/admin-screen";
import { escapeHtml } from "../../../../lib/html/escape";
import {
  notFoundHtmlResponse,
  serverErrorHtmlResponse
} from "../../../../lib/html/error-responses";
import { resolveRequestOrigin } from "../../../../lib/http/site-origin";
import { logAdminPageError } from "../../../../lib/logging/error-log";
import { fetchBlogPostById } from "../../../../modules/blog-content/application/blog-post-directory";
import { fetchBlogSettings } from "../../../../modules/blog-content/application/blog-settings-directory";
import { buildNewsArticleSeoMetadata } from "../../../../modules/blog-content/application/news-article-seo-metadata";
import { renderBlogBodyHtml } from "../../../../modules/blog-content/domain/blog-body-rendering";
import { renderPublicPageShell } from "../../../../modules/blog-content/domain/public-page-rendering";
import {
  resolveMetaDescription,
  resolveSeoTitle
} from "../../../../modules/blog-content/domain/seo-rendering";
import { mediaLibraryPortAdapter } from "../../../../modules/media-library/application/media-library-port-adapter";

/**
 * `GET /admin/blog/{id}/preview` (Issue #592) — what the article will look like.
 *
 * ## The gap this closes
 *
 * An editor wrote a body in a `<textarea>` and then GUESSED how it would appear.
 * Not a poor preview — none at all. Since #624 the body is rendered from the
 * canonical Portable Text, so what a reader sees now genuinely differs from what
 * the editing box shows: bold is bold, a link is a link, a list is a list.
 * Guessing got harder, not easier.
 *
 * ## Why it lives here and not in `awcms-astro`
 *
 * That repo is a static build declaring ZERO authenticated surfaces, and its own
 * suite goes red when a route leaves `output: 'static'` without saying so. Using
 * its admin-surface door would make the public template carry sessions, SSR and
 * CSP work, and PRD §45.10 still lists that as an OPEN decision. This repo
 * already has the session, the chokepoint, the audit trail, and the public
 * templates — building here reuses the whole authorization backbone instead of
 * standing up a second one.
 *
 * ## The same template, not a copy
 *
 * `renderBlogBodyHtml` + `renderPublicPageShell` — the exact functions
 * `/blog/{tenantCode}/{slug}` calls. A preview that re-implemented the template
 * would drift, and a preview that lies is worse than no preview: an editor would
 * trust it and ship the difference. `tests/blog-preview-route.test.ts` asserts
 * there is no second renderer here rather than trusting the comment.
 *
 * ## Nothing about this row is public
 *
 * The post is read through the ADMIN directory (`fetchBlogPostById`), because
 * the whole point is to see a DRAFT — the public predicate would find nothing.
 * That makes the two headers below load-bearing rather than ceremonial:
 *
 * - `X-Robots-Tag: noindex, nofollow` — a crawler that reached an authenticated
 *   URL must not index the draft it found.
 * - `Cache-Control: private, no-store` — no shared cache, no disk. The same pair
 *   `theming`'s preview already carries, for the same reason.
 *
 * The route also writes NOTHING. It cannot publish, cannot touch `published_at`,
 * and adds no row to the sitemap, the feed or the search index — those are built
 * from the publication predicate, which a draft does not satisfy. The gate for
 * the whole page is `blog_content.posts.update` through `loadAdminScreen`: the
 * person who may change the article is the person who may see it unpublished.
 */
export const GET: APIRoute = async ({ locals, params, request, url }) => {
  const ssr = locals.ssrContext;
  const postId = params.id;

  // `/admin/**` never reaches a handler without a session — the middleware
  // redirects to `/login` first — so this is a type narrowing, not a guard.
  if (!ssr || !postId) {
    return notFoundHtmlResponse();
  }

  const screen = await loadAdminScreen({
    ssr,
    workClass: "interactive",
    authorize: {
      moduleKey: "blog_content",
      activityCode: "posts",
      action: "update"
    },
    load: async ({ tx }) => {
      // `SsrContext` carries ids, not display names, so the tenant name comes
      // from one keyed single-row read. The same shape `internal-links/preview`
      // already uses for `tenant_code`; a READ of `awcms_tenants` is not the
      // shared-table WRITE `modules:table-writes:check` governs.
      const tenantRows = (await tx`
        SELECT tenant_name FROM awcms_tenants WHERE id = ${ssr.tenantId}
      `) as { tenant_name: string }[];
      const tenantName = tenantRows[0]?.tenant_name ?? "";

      // One transaction, one awaited query at a time — concurrent queries on a
      // single transaction connection leak it.
      const post = await fetchBlogPostById(tx, ssr.tenantId, postId);

      if (!post) {
        return { post: null, html: "" };
      }

      const blogSettings = await fetchBlogSettings(tx, ssr.tenantId);

      const seoTitle = resolveSeoTitle(post);
      const metaDescription = resolveMetaDescription(post);

      // A draft has no `published_at`, and the SEO builder and the shell both
      // want an instant. `updated_at` is the honest stand-in: it is when this
      // version came into being, which is exactly what a preview is showing.
      const previewInstant = post.publishedAt ?? post.updatedAt;

      const seoMetadata = await buildNewsArticleSeoMetadata(
        tx,
        ssr.tenantId,
        mediaLibraryPortAdapter,
        blogSettings,
        {
          post: { ...post, publishedAt: previewInstant },
          tenantName,
          // Deliberately null: JSON-LD is omitted rather than fabricated for a
          // URL that is not the article's own and must never be crawled.
          canonicalUrl: null,
          seoTitle,
          metaDescription
        }
      );

      const contentHtml = renderBlogBodyHtml(
        post,
        seoMetadata.resolvedGalleryUrls
      );

      // No ad slots and no share buttons. Both are things a READER gets, and
      // rendering an advertiser's creative into an editor's preview would count
      // an impression nobody saw. Internal tag linking is likewise absent: it is
      // a render-time transform over PUBLISHED terms, and showing it here would
      // suggest a draft already carries links it will only get on publication.
      const bodyHtml = `<article>
  <p><strong>${escapeHtml("Preview")}</strong> — ${escapeHtml(post.status)}</p>
  <h1>${escapeHtml(post.title)}</h1>
  <p><time datetime="${previewInstant.toISOString()}">${escapeHtml(previewInstant.toDateString())}</time></p>
  ${contentHtml}
</article>`;

      return {
        post,
        html: renderPublicPageShell({
          title: seoTitle,
          description: metaDescription,
          canonicalUrl: null,
          hreflangAlternates: [],
          bodyHtml,
          locale: post.locale,
          ogImageUrl: seoMetadata.ogImageUrl,
          ogImageAlt: seoMetadata.ogImageAlt,
          ogImageMimeType: seoMetadata.ogImageMimeType,
          ogImageWidth: seoMetadata.ogImageWidth,
          ogImageHeight: seoMetadata.ogImageHeight,
          siteName: tenantName,
          ogType: "article",
          articlePublishedTime: previewInstant.toISOString(),
          articleModifiedTime: post.updatedAt.toISOString(),
          articleSection: seoMetadata.articleSection,
          articleTags: seoMetadata.articleTags,
          // Never the post's own robots value: an editor previewing a `public`
          // article must still not have this URL indexed.
          robotsContent: "noindex, nofollow",
          structuredDataJsonLd: null,
          variant: "article"
        })
      };
    },
    onError: (error) => {
      logAdminPageError(
        "admin/blog/[id]/preview.ts: failed to render the preview",
        error,
        { correlationId: locals.correlationId }
      );
    }
  });

  if (screen.state === "denied") {
    // 403, not 404. This caller has already proved who they are, so hiding the
    // article's existence tells them nothing they could not learn from the list
    // they can already see — while "not found" would send them looking for a
    // bug instead of asking for the permission they are missing.
    return new Response(
      "<!doctype html><title>Forbidden</title><p>You do not have permission to preview this article.</p>",
      {
        status: 403,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "x-robots-tag": "noindex, nofollow",
          "cache-control": "private, no-store"
        }
      }
    );
  }

  if (screen.state === "error") {
    return serverErrorHtmlResponse();
  }

  if (!screen.data.post) {
    return notFoundHtmlResponse();
  }

  // `resolveRequestOrigin` is called for its side-effect-free validation of the
  // request's own origin, keeping this route inside the one place absolute URLs
  // are derived (`site-origin:check`).
  void resolveRequestOrigin(url, request);

  return new Response(screen.data.html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Both are the point, not decoration — see this file's header.
      "x-robots-tag": "noindex, nofollow",
      "cache-control": "private, no-store"
    }
  });
};
