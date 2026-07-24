/**
 * Application-layer orchestration for Issue #640's content quality
 * checklist — the database/port-touching half of `content-quality-
 * checklist.ts`'s pure evaluator, same split as `news-media-reference-
 * gate.ts` (Issue #636) uses for the same reason: `domain` stays pure/
 * synchronously testable, this file does the real DB round trips and is
 * injected the caller's `MediaLibraryPort` (never imports `news_portal`
 * directly — see `_shared/ports/media-library-port.ts`'s header and
 * `tests/unit/module-boundary.test.ts`).
 *
 * Called from THREE composition roots (route handlers/scripts, per
 * ADR-0011): `POST /api/v1/blog/posts/{id}/publish`,
 * `POST /api/v1/blog/posts/{id}/schedule`, and the scheduled-publish worker
 * (`blog-scheduled-publish.ts`) — each injects `mediaLibraryPortAdapter` from
 * `media-library/application/media-library-port-adapter.ts`. Also called
 * read-only by the `GET .../quality-checklist` preview endpoints (posts AND
 * pages) that back the admin editor's checklist panel (Issue #640
 * acceptance criterion: "Checklist is available in admin post/page
 * editor").
 */
import { collectGalleryImageReferences } from "../domain/content-block-media-references";
import {
  evaluateContentQualityChecklist,
  notApplicableChecklistResult,
  type ChecklistContentKind,
  type ChecklistPolicyOverrides,
  type ContentQualityChecklistResult
} from "../domain/content-quality-checklist";
import { resolveSocialPreviewImageSourceId } from "../domain/social-preview-image-resolution";
import type { MediaLibraryPort } from "../../_shared/ports/media-library-port";

export type ChecklistEvaluableContent = {
  title: string;
  slug: string;
  excerpt: string | null;
  metaDescription: string | null;
  contentText: string;
  contentJson: Record<string, unknown>;
  featuredMediaId: string | null;
  /** Issue #649 — explicit "use this image for social/SEO preview" override. Optional/omittable — `awcms_blog_pages` has no such column, so the "page" content kind's caller simply never provides it (treated as `null`, same as not having one). */
  seoImageMediaId?: string | null;
};

/** Issue #649 — tenant-level social preview fallback settings (`blog-settings-directory.ts`'s `BlogSettingsView`), threaded through so the checklist's `social_preview_image_ready`/`social_preview_image_alt_text` rules use the EXACT SAME priority chain the render route resolves against — reused, not re-derived. */
export type SocialPreviewFallbackOptions = {
  tenantFallbackImageMediaId: string | null;
  contentImageFallbackEnabled: boolean;
};

export type EvaluateContentQualityChecklistOptions = {
  /** Present (non-null) only for the "schedule" action's own request body — `null` for an immediate publish or the scheduled-publish worker's due-post re-check. */
  scheduledAt?: Date | null;
  now?: Date;
  /** Omitted (or `null`) means no tenant fallback and no content-image fallback candidate — the checklist can still evaluate `social_preview_image_ready` from `featuredMediaId`/`seoImageMediaId` alone. */
  socialPreviewFallback?: SocialPreviewFallbackOptions | null;
};

/**
 * `termCount` is the caller's job to fetch (`fetchPostTermIds(tx, tenantId,
 * postId).length`, `blog-taxonomy-directory.ts`) — this file doesn't take a
 * `postId` at all, only content values, so it can also serve the "preview
 * before the post exists yet" case a future admin UI draft-preview might
 * want (not built by this issue, but the shape doesn't preclude it).
 */
export async function evaluateContentQualityChecklistForContent(
  tx: Bun.SQL,
  tenantId: string,
  contentKind: ChecklistContentKind,
  content: ChecklistEvaluableContent,
  termCount: number,
  mediaPort: MediaLibraryPort,
  overrides: ChecklistPolicyOverrides,
  options: EvaluateContentQualityChecklistOptions = {},
  env: NodeJS.ProcessEnv = process.env
): Promise<ContentQualityChecklistResult> {
  const modeActive = await mediaPort.isManagedMediaEnforcementActiveForTenant(
    tx,
    tenantId,
    env
  );

  if (!modeActive) {
    return notApplicableChecklistResult();
  }

  const {
    mediaObjectIds: galleryMediaObjectIds,
    violations: galleryViolations
  } = collectGalleryImageReferences(content.contentJson);

  const socialPreviewFallback = options.socialPreviewFallback ?? null;

  const idsToResolve = new Set<string>();
  if (content.featuredMediaId) {
    idsToResolve.add(content.featuredMediaId);
  }
  if (content.seoImageMediaId) {
    idsToResolve.add(content.seoImageMediaId);
  }
  for (const id of galleryMediaObjectIds) {
    idsToResolve.add(id);
  }
  if (socialPreviewFallback?.tenantFallbackImageMediaId) {
    idsToResolve.add(socialPreviewFallback.tenantFallbackImageMediaId);
  }

  const resolved = await mediaPort.resolveMediaReferences(tx, tenantId, [
    ...idsToResolve
  ]);

  const featuredMedia = content.featuredMediaId
    ? (resolved.get(content.featuredMediaId) ?? null)
    : null;

  const unsafeGalleryMediaObjectIds = galleryMediaObjectIds.filter(
    (id) => !resolved.has(id)
  );

  // Issue #649 — same priority chain the render route uses
  // (`news-article-seo-metadata.ts`'s `buildNewsArticleSeoMetadata`), so the
  // checklist's readiness rules can never silently diverge from what a
  // shared link actually renders.
  const socialPreviewMediaId = resolveSocialPreviewImageSourceId(
    {
      explicitSocialImageMediaId: content.seoImageMediaId ?? null,
      featuredMediaId: content.featuredMediaId,
      contentImageMediaIds: socialPreviewFallback?.contentImageFallbackEnabled
        ? galleryMediaObjectIds
        : [],
      tenantFallbackImageMediaId:
        socialPreviewFallback?.tenantFallbackImageMediaId ?? null
    },
    new Set(resolved.keys())
  );
  const socialPreviewMedia = socialPreviewMediaId
    ? (resolved.get(socialPreviewMediaId) ?? null)
    : null;

  return evaluateContentQualityChecklist(
    {
      contentKind,
      title: content.title,
      slug: content.slug,
      excerpt: content.excerpt,
      metaDescription: content.metaDescription,
      contentText: content.contentText,
      contentJson: content.contentJson,
      featuredMediaId: content.featuredMediaId,
      featuredMedia: featuredMedia
        ? {
            altText: featuredMedia.altText,
            width: featuredMedia.width,
            height: featuredMedia.height,
            mimeType: featuredMedia.mimeType,
            sizeBytes: featuredMedia.sizeBytes
          }
        : null,
      galleryViolations,
      unsafeGalleryMediaObjectIds,
      termCount,
      scheduledAt: options.scheduledAt ?? null,
      now: options.now ?? new Date(),
      socialPreviewImage: socialPreviewMedia
        ? { altText: socialPreviewMedia.altText }
        : null
    },
    overrides
  );
}

/** `{ field: ruleId, message }` pairs for every failed blocking rule — matches the existing `ErrorDetail` envelope shape (`ApiError.error.details`) the rest of this API already uses (`VALIDATION_ERROR`, `NEWS_MEDIA_REFERENCE_INVALID`), so a blocked publish/schedule response needs no new response envelope shape. */
export function checklistBlockersToErrorDetails(
  result: ContentQualityChecklistResult
): { field: string; message: string }[] {
  return result.blockers.map((blocker) => ({
    field: blocker.ruleId,
    message: blocker.message
  }));
}
