/**
 * Application-layer orchestration for Issue #649's full SEO/social preview
 * metadata on a public post detail page — the single place that bulk-
 * resolves every candidate media object id (featured image, explicit SEO
 * image override, gallery images, video thumbnails, tenant fallback social
 * image) in ONE `NewsMediaPort.resolveMediaReferences` call, picks the
 * winning social preview image via the pure priority chain
 * (`social-preview-image-resolution.ts`), and builds the `NewsArticle`
 * JSON-LD object. Shared by BOTH public post detail routes (`/news/[slug].ts`,
 * `/blog/[tenantCode]/[slug].ts`) so they can never silently diverge on how
 * the image/robots/structured-data metadata is derived — same "one
 * orchestration function, route only wires I/O" convention
 * `content-quality-checklist-gate.ts` and `news-media-reference-gate.ts`
 * already established for this epic.
 */
import type { NewsMediaPort } from "../../_shared/ports/news-media-port";
import type { PublicBlogPostDetail } from "./public-blog-directory";
import { fetchPublicPostTaxonomyTerms } from "./public-blog-directory";
import type { BlogSettingsView } from "./blog-settings-directory";
import {
  collectRenderableGalleryMediaObjectIds,
  collectRenderableVideoNewsThumbnailMediaObjectIds
} from "../domain/content-block-rendering";
import {
  resolveSocialPreviewImageSourceId,
  type SocialPreviewImageCandidates
} from "../domain/social-preview-image-resolution";
import {
  deriveArticleSectionAndTags,
  resolveOgImageUrl,
  resolveRobotsMetaContent
} from "../domain/seo-rendering";
import { buildNewsArticleJsonLd } from "../domain/structured-data-rendering";

export type NewsArticleSeoMetadataInput = {
  post: PublicBlogPostDetail;
  tenantName: string;
  /** Already-resolved via `resolveCanonicalUrl` — `null` means JSON-LD is omitted entirely (`mainEntityOfPage`/`@id` requires a real URL). */
  canonicalUrl: string | null;
  /** Already-resolved via `resolveSeoTitle` — used as JSON-LD `headline`. */
  seoTitle: string;
  /** Already-resolved via `resolveMetaDescription` — used as JSON-LD `description`. */
  metaDescription: string;
};

export type NewsArticleSeoMetadata = {
  /** `mediaObjectId -> publicUrl`, for `renderContentJsonToHtml`'s gallery/video-thumbnail rendering — same map shape every existing caller already builds, now built once here instead of per-route. */
  resolvedGalleryUrls: ReadonlyMap<string, string>;
  ogImageUrl: string | null;
  ogImageAlt: string | null;
  ogImageMimeType: string | null;
  ogImageWidth: number | null;
  ogImageHeight: number | null;
  robotsContent: string;
  articleSection: string | null;
  articleTags: string[];
  /** `null` when `canonicalUrl` was `null` — no safe `mainEntityOfPage` to point at. */
  structuredDataJsonLd: Record<string, unknown> | null;
};

export async function buildNewsArticleSeoMetadata(
  tx: Bun.SQL,
  tenantId: string,
  mediaPort: NewsMediaPort,
  blogSettings: BlogSettingsView,
  input: NewsArticleSeoMetadataInput
): Promise<NewsArticleSeoMetadata> {
  const galleryMediaObjectIds = collectRenderableGalleryMediaObjectIds(
    input.post.contentJson
  );
  const videoThumbnailMediaObjectIds =
    collectRenderableVideoNewsThumbnailMediaObjectIds(input.post.contentJson);

  const candidateIds = new Set<string>();
  if (input.post.featuredMediaId) {
    candidateIds.add(input.post.featuredMediaId);
  }
  if (input.post.seoImageMediaId) {
    candidateIds.add(input.post.seoImageMediaId);
  }
  for (const id of galleryMediaObjectIds) {
    candidateIds.add(id);
  }
  for (const id of videoThumbnailMediaObjectIds) {
    candidateIds.add(id);
  }
  if (blogSettings.socialPreviewFallbackImageMediaId) {
    candidateIds.add(blogSettings.socialPreviewFallbackImageMediaId);
  }

  const resolvedMedia = await mediaPort.resolveMediaReferences(tx, tenantId, [
    ...candidateIds
  ]);

  const resolvedGalleryUrls = new Map(
    [...resolvedMedia].map(([id, media]) => [id, media.publicUrl])
  );

  const socialPreviewCandidates: SocialPreviewImageCandidates = {
    explicitSocialImageMediaId: input.post.seoImageMediaId,
    featuredMediaId: input.post.featuredMediaId,
    // Priority tier #3 ("first verified R2 image in content") deliberately
    // considers only gallery-block images, never `video_news` block
    // thumbnails — `videoThumbnailMediaObjectIds` is bulk-resolved above
    // for `resolvedGalleryUrls` (the video thumbnail `<img>` itself needs
    // it) but is intentionally excluded here: a video thumbnail is a
    // still frame representing embedded video, not an editorial photo, so
    // using it as the article's own social/SEO preview image would be a
    // scope expansion beyond the issue's "image in content" wording, not
    // an oversight.
    contentImageMediaIds: blogSettings.socialPreviewContentImageFallbackEnabled
      ? galleryMediaObjectIds
      : [],
    tenantFallbackImageMediaId: blogSettings.socialPreviewFallbackImageMediaId
  };

  const socialPreviewMediaId = resolveSocialPreviewImageSourceId(
    socialPreviewCandidates,
    new Set(resolvedMedia.keys())
  );
  const socialPreviewMedia = socialPreviewMediaId
    ? (resolvedMedia.get(socialPreviewMediaId) ?? null)
    : null;

  const ogImageUrl = resolveOgImageUrl(socialPreviewMedia?.publicUrl ?? null);
  const robotsContent = resolveRobotsMetaContent(input.post.visibility);

  const terms = await fetchPublicPostTaxonomyTerms(tx, tenantId, input.post.id);
  const { section, tags } = deriveArticleSectionAndTags(terms);

  let structuredDataJsonLd: Record<string, unknown> | null = null;

  if (input.canonicalUrl) {
    // Best-effort publisher logo: reuse the tenant fallback social image if
    // it resolved safely — this repo has no dedicated "tenant logo" concept,
    // so a JSON-LD `publisher.logo` is omitted (not fabricated from an
    // unverified source) when no fallback image is configured/resolved.
    const fallbackLogoMedia = blogSettings.socialPreviewFallbackImageMediaId
      ? (resolvedMedia.get(blogSettings.socialPreviewFallbackImageMediaId) ??
        null)
      : null;

    structuredDataJsonLd = buildNewsArticleJsonLd({
      headline: input.seoTitle,
      description: input.metaDescription,
      canonicalUrl: input.canonicalUrl,
      image: ogImageUrl
        ? {
            url: ogImageUrl,
            width: socialPreviewMedia?.width ?? null,
            height: socialPreviewMedia?.height ?? null
          }
        : null,
      datePublished: input.post.publishedAt,
      dateModified: input.post.updatedAt,
      authorName: input.tenantName,
      publisherName: input.tenantName,
      publisherLogoUrl: fallbackLogoMedia
        ? resolveOgImageUrl(fallbackLogoMedia.publicUrl)
        : null,
      articleSection: section,
      tags
    });
  }

  return {
    resolvedGalleryUrls,
    ogImageUrl,
    ogImageAlt: socialPreviewMedia?.altText ?? null,
    ogImageMimeType: socialPreviewMedia?.mimeType ?? null,
    ogImageWidth: socialPreviewMedia?.width ?? null,
    ogImageHeight: socialPreviewMedia?.height ?? null,
    robotsContent,
    articleSection: section,
    articleTags: tags,
    structuredDataJsonLd
  };
}

export type ResolvedNewsArticlePreviewImage = {
  url: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  altText: string | null;
};

/**
 * Lighter-weight sibling of `buildNewsArticleSeoMetadata`, for RSS/sitemap
 * rendering (Issue #649 — "RSS and sitemap/news sitemap should use...
 * verified R2 preview images where applicable"): resolves ONLY the winning
 * social preview image (same priority chain, same R2-verification
 * primitive), without also fetching taxonomy terms or building JSON-LD —
 * neither is needed for an RSS `<enclosure>`/sitemap `<image:image>` entry.
 * Called once per feed/sitemap item (bounded by `FEED_ITEM_LIMIT`, currently
 * 50) — each call is its own small bulk resolution (featured + SEO image +
 * gallery + tenant fallback ids for ONE post), not a single combined query
 * across the whole feed, matching this epic's existing per-post resolution
 * granularity (`content-quality-checklist-gate.ts`'s scheduled-publish loop
 * does the same "resolve per item" thing for a bounded batch).
 */
export async function resolveNewsArticlePreviewImage(
  tx: Bun.SQL,
  tenantId: string,
  mediaPort: NewsMediaPort,
  blogSettings: BlogSettingsView,
  post: PublicBlogPostDetail
): Promise<ResolvedNewsArticlePreviewImage | null> {
  const galleryMediaObjectIds = collectRenderableGalleryMediaObjectIds(
    post.contentJson
  );

  const candidateIds = new Set<string>();
  if (post.featuredMediaId) {
    candidateIds.add(post.featuredMediaId);
  }
  if (post.seoImageMediaId) {
    candidateIds.add(post.seoImageMediaId);
  }
  for (const id of galleryMediaObjectIds) {
    candidateIds.add(id);
  }
  if (blogSettings.socialPreviewFallbackImageMediaId) {
    candidateIds.add(blogSettings.socialPreviewFallbackImageMediaId);
  }

  const resolvedMedia = await mediaPort.resolveMediaReferences(tx, tenantId, [
    ...candidateIds
  ]);

  const chosenId = resolveSocialPreviewImageSourceId(
    {
      explicitSocialImageMediaId: post.seoImageMediaId,
      featuredMediaId: post.featuredMediaId,
      // Gallery images only, never video_news thumbnails — same deliberate
      // scope decision as `buildNewsArticleSeoMetadata` above, see its
      // comment for the full reasoning.
      contentImageMediaIds:
        blogSettings.socialPreviewContentImageFallbackEnabled
          ? galleryMediaObjectIds
          : [],
      tenantFallbackImageMediaId: blogSettings.socialPreviewFallbackImageMediaId
    },
    new Set(resolvedMedia.keys())
  );

  const media = chosenId ? (resolvedMedia.get(chosenId) ?? null) : null;
  const url = media ? resolveOgImageUrl(media.publicUrl) : null;

  if (!media || !url) {
    return null;
  }

  return {
    url,
    mimeType: media.mimeType,
    width: media.width,
    height: media.height,
    sizeBytes: media.sizeBytes,
    altText: media.altText
  };
}
