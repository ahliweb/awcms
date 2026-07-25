/**
 * Snippet / highlight escaping for `site_search` (ADR-0040 §5 — the XSS defense,
 * ported from awcms-micro Issue #270). A snippet can NEVER return raw unsafe
 * markup.
 *
 * ## The escape-then-mark pattern
 *
 * PostgreSQL's `ts_headline` wraps matched terms in configurable delimiters. We
 * pass NON-HTML ASCII sentinel tokens (`StartSel`/`StopSel`) rather than
 * `<b>`/`<mark>` directly, then in application code:
 *
 *   1. escape the WHOLE `ts_headline` output as HTML (so any `<`/`>`/`&`/quote in
 *      the underlying content — or in a crafted document — becomes an entity and
 *      can never open a tag), THEN
 *   2. replace the (now-untouched, plain-ASCII) sentinels with `<mark>`/`</mark>`.
 *
 * Because escaping happens FIRST, the only HTML that can appear in the result is
 * the `<mark>`/`</mark>` we introduce ourselves — content is inert. Even if a
 * document literally contained a sentinel token, the worst case is a spurious
 * (harmless) highlight, never markup injection.
 */

/**
 * Plain-ASCII sentinels passed to `ts_headline` as `StartSel`/`StopSel`. Chosen
 * to be valid inside a `ts_headline` options string (no commas/quotes/spaces)
 * and vanishingly unlikely to occur in real content.
 */
export const SNIPPET_START_SENTINEL = "zzawssmarkstartzz";
export const SNIPPET_STOP_SENTINEL = "zzawssmarkstopzz";

/** The `ts_headline` options string that emits our sentinels. Bounded word counts keep snippets short and cheap. */
export const SNIPPET_HEADLINE_OPTIONS =
  `StartSel=${SNIPPET_START_SENTINEL}, StopSel=${SNIPPET_STOP_SENTINEL}, ` +
  "MaxWords=30, MinWords=12, ShortWord=3, MaxFragments=2, FragmentDelimiter= … ";

/** Escape the five HTML-significant characters so no content byte can start a tag or attribute. */
export function escapeSnippetHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Turn a raw `ts_headline` result (containing sentinel tokens) into safe HTML:
 * escape the whole string, THEN swap the sentinels for `<mark>`/`</mark>`. The
 * output is guaranteed to contain no content-originated markup.
 */
export function renderSafeSnippet(rawHeadline: string): string {
  const escaped = escapeSnippetHtml(rawHeadline);
  return escaped
    .split(SNIPPET_START_SENTINEL)
    .join("<mark>")
    .split(SNIPPET_STOP_SENTINEL)
    .join("</mark>");
}
