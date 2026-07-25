/**
 * Pure, accessible HTML rendering for the public `/search` page (ADR-0040 §5,
 * ported from awcms-micro Issue #270). Everything user-derived (query, titles,
 * urls) is escaped with `escapeHtml`; snippet HTML is ALREADY safe (built by
 * `renderSafeSnippet` — escaped content with only our own `<mark>`), so it is
 * embedded as-is.
 *
 * ## Two deliberate port-time adaptations (not oversights)
 *
 * 1. **No inline typeahead script.** awcms-micro's page shipped the suggestion
 *    combobox as an inline `<script>`. This base's CSP never carries
 *    `'unsafe-inline'` for scripts (`lib/security/security-headers.ts`), so an
 *    arbitrary inline script is blocked outright. The admin shell's theme-init
 *    script shows the one sanctioned way around that — naming a script's exact
 *    SHA-256 in `script-src` — but that is not available here: this route is a
 *    plain `.ts` APIRoute emitting an HTML string (the established convention for
 *    every public page, e.g. `/blog/{tenantCode}`), so there is neither an Astro
 *    component to bundle an external script from nor a build step to compute and
 *    keep that hash in sync. The page therefore renders the no-JS core search
 *    only: a native `<form>` + result links, fully keyboard accessible.
 *    `GET /api/v1/site-search/suggest` still ships and is what a theme's own
 *    bundled client (or a future `.astro` page) consumes — see README §Follow-up.
 * 2. **Labels are supplied by the caller** (`DEFAULT_SEARCH_PAGE_LABELS` here)
 *    rather than a gettext translator: this base has no i18n catalog runtime.
 *    Keeping them a parameter is what makes adding one later a caller change.
 */
import { escapeHtml } from "../../../lib/html/escape";
import type { SearchResultItem } from "../application/search-service";

export type SearchPageLabels = {
  title: string;
  heading: string;
  inputLabel: string;
  placeholder: string;
  button: string;
  enterTerm: string;
  tooShort: string;
  noResults: string;
  resultsHeading: string;
  next: string;
};

/** The single built-in label set (see the file header on why this is not a translator call). */
export const DEFAULT_SEARCH_PAGE_LABELS: SearchPageLabels = {
  title: "Search",
  heading: "Search",
  inputLabel: "Search this site",
  placeholder: "Type your search…",
  button: "Search",
  enterTerm: "Enter a search term to begin.",
  tooShort: "Your search term is too short.",
  noResults: "No results found.",
  resultsHeading: "Search results",
  next: "Next page"
};

export type SearchPageView = {
  locale: string;
  siteName: string;
  query: string;
  minQueryLength: number;
  reason?: "empty" | "too_short" | "too_long";
  items: readonly SearchResultItem[];
  nextCursor: string | null;
  labels: SearchPageLabels;
};

function renderResultItem(item: SearchResultItem): string {
  const badge = escapeHtml(item.resourceType.replace(/_/g, " "));
  return `<li class="site-search-result">
  <h3><a href="${escapeHtml(item.url)}">${escapeHtml(item.title)}</a></h3>
  <p class="site-search-snippet">${item.snippet}</p>
  <p class="site-search-type"><span>${badge}</span></p>
</li>`;
}

export function renderSearchPageBody(view: SearchPageView): string {
  const { labels } = view;
  const hasQuery = view.query.length > 0;

  let resultsHtml: string;
  if (view.reason === "too_short" || view.reason === "too_long") {
    resultsHtml = `<p class="site-search-hint">${escapeHtml(labels.tooShort)}</p>`;
  } else if (!hasQuery) {
    resultsHtml = `<p class="site-search-hint">${escapeHtml(labels.enterTerm)}</p>`;
  } else if (view.items.length === 0) {
    resultsHtml = `<p class="site-search-hint">${escapeHtml(labels.noResults)}</p>`;
  } else {
    resultsHtml = `<ol class="site-search-results" aria-label="${escapeHtml(labels.resultsHeading)}">
${view.items.map(renderResultItem).join("\n")}
</ol>`;
  }

  const nextLink =
    view.nextCursor && hasQuery
      ? `<nav class="site-search-pagination"><a rel="next" href="/search?q=${encodeURIComponent(
          view.query
        )}&amp;cursor=${encodeURIComponent(view.nextCursor)}">${escapeHtml(
          labels.next
        )}</a></nav>`
      : "";

  return `<main class="site-search-page">
  <h1>${escapeHtml(labels.heading)}</h1>
  <form class="site-search-form" role="search" method="get" action="/search">
    <label for="site-search-input">${escapeHtml(labels.inputLabel)}</label>
    <input
      id="site-search-input"
      type="search"
      name="q"
      value="${escapeHtml(view.query)}"
      placeholder="${escapeHtml(labels.placeholder)}"
      autocomplete="off"
      aria-label="${escapeHtml(labels.inputLabel)}"
      minlength="${view.minQueryLength}"
    />
    <button type="submit">${escapeHtml(labels.button)}</button>
  </form>
  <section class="site-search-results-region" aria-live="polite">
    ${resultsHtml}
    ${nextLink}
  </section>
</main>`;
}

/** The full standalone document for the public search page — `noindex` because a search-results page must never be indexed. */
export function renderSearchPageDocument(view: SearchPageView): string {
  return `<!doctype html>
<html lang="${escapeHtml(view.locale)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, follow" />
  <title>${escapeHtml(`${view.labels.title} — ${view.siteName}`)}</title>
</head>
<body>${renderSearchPageBody(view)}</body>
</html>`;
}
