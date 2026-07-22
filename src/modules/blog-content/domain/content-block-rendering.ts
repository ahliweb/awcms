import { escapeHtml } from "../../../lib/html/escape";
import {
  collectGalleryImageReferences,
  collectVideoNewsThumbnailReferences
} from "./content-block-media-references";
import {
  renderGalleryBlockHtml,
  type GalleryBlockItem,
  type ResolvedGalleryMediaUrls
} from "../../_shared/rendering/gallery-block-renderer";
import {
  renderVideoNewsBlockHtml,
  type VideoNewsBlockItem
} from "../../_shared/rendering/video-news-block-renderer";

/**
 * Safe, whitelist-based renderer for `content_json` (Issue #540 §Content
 * Safety Requirements: "Use structured JSON content as the source of
 * truth", "Rendering must sanitize or safely render content", "Script
 * tags/inline JavaScript/dangerous iframe-embed must be rejected or
 * stripped"). `content_json` was already write-time-rejected for unsafe
 * markup (`validateContentJsonField`, Issue #538) — this is the
 * *rendering*-side defense-in-depth layer: every block type in the
 * whitelist below only ever emits text through `escapeHtml`, and any
 * value outside the whitelist (unknown block `type`, non-string `text`,
 * raw HTML field, etc.) is silently skipped rather than rendered. There
 * is no "raw html" block type — by construction, this renderer cannot
 * emit a `<script>`/`<iframe>`/`<embed>`/`<object>` tag or an inline
 * event handler no matter what `content_json` contains.
 *
 * This is the first place in the repo that defines a concrete shape for
 * `content_json` (previously "opaque to the API", doc issue #537/#538) —
 * `{ blocks: ContentBlock[] }` with six block types: paragraph, heading,
 * list, quote, gallery (Issue #542, public image/video display, deliberately
 * not a new media-library table since there is no base media library to
 * integrate with beyond a loose URL, see
 * `sql/029_awcms_blog_content_presentation_schema.sql`'s header
 * comment), and `video_news` (Issue #639 — a safe, provider-allowlisted
 * video embed; never a raw stored `<iframe>`, see
 * `_shared/rendering/video-news-block-renderer.ts`'s header). A derived app
 * or later issue needing richer blocks (embed, table, ...) extends the
 * `switch` below, not a general raw-HTML escape hatch.
 */
/** Re-exported from `_shared/rendering/gallery-block-renderer.ts` (Issue #681) — kept under this file's established name (`GalleryItem`) for every existing importer, even though the actual gallery-item rendering logic now lives in neutral shared ground rather than here (see that file's header for why). */
export type GalleryItem = GalleryBlockItem;

/** `mediaObjectId -> public URL` for gallery items using the Issue #636 R2-only-mode reference shape — built by the caller (`resolveVerifiedNewsMediaReferences`) BEFORE rendering, since resolving a registry id requires a database round trip this renderer deliberately never performs itself (kept pure, same as every other function in this file). Re-exported from `_shared/rendering/gallery-block-renderer.ts` (Issue #681). */
export type { ResolvedGalleryMediaUrls };

/** Re-exported from `_shared/rendering/video-news-block-renderer.ts` (Issue #639) — the actual video-embed rendering logic lives in neutral shared ground (same reasoning as `GalleryItem`/`ResolvedGalleryMediaUrls` above), reusable by a future `news_portal` homepage `video_block` section without a domain-to-domain import. */
export type VideoNewsItem = VideoNewsBlockItem;

export type ContentBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: "list"; ordered?: boolean; items: string[] }
  | { type: "quote"; text: string }
  | { type: "gallery"; items: GalleryItem[] }
  | ({ type: "video_news" } & VideoNewsItem);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function renderParagraph(text: unknown): string | null {
  if (typeof text !== "string" || text.trim().length === 0) {
    return null;
  }

  return `<p>${escapeHtml(text)}</p>`;
}

function renderHeading(level: unknown, text: unknown): string | null {
  if (
    typeof text !== "string" ||
    text.trim().length === 0 ||
    typeof level !== "number" ||
    !Number.isInteger(level) ||
    level < 1 ||
    level > 6
  ) {
    return null;
  }

  return `<h${level}>${escapeHtml(text)}</h${level}>`;
}

function renderList(ordered: unknown, items: unknown): string | null {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  const listItems = items
    .filter(
      (item): item is string =>
        typeof item === "string" && item.trim().length > 0
    )
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");

  if (listItems.length === 0) {
    return null;
  }

  const tag = ordered === true ? "ol" : "ul";
  return `<${tag}>${listItems}</${tag}>`;
}

function renderQuote(text: unknown): string | null {
  if (typeof text !== "string" || text.trim().length === 0) {
    return null;
  }

  return `<blockquote>${escapeHtml(text)}</blockquote>`;
}

function renderBlock(
  block: unknown,
  resolvedMediaUrls: ResolvedGalleryMediaUrls
): string | null {
  if (!isRecord(block)) {
    return null;
  }

  switch (block.type) {
    case "paragraph":
      return renderParagraph(block.text);
    case "heading":
      return renderHeading(block.level, block.text);
    case "list":
      return renderList(block.ordered, block.items);
    case "quote":
      return renderQuote(block.text);
    case "gallery":
      return renderGalleryBlockHtml(block.items, resolvedMediaUrls);
    case "video_news":
      return renderVideoNewsBlockHtml(block, resolvedMediaUrls);
    default:
      return null;
  }
}

const EMPTY_RESOLVED_MEDIA_URLS: ResolvedGalleryMediaUrls = new Map();

/**
 * Renders `contentJson.blocks` to a safe HTML string. Malformed/unknown
 * blocks are silently skipped, never thrown — a corrupt or unexpected
 * shape must degrade to "renders less", not a 500 with a stack trace (doc
 * issue #540: "Error output must not expose stack traces").
 *
 * `resolvedMediaUrls` (Issue #636) defaults to empty, which is the correct
 * behavior for every existing call site that hasn't been updated to
 * resolve `mediaObjectId`-based gallery items — those items simply render
 * nothing (never a broken `<img>` tag), while `url`-based items are
 * entirely unaffected either way.
 */
export function renderContentJsonToHtml(
  contentJson: Record<string, unknown>,
  resolvedMediaUrls: ResolvedGalleryMediaUrls = EMPTY_RESOLVED_MEDIA_URLS
): string {
  const blocks = contentJson.blocks;

  if (!Array.isArray(blocks)) {
    return "";
  }

  return blocks
    .map((block) => renderBlock(block, resolvedMediaUrls))
    .filter((html): html is string => html !== null)
    .join("\n");
}

/**
 * Extracts every well-formed `mediaObjectId` an image gallery item
 * references, so a caller can resolve them
 * (`resolveVerifiedNewsMediaReferences`) BEFORE calling
 * `renderContentJsonToHtml` — this renderer is synchronous/pure and cannot
 * itself perform the database round trip resolution requires. Thin
 * re-export of `content-block-media-references.ts`'s
 * `collectGalleryImageReferences` (its write-time violation list is
 * irrelevant here — already-written content is trusted to have passed
 * write-time validation — only the id list matters for render-time
 * resolution), kept as one traversal instead of two so the definition of
 * "which gallery items reference a media object" can never drift between
 * write-time validation and render-time resolution.
 */
export function collectRenderableGalleryMediaObjectIds(
  contentJson: Record<string, unknown>
): string[] {
  return collectGalleryImageReferences(contentJson).mediaObjectIds;
}

/**
 * Same reasoning as `collectRenderableGalleryMediaObjectIds` above, for
 * `video_news` blocks' `thumbnailMediaObjectId` (Issue #639). The returned
 * ids share the SAME news-media-registry id space as gallery/featured
 * image ids — a caller resolves both in one bulk lookup and passes the
 * combined map as `renderContentJsonToHtml`'s single `resolvedMediaUrls`
 * parameter (no separate parameter needed for video thumbnails).
 */
export function collectRenderableVideoNewsThumbnailMediaObjectIds(
  contentJson: Record<string, unknown>
): string[] {
  return collectVideoNewsThumbnailReferences(contentJson).mediaObjectIds;
}
