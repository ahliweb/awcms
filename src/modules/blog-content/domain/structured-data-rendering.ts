/**
 * `NewsArticle` (schema.org) JSON-LD structured data for public post detail
 * pages (Issue #649, epic `news_portal`). Pure — takes already-resolved
 * values (title/description/canonical URL/image URL+dimensions/author &
 * publisher names/publisher logo URL/dates/taxonomy) and builds a plain
 * object; `renderJsonLdScriptTag` below is the ONLY place that serializes it
 * to a `<script>` tag, so there is exactly one point that has to get the
 * HTML-injection escaping right.
 *
 * Every string value here is user-authored content (title, description, alt
 * text, category/tag names) — "escape everything" (issue's own security
 * note) is satisfied by `renderJsonLdScriptTag`'s serialization, NOT by
 * pre-escaping fields here (`JSON.stringify` already produces valid JSON
 * string literals for arbitrary text; the only extra risk specific to
 * embedding JSON inside an HTML `<script>` element is the literal `</script>`
 * sequence breaking out of the element, which `renderJsonLdScriptTag`
 * neutralizes structurally, not through a denylist).
 */
export type NewsArticleImage = {
  url: string;
  width: number | null;
  height: number | null;
};

export type NewsArticleJsonLdInput = {
  headline: string;
  description: string;
  /** Already-resolved, safe absolute canonical URL (`seo-rendering.ts`'s `resolveCanonicalUrl`) — the caller only calls this builder when non-null. */
  canonicalUrl: string;
  /** Already-resolved verified R2 image (`social-preview-image-resolution.ts` + `NewsMediaPort`), or `null` to omit `image` entirely — never an unverified/local/external URL. */
  image: NewsArticleImage | null;
  datePublished: Date;
  dateModified: Date;
  /** Issue #649 design decision: organization-level byline (tenant/site name), NOT an individual editor's identity — this repo has no public-safe "author display name" concept today, and exposing internal user identity in public structured data would be a new PII surface out of this issue's scope. See the news-portal skill's §649 section for the full reasoning. */
  authorName: string;
  publisherName: string;
  /** Best-effort — omitted when the tenant has no verified R2 fallback social image configured (Google's NewsArticle guidance recommends a publisher logo, but does not make it a hard requirement this repo can satisfy without a dedicated tenant-logo concept, which does not exist yet). */
  publisherLogoUrl: string | null;
  /** First category-taxonomy term name, if any (`article:section`, JSON-LD `articleSection`). */
  articleSection: string | null;
  /** Every other assigned category/tag term name (`article:tag`, JSON-LD `keywords`). */
  tags: readonly string[];
};

export function buildNewsArticleJsonLd(
  input: NewsArticleJsonLdInput
): Record<string, unknown> {
  const publisher: Record<string, unknown> = {
    "@type": "Organization",
    name: input.publisherName
  };

  if (input.publisherLogoUrl) {
    publisher.logo = {
      "@type": "ImageObject",
      url: input.publisherLogoUrl
    };
  }

  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: input.headline,
    description: input.description,
    datePublished: input.datePublished.toISOString(),
    dateModified: input.dateModified.toISOString(),
    author: {
      "@type": "Organization",
      name: input.authorName
    },
    publisher,
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": input.canonicalUrl
    }
  };

  if (input.image) {
    data.image = {
      "@type": "ImageObject",
      url: input.image.url,
      ...(input.image.width ? { width: input.image.width } : {}),
      ...(input.image.height ? { height: input.image.height } : {})
    };
  }

  if (input.articleSection) {
    data.articleSection = input.articleSection;
  }

  if (input.tags.length > 0) {
    data.keywords = input.tags.join(", ");
  }

  return data;
}

/**
 * Serializes a JSON-LD object into a safe `<script type="application/ld+json">`
 * tag. `JSON.stringify` already produces a valid JSON string (quotes/
 * backslashes/control characters correctly escaped per the JSON spec) — the
 * ONE additional risk specific to embedding JSON inside an HTML `<script>`
 * element is a literal `</script` sequence inside a string value breaking
 * out of the element early (this is not a JSON-escaping gap, it is an
 * HTML-parser one: the browser's HTML tokenizer looks for `</script` before
 * JavaScript/JSON parsing ever begins). Escaping EVERY `<` character (not
 * just the exact `</script>` substring) closes this structurally — same
 * "escape the whole class, not a denylist of exact strings" principle this
 * repo's `escapeHtml` already uses for regular HTML text.
 */
export function renderJsonLdScriptTag(data: Record<string, unknown>): string {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${json}</script>`;
}
