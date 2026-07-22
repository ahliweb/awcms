import { escapeHtml } from "../../../lib/html/escape";

/**
 * Shared, pure `video_news` embed renderer (Issue #639, epic `news_portal`)
 * — lives in `_shared` alongside `gallery-block-renderer.ts` (Issue #681)
 * so both `blog_content`'s own renderer and any future `news_portal`
 * consumer (e.g. a homepage `video_block` section — `homepage-section-
 * policy.ts` explicitly deferred that sectionType pending this issue, but
 * wiring it up is its own separate future issue, not this one) can reuse
 * this without a domain-to-domain import.
 *
 * "Public renderer must build safe embed URL from provider + video ID
 * only" (issue's own Rules) is implemented literally: this file NEVER
 * reads or emits any HTML the client submitted — it only reads
 * `provider`/`videoId` (already validated/normalized at write time by
 * `blog-content/domain/video-news-block-validation.ts`) and constructs ITS
 * OWN fixed `<iframe>` markup pointing at YouTube's privacy-enhanced
 * `youtube-nocookie.com` embed domain (also allow-listed in
 * `astro.config.mjs`'s CSP `frame-src`, or the iframe would be blocked by
 * the browser regardless of this markup being "safe"). There is no code
 * path here that can ever render a stored raw `<iframe>`/`<script>` tag —
 * same "whitelist only, no raw-html escape hatch" convention every other
 * renderer in this repo follows (see `content-block-rendering.ts`'s own
 * header comment).
 *
 * Deliberately re-derives its own `YOUTUBE_VIDEO_ID_PATTERN` rather than
 * importing it from `video-news-block-validation.ts` — this keeps
 * `_shared` (which must never import FROM either `blog_content`'s or
 * `news_portal`'s `application`/`domain` trees, only the other way around,
 * see `gallery-block-renderer.ts`'s header) fully independent, and the
 * pattern is a load-bearing constant of the YouTube id format itself, not
 * an implementation detail that could drift between the two files.
 *
 * KNOWN LIMITATION (port-time, awcms base only — not a mini behavior):
 * awcms-mini allow-listed `https://www.youtube-nocookie.com` in its CSP
 * `frame-src` unconditionally (Astro's own `security.csp`, set in
 * `astro.config.mjs`). This base's CSP (`src/lib/security/security-
 * headers.ts`, Issue #148/#186) instead guarantees NO third-party origin
 * is ever allow-listed on a LAN/offline deployment unless an operator
 * explicitly opts in (Cloudflare Turnstile is the one existing precedent,
 * gated behind `TURNSTILE_ENABLED`/deployment profile) — a guarantee
 * `tests/security-headers-csp.test.ts` directly asserts. Adding
 * `youtube-nocookie.com` unconditionally would break that guarantee for
 * every deployment, whether or not it ever uses a `video_news` block; this
 * port deliberately does NOT do that. Net effect: this renderer still
 * builds the exact same safe `<iframe>` markup below, but until a
 * deployment's own CSP is extended to allow `frame-src
 * https://www.youtube-nocookie.com` (e.g. a future opt-in flag mirroring
 * Turnstile's pattern, or a manual reverse-proxy/CSP override), a
 * `video_news` block's embed renders in the HTML but is blocked by the
 * browser — a silent, safe degradation (no video shown, no console
 * error users would see, no XSS), not a server error. Every other block
 * type (`gallery`, `paragraph`, `heading`, `list`, `quote`) is entirely
 * unaffected. See `blog-content/module.ts`'s description field and this
 * port's PR body for the same note.
 */

export type VideoNewsBlockItem = {
  provider: string;
  videoId: string;
  title?: string;
  caption?: string;
  thumbnailMediaObjectId?: string;
  durationSeconds?: number;
  sourceLabel?: string;
};

/** `mediaObjectId -> public URL` — the SAME map `content-block-rendering.ts` already threads through as `resolvedMediaUrls` for gallery items (Issue #636); a video thumbnail's `mediaObjectId` lives in the same news-media-registry id space, so no second resolution pass/parameter is needed. */
export type ResolvedVideoNewsThumbnailUrls = ReadonlyMap<string, string>;

const YOUTUBE_EMBED_BASE = "https://www.youtube-nocookie.com/embed/";
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

function buildEmbedUrl(provider: string, videoId: string): string | null {
  if (provider !== "youtube" || !YOUTUBE_VIDEO_ID_PATTERN.test(videoId)) {
    return null;
  }

  return `${YOUTUBE_EMBED_BASE}${videoId}`;
}

/**
 * Renders one `video_news` block to a safe `<figure>` containing (when a
 * verified thumbnail resolves) a custom thumbnail `<img>`, the provider
 * iframe embed, an optional source-label line, and an optional caption.
 * Returns `null` (silently skipped by the caller, never thrown) when
 * `provider`/`videoId` are missing/malformed or the embed URL cannot be
 * built — malformed content degrades to "renders nothing", same convention
 * every other block renderer in this repo follows.
 */
export function renderVideoNewsBlockHtml(
  block: unknown,
  resolvedThumbnailUrls: ResolvedVideoNewsThumbnailUrls
): string | null {
  if (typeof block !== "object" || block === null || Array.isArray(block)) {
    return null;
  }

  const record = block as Record<string, unknown>;

  if (
    typeof record.provider !== "string" ||
    typeof record.videoId !== "string"
  ) {
    return null;
  }

  const embedUrl = buildEmbedUrl(record.provider, record.videoId);
  if (embedUrl === null) {
    return null;
  }

  const title =
    typeof record.title === "string" && record.title.trim().length > 0
      ? record.title.trim()
      : typeof record.sourceLabel === "string" &&
          record.sourceLabel.trim().length > 0
        ? record.sourceLabel.trim()
        : "Video";

  const iframe = `<iframe src="${escapeHtml(embedUrl)}" title="${escapeHtml(title)}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`;

  const thumbnailUrl =
    typeof record.thumbnailMediaObjectId === "string"
      ? (resolvedThumbnailUrls.get(record.thumbnailMediaObjectId) ?? null)
      : null;

  const thumbnail =
    thumbnailUrl !== null
      ? `<img class="video-news-thumbnail" src="${escapeHtml(thumbnailUrl)}" alt="${escapeHtml(title)}" loading="lazy">`
      : "";

  const caption =
    typeof record.caption === "string" && record.caption.trim().length > 0
      ? `<figcaption>${escapeHtml(record.caption.trim())}</figcaption>`
      : "";

  const sourceLabel =
    typeof record.sourceLabel === "string" &&
    record.sourceLabel.trim().length > 0
      ? `<p class="video-news-source">${escapeHtml(record.sourceLabel.trim())}</p>`
      : "";

  return `<figure class="video-news">${thumbnail}${iframe}${sourceLabel}${caption}</figure>`;
}
