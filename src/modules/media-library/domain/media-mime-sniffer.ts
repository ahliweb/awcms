/**
 * MIME sniffing from magic bytes (Issue #634, epic `news_portal`; SVG
 * recognition added by Issue #806). Pure — no network/DB access, takes only
 * the bytes already read from R2 by the caller
 * (`application/media-r2-verification.ts`).
 *
 * ## Why allow-list sniffing, not a generic magic-byte detector
 *
 * `full-online-r2-architecture.md` §9 and the security-auditor finding on
 * Issue #631 (the finding this whole issue exists to close) require the
 * `confirm`/finalize step to run MIME sniffing against the object's actual
 * bytes rather than trust `Content-Type`, the file extension, or the
 * client's claimed `mimeType` — none of those are proof of what the bytes
 * actually are. This module only tries to POSITIVELY recognize the five mime
 * types `news-media-r2-config.ts`'s `NEWS_MEDIA_R2_KNOWN_MIME_TYPES` names
 * (JPEG/PNG/WebP/GIF, allowed by default, plus SVG — allowed only when an
 * operator opts in via `NEWS_MEDIA_R2_ALLOWED_MIME_TYPES`, see that file's
 * header). Anything else — including a `.jpg`-named/labeled file that is
 * actually HTML/JS (the exact exploit scenario the security audit called
 * out) — returns `undefined` ("not a recognized image"), which
 * `media-finalize-decision.ts` always treats as a hard reject. This is
 * deliberately allow-list-only (not a blocklist trying to enumerate every
 * dangerous format) — a payload sniffing to `undefined` is rejected
 * regardless of what it actually is.
 *
 * ## Why SVG needs a text match, not a fixed magic-byte prefix
 *
 * SVG is XML text, not a binary format with a fixed byte signature: a real
 * SVG file may start with a UTF-8 BOM, an `<?xml ... ?>` prolog, a
 * `<!DOCTYPE ...>`, and/or comments, all optional and in either order,
 * before the `<svg` root element actually appears. `looksLikeSvg` decodes a
 * bounded prefix of the bytes (never the whole object — an attacker-sized
 * payload should not make sniffing itself expensive) and matches that shape.
 * Recognizing the SHAPE is all this function does — whether the SVG's
 * CONTENT is safe to serve (no `<script>`, no `on*=` handler, no
 * `javascript:` URI, no external entity) is a separate, deliberately later
 * question answered by `media-svg-safety.ts`'s `findSvgSafetyViolations`,
 * which `media-r2-verification.ts` runs only once sniffing has already
 * confirmed the bytes are shaped like SVG.
 */

export type SniffedNewsMediaMimeType =
  "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "image/svg+xml";

const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const GIF_MAGIC_PREFIX = [0x47, 0x49, 0x46, 0x38]; // "GIF8"
const GIF_VERSION_A = 0x61; // "a" — closes "87a"/"89a"
const RIFF_MAGIC = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WEBP_MAGIC = [0x57, 0x45, 0x42, 0x50]; // "WEBP", at byte offset 8

function matchesAt(
  bytes: Uint8Array,
  offset: number,
  signature: number[]
): boolean {
  if (bytes.length < offset + signature.length) return false;

  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[offset + i] !== signature[i]) return false;
  }

  return true;
}

/**
 * Bounded prefix decoded for the SVG shape match — a real logo/emblem SVG's
 * root element appears within the first few hundred bytes; capping this
 * keeps sniffing itself O(1) regardless of how large the uploaded object
 * claims to be.
 */
const SVG_SNIFF_PREFIX_BYTES = 4096;

/**
 * Optional UTF-8 BOM, optional `<?xml ... ?>` prolog, any number of optional
 * comments/`<!DOCTYPE ...>` declarations in either order, then the `<svg`
 * root element. Deliberately permissive about what comes before `<svg` (this
 * is a SHAPE match, not a full XML parse) and deliberately anchored at the
 * start of the (BOM-stripped) text — an SVG fragment embedded partway
 * through some other document is not what this recognizes.
 */
const SVG_ROOT_PATTERN =
  /^\s*(?:<\?xml\b[^>]*\?>\s*)?(?:(?:<!--[\s\S]*?-->|<!DOCTYPE\b[^>[]*(?:\[[\s\S]*?\])?\s*>)\s*)*<svg[\s>]/i;

function looksLikeSvg(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;

  const prefix = bytes.subarray(
    0,
    Math.min(bytes.length, SVG_SNIFF_PREFIX_BYTES)
  );
  const text = new TextDecoder("utf-8", { fatal: false })
    .decode(prefix)
    .replace(/^﻿/, "");

  return SVG_ROOT_PATTERN.test(text);
}

/**
 * Returns the recognized mime type for `bytes`, or `undefined` when the
 * content does not match any allow-listed image signature. Never throws.
 */
export function sniffNewsMediaMimeType(
  bytes: Uint8Array
): SniffedNewsMediaMimeType | undefined {
  if (matchesAt(bytes, 0, JPEG_MAGIC)) {
    return "image/jpeg";
  }

  if (matchesAt(bytes, 0, PNG_MAGIC)) {
    return "image/png";
  }

  if (
    matchesAt(bytes, 0, GIF_MAGIC_PREFIX) &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === GIF_VERSION_A
  ) {
    return "image/gif";
  }

  if (matchesAt(bytes, 0, RIFF_MAGIC) && matchesAt(bytes, 8, WEBP_MAGIC)) {
    return "image/webp";
  }

  if (looksLikeSvg(bytes)) {
    return "image/svg+xml";
  }

  return undefined;
}
