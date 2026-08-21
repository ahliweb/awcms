import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { fetchPublicBlogPageBySlug } from "../../../../../../modules/blog-content/application/public-blog-directory";
import { mediaLibraryPortAdapter } from "../../../../../../modules/media-library/application/media-library-port-adapter";
import {
  collectRenderableGalleryMediaObjectIds,
  collectRenderableVideoNewsThumbnailMediaObjectIds
} from "../../../../../../modules/blog-content/domain/content-block-rendering";

/**
 * `GET /api/v1/blog/pages/public/{slug}` (Issue #594) — one reachable static
 * page, body included, for a build client.
 *
 * The predicate is `fetchPublicBlogPageBySlug`, shared byte-for-byte with the
 * public route `/blog/{tenantCode}/pages/{slug}`: `published`, `visibility IN
 * ('public', 'unlisted')`, not soft-deleted, `published_at` reached. A draft
 * cannot be read here for the same reason it cannot be read there, and there is
 * only one place that rule lives.
 *
 * An unreachable slug answers `404 RESOURCE_NOT_FOUND` rather than distinguishing
 * "no such page" from "that page is a draft". The caller is authenticated and
 * holds `pages.read`, so this is not an information-disclosure boundary — it is
 * consistency with the public route, so a consumer cannot come to depend on a
 * distinction the browser-facing surface does not make.
 *
 * ## Why the body ships as BOTH shapes
 *
 * `contentJson` is the projection this repo's own renderer reads today, and
 * `bodyPortableText` is the canonical column (ADR-0100). A consumer that reads
 * the projection keeps working; a consumer that reads Portable Text gets the
 * marks — bold, italic, links — that the projection is lossy about. Shipping
 * both is what lets `awcms-astro` move to the canonical column on its own
 * schedule instead of on this repo's.
 *
 * Gallery and video media are resolved to URLs in one bulk call, so a consumer
 * rendering a body does not have to walk it looking for ids and issue a request
 * per image.
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: {
    moduleKey: "blog_content",
    activityCode: "pages",
    action: "read"
  },
  handler: async ({ tx, tenantId, params }) => {
    const slug = params.slug;

    if (!slug) {
      return fail(400, "VALIDATION_ERROR", "Page slug is required.");
    }

    const page = await fetchPublicBlogPageBySlug(tx, tenantId, slug);

    if (!page) {
      return fail(404, "RESOURCE_NOT_FOUND", "Blog page not found.");
    }

    const mediaObjectIds = [
      ...new Set([
        ...collectRenderableGalleryMediaObjectIds(page.contentJson),
        ...collectRenderableVideoNewsThumbnailMediaObjectIds(page.contentJson),
        ...(page.featuredMediaId ? [page.featuredMediaId] : [])
      ])
    ];

    const resolved = await mediaLibraryPortAdapter.resolveMediaReferences(
      tx,
      tenantId,
      mediaObjectIds
    );

    return ok({
      ...page,
      // An id that no longer resolves is simply absent, the same "degrade,
      // don't error" rule the renderers apply — a consumer sees the reference
      // and no URL, and renders nothing for it.
      resolvedMedia: Object.fromEntries(
        [...resolved].map(([id, media]) => [
          id,
          {
            publicUrl: media.publicUrl,
            altText: media.altText,
            mimeType: media.mimeType,
            width: media.width,
            height: media.height
          }
        ])
      )
    });
  }
});
