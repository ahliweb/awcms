import { serializeJsonForScriptElement } from "../../../lib/html/escape";

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
  /** Already-resolved verified R2 image (`social-preview-image-resolution.ts` + `MediaLibraryPort`), or `null` to omit `image` entirely — never an unverified/local/external URL. */
  image: NewsArticleImage | null;
  datePublished: Date;
  dateModified: Date;
  /**
   * The ORGANISATION-level byline (tenant/site name) — the fallback, and still
   * the answer for every article whose author has not opted into one.
   *
   * Issue #649's reasoning stands and is why `authorByline` below is a separate
   * field rather than this one being repointed: publishing an internal editor's
   * account name would be a new PII surface, so no existing article's
   * attribution changes.
   */
  authorName: string;
  /**
   * ADR-0109 — the author's OPT-IN public byline, or `null`.
   *
   * When it is set, the `author` node becomes a `Person` with that name and
   * NOTHING else: no `url`, no `sameAs`, no identifier of any kind. A byline is
   * a name somebody chose to publish under; a linked profile is a directory of
   * the newsroom's staff, which nobody asked for and which the person cannot
   * withdraw article by article.
   *
   * `null` — the state of every article until a writer fills the field in —
   * keeps the `Organization` node exactly as it was.
   */
  authorByline?: string | null;
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
    author: input.authorByline
      ? { "@type": "Person", name: input.authorByline }
      : { "@type": "Organization", name: input.authorName },
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
 *
 * The escaping itself now lives in `lib/html/escape.ts` as
 * `serializeJsonForScriptElement`, because Issue #592 gave it a SECOND caller:
 * the editor preview embeds the canonical body as an `application/json` data
 * block for its editing overlay. Two hand-copies of one escaping rule is how
 * the second one ends up subtly weaker. This stays the only place a JSON-LD
 * object becomes a tag.
 */
export function renderJsonLdScriptTag(data: Record<string, unknown>): string {
  return `<script type="application/ld+json">${serializeJsonForScriptElement(data)}</script>`;
}
