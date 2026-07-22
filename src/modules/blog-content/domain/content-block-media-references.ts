/**
 * Pure extraction of media references from `content_json` (Issue #636,
 * epic `news_portal`; extended by Issue #639 for the `video_news` block's
 * thumbnail). Deliberately separate from `content-block-rendering.ts`'s
 * renderer: this module answers "what does this content claim to
 * reference" (used by the application layer to verify those references
 * exist/are safe before a post/page is written), while the renderer
 * answers "how do I safely turn already-write-time-validated content into
 * HTML." Neither depends on the other.
 *
 * `collectGalleryImageReferences` only ever looked at `mediaType: "image"`
 * gallery items — `"video"` gallery items were, and remain, untouched by
 * it (that was never this file's job; a video news block is a distinct
 * block TYPE, not a gallery item). Issue #639 adds a second, independent
 * extraction function below (`collectVideoNewsThumbnailReferences`) for
 * the new `video_news` block type's OPTIONAL `thumbnailMediaObjectId`
 * field — additive, does not modify `collectGalleryImageReferences` at
 * all.
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRecordArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every(isRecord);
}

export type GalleryImageReferenceViolation = {
  /** 0-based index of the offending item within the `gallery` block's `items` array. */
  itemIndex: number;
  reason: "raw_url_not_allowed" | "media_object_id_missing_or_malformed";
  /**
   * The offending raw `url` value, only present when `reason` is
   * `"raw_url_not_allowed"` (Issue #640, content quality checklist) — lets a
   * caller classify the violation as a local path vs. an arbitrary external
   * URL (`content-quality-checklist.ts`'s `classifyRawImageUrl`) without a
   * second traversal of `contentJson` that could drift from this one.
   */
  rawUrl?: string;
};

export type GalleryImageReferences = {
  /** Deduplicated, well-formed-UUID `mediaObjectId`s referenced by image gallery items — candidates for existence/status verification. */
  mediaObjectIds: string[];
  /** Items that cannot possibly be valid in full-online R2-only mode, independent of whether any `mediaObjectId` actually resolves. */
  violations: GalleryImageReferenceViolation[];
};

/**
 * Scans every `gallery` block's `items` for `mediaType: "image"` entries.
 * Deliberately tolerant of malformed/unknown shapes elsewhere in
 * `contentJson` (mirrors `content-block-rendering.ts`'s own "skip, don't
 * throw" convention) — this function's job is only to enumerate what a
 * caller must verify, not to fully validate `contentJson`'s shape (that
 * remains `validateContentJsonField`'s job).
 */
export function collectGalleryImageReferences(
  contentJson: Record<string, unknown>
): GalleryImageReferences {
  const mediaObjectIds = new Set<string>();
  const violations: GalleryImageReferenceViolation[] = [];

  const blocks = contentJson.blocks;
  if (!isRecordArray(blocks)) {
    return { mediaObjectIds: [], violations: [] };
  }

  for (const block of blocks) {
    if (block.type !== "gallery" || !isRecordArray(block.items)) {
      continue;
    }

    block.items.forEach((item, itemIndex) => {
      if (item.mediaType !== "image") {
        return;
      }

      if (typeof item.url === "string" && item.url.trim().length > 0) {
        violations.push({
          itemIndex,
          reason: "raw_url_not_allowed",
          rawUrl: item.url
        });
        return;
      }

      if (
        typeof item.mediaObjectId !== "string" ||
        !UUID_PATTERN.test(item.mediaObjectId)
      ) {
        violations.push({
          itemIndex,
          reason: "media_object_id_missing_or_malformed"
        });
        return;
      }

      mediaObjectIds.add(item.mediaObjectId);
    });
  }

  return { mediaObjectIds: [...mediaObjectIds], violations };
}

export type VideoNewsThumbnailReferenceViolation = {
  /** 0-based index of the offending block within `contentJson.blocks`. */
  blockIndex: number;
  reason: "media_object_id_malformed";
};

export type VideoNewsThumbnailReferences = {
  /** Deduplicated, well-formed-UUID `thumbnailMediaObjectId`s referenced by `video_news` blocks — candidates for existence/status verification. */
  mediaObjectIds: string[];
  /** `video_news` blocks whose PRESENT `thumbnailMediaObjectId` cannot possibly be valid, independent of whether it actually resolves. */
  violations: VideoNewsThumbnailReferenceViolation[];
};

/**
 * Scans every `video_news` block for its optional `thumbnailMediaObjectId`
 * (Issue #639). A custom thumbnail is OPTIONAL (the issue's own Rules allow
 * a tenant to fall back to the provider's default thumbnail instead), so a
 * MISSING `thumbnailMediaObjectId` is never a violation — only a PRESENT
 * but malformed (non-UUID) one is. Existence/tenant-ownership/verified-
 * status checking of the ids returned here is the caller's job
 * (`application/video-news-thumbnail-reference-gate.ts`), same
 * "extraction is pure, verification needs a DB round trip" split
 * `collectGalleryImageReferences` established.
 */
export function collectVideoNewsThumbnailReferences(
  contentJson: Record<string, unknown>
): VideoNewsThumbnailReferences {
  const mediaObjectIds = new Set<string>();
  const violations: VideoNewsThumbnailReferenceViolation[] = [];

  const blocks = contentJson.blocks;
  if (!isRecordArray(blocks)) {
    return { mediaObjectIds: [], violations: [] };
  }

  blocks.forEach((block, blockIndex) => {
    if (
      block.type !== "video_news" ||
      block.thumbnailMediaObjectId === undefined ||
      block.thumbnailMediaObjectId === null
    ) {
      return;
    }

    if (
      typeof block.thumbnailMediaObjectId !== "string" ||
      !UUID_PATTERN.test(block.thumbnailMediaObjectId)
    ) {
      violations.push({ blockIndex, reason: "media_object_id_malformed" });
      return;
    }

    mediaObjectIds.add(block.thumbnailMediaObjectId);
  });

  return { mediaObjectIds: [...mediaObjectIds], violations };
}
