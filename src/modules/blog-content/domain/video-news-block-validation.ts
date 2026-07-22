/**
 * Pure, write-time, UNCONDITIONAL validation/normalization of `video_news`
 * content_json blocks (Issue #639, epic `news_portal`). Unlike the
 * full-online-R2-only-mode-GATED `mediaObjectId` checks Issue #636 added
 * for gallery images/featured media (`news-media-reference-gate.ts`,
 * `content-block-media-references.ts`), the checks in this file are NOT
 * conditioned on that mode being active for the tenant — the issue's own
 * "Security notes" frame provider allowlisting and video ID/URL validation
 * as unconditional embed-safety controls (treat video embeds as high-risk
 * content, never store/render arbitrary iframe HTML), not an R2-storage
 * policy decision that should only bind full-online-R2-only tenants.
 *
 * Only the custom thumbnail's EXISTENCE/verification (a real R2 media
 * object reference, same policy as featured images and gallery images)
 * is mode-gated — that half lives in the separate
 * `application/video-news-thumbnail-reference-gate.ts` (mirrors
 * `news-media-reference-gate.ts`'s split of "shape here, DB round trip
 * there").
 *
 * "Video ID/URL must be validated and normalized server-side" (issue's own
 * Rules) is implemented literally by `normalizeYouTubeVideoId`: whatever
 * the client submits as `videoId` (a bare 11-character YouTube id, or a
 * full YouTube URL in any of its common forms — `watch?v=`, `youtu.be/`,
 * `/embed/`, `/shorts/`) is normalized down to the bare canonical id
 * before ever being persisted; `contentJson` written to the database never
 * contains the client's raw URL string.
 *
 * `validateAndNormalizeContentJsonVideoBlocks` also rebuilds every
 * `video_news` block from ONLY its known, normalized fields rather than
 * passing the client's object through — this means an attacker cannot
 * smuggle an extra field (e.g. a `rawEmbedHtml`/`iframe` key) past this
 * block type: even though `content-validation.ts`'s `containsUnsafeHtml`
 * regex scan already rejects a literal `<script>`/`<iframe>`/`<embed>`/
 * `<object>` substring anywhere in the stringified `contentJson`
 * (Issue #538, unconditional, applies to every block type including this
 * one), this whitelist reconstruction is a second, independent layer that
 * makes an unrecognized key on a `video_news` block vanish rather than
 * relying on pattern matching alone.
 *
 * Deliberately declares its own local `ValidationError` type rather than
 * importing `content-validation.ts`'s structurally-identical one — same
 * "small types are duplicated per file, not shared" convention
 * `blog-post-validation.ts`/`blog-page-validation.ts` already use for
 * `ValidationError`/the UUID regex, which keeps this file's collision
 * surface with any other content-block-validation change to zero.
 */

export type ValidationError = {
  field: string;
  message: string;
};

/** Only provider allowlisted today (issue's own Scope: "Initial provider allowlist: youtube"). Adding a second provider later requires a corresponding `normalize*VideoId` function — see `normalizeYouTubeVideoId` below for the shape a new one would need. */
export const VIDEO_NEWS_PROVIDERS = ["youtube"] as const;
export type VideoNewsProvider = (typeof VIDEO_NEWS_PROVIDERS)[number];

export function isVideoNewsProvider(
  value: unknown
): value is VideoNewsProvider {
  return (
    typeof value === "string" &&
    (VIDEO_NEWS_PROVIDERS as readonly string[]).includes(value)
  );
}

/** YouTube video ids are always exactly 11 characters of `[A-Za-z0-9_-]` — true for every current and historical YouTube video id format. */
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/**
 * Accepts a bare YouTube video id OR one of YouTube's common URL shapes and
 * returns the normalized bare id, or `null` for anything else (malformed
 * input, a non-YouTube host, a playlist-only link with no resolvable
 * video id, etc.) — the caller rejects rather than guesses. Never executes
 * a network request; this is pure string/URL parsing only.
 */
export function normalizeYouTubeVideoId(input: unknown): string | null {
  if (typeof input !== "string") {
    return null;
  }

  const trimmed = input.trim();

  if (YOUTUBE_VIDEO_ID_PATTERN.test(trimmed)) {
    return trimmed;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");

  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0] ?? "";
    return YOUTUBE_VIDEO_ID_PATTERN.test(id) ? id : null;
  }

  if (
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "youtube-nocookie.com"
  ) {
    if (url.pathname === "/watch") {
      const id = url.searchParams.get("v") ?? "";
      return YOUTUBE_VIDEO_ID_PATTERN.test(id) ? id : null;
    }

    const match = url.pathname.match(/^\/(?:embed|shorts|v)\/([^/]+)/);
    if (match) {
      const id = match[1] ?? "";
      return YOUTUBE_VIDEO_ID_PATTERN.test(id) ? id : null;
    }
  }

  return null;
}

export type NormalizedVideoNewsBlock = {
  type: "video_news";
  provider: VideoNewsProvider;
  videoId: string;
  title?: string;
  caption?: string;
  /**
   * Deliberately NOT format/existence-validated here — see this file's
   * header comment. A non-string value is simply dropped (never persisted,
   * never crashes the renderer, which independently type-checks it again
   * anyway) rather than rejected outright, mirroring how gallery items'
   * `mediaObjectId` is likewise untouched by any pure validator (Issue
   * #636): outside full-online R2-only mode a malformed reference here is
   * harmless — it just never resolves to anything at render time.
   */
  thumbnailMediaObjectId?: string;
  durationSeconds?: number;
  sourceLabel?: string;
};

const MAX_TITLE_LENGTH = 200;
const MAX_CAPTION_LENGTH = 500;
const MAX_SOURCE_LABEL_LENGTH = 120;
/** Generous sanity bound (7 days), not a real editorial limit — just enough to reject obviously-bogus input (negative, non-integer, absurdly large) without imposing an arbitrary "real" duration cap. */
const MAX_DURATION_SECONDS = 60 * 60 * 24 * 7;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRecordArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every(isRecord);
}

function validateOptionalStringField(
  value: unknown,
  maxLength: number,
  fieldPath: string,
  fieldName: string,
  errors: ValidationError[]
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || value.length > maxLength) {
    errors.push({
      field: fieldPath,
      message: `${fieldName} must be a string of at most ${maxLength} characters when provided.`
    });
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function validateVideoNewsBlock(
  block: Record<string, unknown>,
  blockIndex: number
): { errors: ValidationError[]; value: NormalizedVideoNewsBlock | null } {
  const path = `contentJson.blocks[${blockIndex}]`;
  const errors: ValidationError[] = [];

  const providerValid = isVideoNewsProvider(block.provider);
  if (!providerValid) {
    errors.push({
      field: `${path}.provider`,
      message: `provider must be one of: ${VIDEO_NEWS_PROVIDERS.join(", ")}.`
    });
  }

  // Only ever "youtube" today (the sole allowlisted provider) — skip
  // videoId normalization entirely when provider itself was rejected,
  // avoiding a confusing second error for the same root cause.
  let videoId: string | null = null;
  if (providerValid) {
    videoId = normalizeYouTubeVideoId(block.videoId);
    if (videoId === null) {
      errors.push({
        field: `${path}.videoId`,
        message: "videoId must be a valid YouTube video id or video URL."
      });
    }
  }

  const title = validateOptionalStringField(
    block.title,
    MAX_TITLE_LENGTH,
    `${path}.title`,
    "title",
    errors
  );
  const caption = validateOptionalStringField(
    block.caption,
    MAX_CAPTION_LENGTH,
    `${path}.caption`,
    "caption",
    errors
  );
  const sourceLabel = validateOptionalStringField(
    block.sourceLabel,
    MAX_SOURCE_LABEL_LENGTH,
    `${path}.sourceLabel`,
    "sourceLabel",
    errors
  );

  let durationSeconds: number | undefined;
  if (block.durationSeconds !== undefined) {
    if (
      typeof block.durationSeconds !== "number" ||
      !Number.isInteger(block.durationSeconds) ||
      block.durationSeconds < 0 ||
      block.durationSeconds > MAX_DURATION_SECONDS
    ) {
      errors.push({
        field: `${path}.durationSeconds`,
        message: `durationSeconds must be a non-negative integer of at most ${MAX_DURATION_SECONDS} when provided.`
      });
    } else {
      durationSeconds = block.durationSeconds;
    }
  }

  const thumbnailMediaObjectId =
    typeof block.thumbnailMediaObjectId === "string" &&
    block.thumbnailMediaObjectId.trim().length > 0
      ? block.thumbnailMediaObjectId.trim()
      : undefined;

  if (errors.length > 0 || !providerValid || videoId === null) {
    return { errors, value: null };
  }

  return {
    errors: [],
    value: {
      type: "video_news",
      provider: block.provider as VideoNewsProvider,
      videoId,
      ...(title !== undefined ? { title } : {}),
      ...(caption !== undefined ? { caption } : {}),
      ...(thumbnailMediaObjectId !== undefined
        ? { thumbnailMediaObjectId }
        : {}),
      ...(durationSeconds !== undefined ? { durationSeconds } : {}),
      ...(sourceLabel !== undefined ? { sourceLabel } : {})
    }
  };
}

export type ContentJsonVideoBlocksValidationResult =
  | { valid: true; value: Record<string, unknown> }
  | { valid: false; errors: ValidationError[] };

/**
 * Scans `contentJson.blocks` for `type === "video_news"` entries, validates
 * each unconditionally (provider allowlist, videoId format/normalization,
 * field shape/length), and returns a NEW `contentJson` with every
 * `video_news` block rebuilt from only its known, normalized fields — never
 * a straight passthrough of the client's raw block object. Every other
 * block type (paragraph/heading/list/quote/gallery/unknown) passes through
 * completely untouched — this function only ever looks at `video_news`
 * blocks.
 *
 * Tolerant of a missing/non-array `blocks` (nothing to validate here,
 * matching `content-validation.ts`'s own tolerance for that shape) — this
 * is NOT the place that rejects a malformed `contentJson` overall, only
 * `video_news` blocks within an otherwise-valid one.
 */
export function validateAndNormalizeContentJsonVideoBlocks(
  contentJson: Record<string, unknown>
): ContentJsonVideoBlocksValidationResult {
  const blocks = contentJson.blocks;

  if (!isRecordArray(blocks)) {
    return { valid: true, value: contentJson };
  }

  const errors: ValidationError[] = [];
  const normalizedBlocks = blocks.map((block, index) => {
    if (block.type !== "video_news") {
      return block;
    }

    const result = validateVideoNewsBlock(block, index);
    errors.push(...result.errors);
    return result.value ?? block;
  });

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, value: { ...contentJson, blocks: normalizedBlocks } };
}
