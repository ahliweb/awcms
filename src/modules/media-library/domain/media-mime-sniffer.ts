/**
 * MIME sniffing from magic bytes (Issue #634, epic `news_portal`). Pure — no
 * network/DB access, takes only the bytes already read from R2 by the
 * caller (`application/news-media-r2-verification.ts`).
 *
 * ## Why allow-list sniffing, not a generic magic-byte detector
 *
 * `full-online-r2-architecture.md` §9 and the security-auditor finding on
 * Issue #631 (the finding this whole issue exists to close) require the
 * `confirm`/finalize step to run MIME sniffing against the object's actual
 * bytes rather than trust `Content-Type`, the file extension, or the
 * client's claimed `mimeType` — none of those are proof of what the bytes
 * actually are. This module only tries to POSITIVELY recognize the four
 * mime types `news-media-r2-config.ts` allows by default (JPEG/PNG/WebP/
 * GIF). Anything else — including a `.jpg`-named/labeled file that is
 * actually HTML/JS (the exact exploit scenario the security audit called
 * out) — returns `undefined` ("not a recognized image"), which
 * `news-media-finalize-decision.ts` always treats as a hard reject. This is
 * deliberately allow-list-only (not a blocklist trying to enumerate every
 * dangerous format) — a payload sniffing to `undefined` is rejected
 * regardless of what it actually is.
 */

export type SniffedNewsMediaMimeType =
  "image/jpeg" | "image/png" | "image/webp" | "image/gif";

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

  return undefined;
}
