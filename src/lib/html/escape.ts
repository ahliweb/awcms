/**
 * Shared HTML/XML text escaping (Issue #540 — "Content rendering must be
 * sanitized", "Error output must not expose stack traces"). The same five
 * entities cover both HTML text/attribute content and XML content
 * (RSS/sitemap), so one function serves both — no separate XML escaper.
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * C0 control characters that XML 1.0 forbids ANYWHERE in a document — even as a
 * numeric character reference (`&#x1;` is itself not well-formed). The only C0
 * chars XML 1.0 permits are TAB (U+0009), LF (U+000A), and CR (U+000D); every
 * other char in U+0000–U+001F is illegal (XML 1.0 §2.2 `Char`). `escapeHtml` only
 * neutralizes the five markup entities and passes these through unchanged, so a
 * stray control char in tenant text (e.g. a post title) would make the whole
 * feed/sitemap non-well-formed. There is no write-side stripping in the content
 * modules, so the XML serializers must strip at their own boundary (ADR-0038 —
 * seo_distribution discovery serializers).
 */
const XML_ILLEGAL_C0 = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

/**
 * XML text/attribute escaping for the syndication serializers (feeds + sitemap):
 * strip the XML-1.0-illegal C0 control chars FIRST (they cannot be represented at
 * all), THEN apply the shared `escapeHtml` entity escaping. Kept separate from
 * `escapeHtml` so HTML rendering — where those control chars are only discouraged,
 * not fatal — is unaffected.
 */
export function escapeXmlText(value: string): string {
  return escapeHtml(value.replace(XML_ILLEGAL_C0, ""));
}
