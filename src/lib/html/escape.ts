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
