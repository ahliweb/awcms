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
 * One piece of content to evaluate, plus the caller's key for finding its
 * result again. The key is whatever the caller already has — a post id for the
 * sweep, a literal for a single evaluation — and is never interpreted here.
 */
export type ChecklistBatchItem<K> = {
  key: K;
  content: ChecklistEvaluableContent;
  /**
   * `termCount` is the caller's job to fetch — for a batch that means
   * `fetchPostTermIdsForPosts` (`blog-taxonomy-directory.ts`), not one
   * `fetchPostTermIds` per item. This file doesn't take a `postId` at all,
   * only content values, so it can also serve the "preview before the post
   * exists yet" case a future admin UI draft-preview might want.
   */
  termCount: number;
};

/** The batch key the singular wrapper below uses; never leaves this file. */
const SINGLE_ITEM_KEY = "single";

/**
 * `termCount` is the caller's job to fetch (`fetchPostTermIds(tx, tenantId,
 * postId).length`, `blog-taxonomy-directory.ts`) — this file doesn't take a
 * `postId` at all, only content values, so it can also serve the "preview
 * before the post exists yet" case a future admin UI draft-preview might
 * want (not built by this issue, but the shape doesn't preclude it).
 *
 * A batch of one over `evaluateContentQualityChecklistForBatch`, so the
 * interactive publish/schedule endpoints and the sweep job cannot come to
 * disagree about what the checklist says. Costs exactly what it did before:
 * one enforcement read, and one media resolve when there is anything to
 * resolve.
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
  const results = await evaluateContentQualityChecklistForBatch(
    tx,
    tenantId,
    contentKind,
    [{ key: SINGLE_ITEM_KEY, content, termCount }],
    mediaPort,
    overrides,
    options,
    env
  );

  // Present by construction: the batch returns one result per item it was
  // given, and it was given exactly one.
  return results.get(SINGLE_ITEM_KEY)!;
}

/**
 * The checklist for a WHOLE batch of content — a fixed number of round trips
 * rather than a fixed number PER ITEM.
 *
 * ## What is shared, and why sharing it is not an approximation
 *
 * Two of the three reads this gate makes are not per-item facts at all:
 *
 * - **Managed-media enforcement** is a property of the TENANT
 *   (`awcms_media_library_tenant_state`, one row), read once per item before
 *   this existed. Two hundred due posts asked the same question two hundred
 *   times and got the same answer.
 * - **Media resolution** is keyed by media object id, and ids are tenant-wide.
 *   Resolving the union of every item's references in one `id = ANY(...)`
 *   returns byte-identical rows to resolving each item's references
 *   separately; the per-item verdicts below read the same map they would have
 *   read from their own smaller one.
 *
 * The evaluation itself stays strictly per item: gallery references, the
 * social-preview priority chain and the pure rule evaluator all run once per
 * piece of content, against that content's own values.
 *
 * ## What a caller must still not do
 *
 * The batch is ONE consistent reading. A caller that needs a FRESH reading —
 * the scheduled-publish sweep re-evaluates immediately before it writes, to
 * shrink the window in which referenced media can be detached — must call this
 * again rather than reuse the returned results. Nothing is cached across calls,
 * which is what makes that second call meaningful.
 */
export async function evaluateContentQualityChecklistForBatch<K>(
  tx: Bun.SQL,
  tenantId: string,
  contentKind: ChecklistContentKind,
  items: readonly ChecklistBatchItem<K>[],
  mediaPort: MediaLibraryPort,
  overrides: ChecklistPolicyOverrides,
  options: EvaluateContentQualityChecklistOptions = {},
  env: NodeJS.ProcessEnv = process.env
): Promise<Map<K, ContentQualityChecklistResult>> {
  const results = new Map<K, ContentQualityChecklistResult>();

  if (items.length === 0) {
    return results;
  }

  const modeActive = await mediaPort.isManagedMediaEnforcementActiveForTenant(
    tx,
    tenantId,
    env
  );

  if (!modeActive) {
    for (const item of items) {
      results.set(item.key, notApplicableChecklistResult());
    }

    return results;
  }

  const socialPreviewFallback = options.socialPreviewFallback ?? null;

  // Indexed by POSITION, not by the caller's key. Two items sharing a key is a
  // caller's bug either way, but keying the intermediate work by it would make
  // one item evaluate against the OTHER's gallery — a wrong verdict rather than
  // a missing one. Position cannot collide.
  const galleryByIndex = items.map((item) =>
    collectGalleryImageReferences(item.content.contentJson)
  );

  const idsToResolve = new Set<string>();

  if (socialPreviewFallback?.tenantFallbackImageMediaId) {
    idsToResolve.add(socialPreviewFallback.tenantFallbackImageMediaId);
  }

  for (const [index, item] of items.entries()) {
    if (item.content.featuredMediaId) {
      idsToResolve.add(item.content.featuredMediaId);
    }
    if (item.content.seoImageMediaId) {
      idsToResolve.add(item.content.seoImageMediaId);
    }
    for (const id of galleryByIndex[index]!.mediaObjectIds) {
      idsToResolve.add(id);
    }
  }

  const resolved = await mediaPort.resolveMediaReferences(tx, tenantId, [
    ...idsToResolve
  ]);
  const resolvedIds = new Set(resolved.keys());

  // One moment for the whole batch. Time-dependent rules (`scheduledAt` vs
  // `now`) should not read a different clock for the two-hundredth post than
  // for the first — that would be a difference nobody chose, produced by how
  // long the loop took.
  const now = options.now ?? new Date();

  for (const [index, item] of items.entries()) {
    const { content, termCount } = item;
    const {
      mediaObjectIds: galleryMediaObjectIds,
      violations: galleryViolations
    } = galleryByIndex[index]!;

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
      resolvedIds
    );
    const socialPreviewMedia = socialPreviewMediaId
      ? (resolved.get(socialPreviewMediaId) ?? null)
      : null;

    results.set(
      item.key,
      evaluateContentQualityChecklist(
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
          now,
          socialPreviewImage: socialPreviewMedia
            ? { altText: socialPreviewMedia.altText }
            : null
        },
        overrides
      )
    );
  }

  return results;
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
