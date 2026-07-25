/**
 * Comment sanitization + safe rendering (ADR-0041 — SECURITY SPINE, ported from
 * awcms-micro Issue #271). Pure domain — no I/O. The discipline mirrors
 * `theming`'s "reject, don't sanitize" posture and `site_search`'s "escape before
 * any HTML is emitted":
 *
 * 1. STORE raw plain text only — never stored HTML. `normalizeCommentBody`
 *    strips control characters, normalizes newlines, collapses excessive blank
 *    lines, trims, and enforces the length + max-links bounds. It does NOT reject
 *    a body merely for containing a dangerous scheme token in prose (a user may
 *    legitimately type the word "javascript") — dangerous schemes are neutralized
 *    at RENDER time by never emitting them as a live link.
 * 2. RENDER by escaping EVERY character of HTML, then autolinking only bare
 *    http(s) URLs, emitted with escaped visible text and
 *    `rel="nofollow ugc noopener noreferrer"` + `target="_blank"`. No other HTML
 *    is ever produced. `javascript:`/`data:`/`vbscript:`/`file:` and control
 *    characters can never become a live link.
 *
 * Storing plain text and escaping on render removes the entire stored-XSS class:
 * there is no sanitizer allow-list to be wrong about, and no path by which a
 * stored comment reaches a browser as raw markup.
 */

// Strip C0/C1 control characters except tab (U+0009) and newline (U+000A); \r is
// normalized to \n separately below. Written with Unicode escapes so no raw
// control byte can ever land in this source file.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const EXCESS_BLANK_LINES = /\n{3,}/g;

export type CommentBodyRejectionReason =
  "empty" | "too_long" | "too_many_links";

export type NormalizeCommentResult =
  | { ok: true; value: string; linkCount: number }
  | { ok: false; reason: CommentBodyRejectionReason };

/** Matches a bare http(s) URL for autolinking + link counting. */
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"']+/gi;

export function countLinks(text: string): number {
  const matches = text.match(URL_PATTERN);
  return matches ? matches.length : 0;
}

export function normalizeCommentBody(
  raw: unknown,
  opts: { maxLength: number; maxLinks: number }
): NormalizeCommentResult {
  if (typeof raw !== "string") return { ok: false, reason: "empty" };

  const cleaned = raw
    .replace(CONTROL_CHARS, "")
    .replace(/\r\n?/g, "\n")
    .replace(EXCESS_BLANK_LINES, "\n\n")
    .trim();

  if (cleaned.length === 0) return { ok: false, reason: "empty" };
  if (cleaned.length > opts.maxLength) return { ok: false, reason: "too_long" };

  const linkCount = countLinks(cleaned);
  if (linkCount > opts.maxLinks) {
    return { ok: false, reason: "too_many_links" };
  }

  return { ok: true, value: cleaned, linkCount };
}

/** Escapes the five HTML-significant characters. The ONLY escaping primitive here. */
export function escapeCommentHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * A URL is safe to emit as a live link ONLY if it parses as an absolute http(s)
 * URL. Any other scheme (`javascript:`, `data:`, `vbscript:`, `file:`,
 * `mailto:`, or a relative reference) is never linkified — it is rendered as
 * escaped plain text instead.
 */
export function isSafeLinkUrl(candidate: string): boolean {
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Renders a normalized comment body to SAFE HTML: every character HTML-escaped,
 * bare http(s) URLs turned into `<a rel="nofollow ugc noopener noreferrer"
 * target="_blank">` links (with the URL escaped in BOTH href and visible text),
 * and newlines turned into `<br>`. Nothing else. The result is safe to inject as
 * innerHTML because the only tags it can contain are the fixed `<a>` / `<br>`
 * this function itself emits.
 */
export function renderCommentHtml(normalizedBody: string): string {
  const lines = normalizedBody.split("\n");
  const renderedLines = lines.map((line) => {
    let out = "";
    let lastIndex = 0;
    URL_PATTERN.lastIndex = 0;
    for (const match of line.matchAll(URL_PATTERN)) {
      const url = match[0];
      const start = match.index ?? 0;
      out += escapeCommentHtml(line.slice(lastIndex, start));
      if (isSafeLinkUrl(url)) {
        const safeUrl = escapeCommentHtml(url);
        out += `<a href="${safeUrl}" rel="nofollow ugc noopener noreferrer" target="_blank">${safeUrl}</a>`;
      } else {
        out += escapeCommentHtml(url);
      }
      lastIndex = start + url.length;
    }
    out += escapeCommentHtml(line.slice(lastIndex));
    return out;
  });
  return renderedLines.join("<br>");
}
