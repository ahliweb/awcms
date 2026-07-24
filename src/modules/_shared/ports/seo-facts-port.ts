/**
 * `SeoFactsSource` (ADR-0038 — `seo_distribution` admission, adapted from
 * awcms-micro ADR-0028) — the capability a content module (`blog_content`,
 * `news_portal`, a future content type, ...) PROVIDES and `seo_distribution`
 * CONSUMES: read-only, server-derived "SEO facts" for one public resource, so the
 * sitemap/feed/robots generator can compose canonical URLs, metadata, structured
 * data, and sitemap/feed entries WITHOUT importing any content module's internals
 * or writing to any shared table.
 *
 * ## Scope note (ADR-0038 §A — discovery-only)
 *
 * The awcms port lands the DISCOVERY half of ADR-0028's contract: the pure facts
 * types, the JSON-LD safety guards, the cache-key builder, and the publication-
 * state predicates. The REDIRECT-governance half of awcms-micro's port
 * (`classifyRedirectTarget`/`assertSafeRedirectTarget`/`RedirectTargetClass`) is
 * DEFERRED to a follow-up PR together with the redirect tables + middleware hook —
 * it is not needed by the sitemap/feed/robots/metadata surfaces this PR ships, and
 * carrying it would drag in a redirect concept with no consumer. It re-enters as a
 * backward-compatible addition (standalone helper functions, not part of the
 * `SeoFactsSource` interface) in that follow-up.
 *
 * This file imports NOTHING from any module (same rule as every other port here),
 * so a content module depends on the TYPE without depending on an implementation,
 * and vice versa. `CAPABILITY_CONTRACT_VERSIONS["seo_facts"] = "1.1.0"` pairs with
 * `blog_content`'s `provides: ["... , "seo_facts"]` string (ADR-0015 rule).
 *
 * ## Direction of the arrow (ADR-0038 §2)
 *
 * Content modules are PROVIDERS; `seo_distribution` is the CONSUMER/aggregator.
 * The arrow points inward on purpose: if `seo_distribution` consumed each content
 * module's own port instead, the aggregator would drag a dependency to every
 * content module and know which ones exist. Inverting it — content modules
 * contribute `seo_facts`, SEO discovers them at the composition root — keeps
 * `seo_distribution` ignorant of any specific content module and content modules
 * ignorant of SEO internals. This is a `capabilities.consumes` relationship
 * (source-level, optional, degrades safely), NEVER a lifecycle `dependencies`
 * edge, so it does not constrain the DAG.
 *
 * ## What every value here guarantees (server-derived, not tenant-authored)
 *
 * All facts are DERIVED by the provider from already-validated tenant data, never
 * raw strings a tenant pasted. Two structural choices enforce the ADR-0038 threat
 * model at the type level rather than by convention:
 *
 * - **Paths, not hosts.** `canonicalPath` and `SeoLocaleAlternate.path` are PATHS
 *   relative to the tenant's primary domain. The host is derived by
 *   `seo_distribution` from `tenant_domain`, so a provider cannot inject a host —
 *   the host-header-poisoning defense is that providers never name a host at all.
 * - **Media ids, not image URLs.** `openGraph.imageMediaId` is a media object id
 *   resolved later through `MediaLibraryPort` (same-tenant, verified), never a raw
 *   URL a tenant could point cross-tenant/off-origin.
 */

/**
 * Publication state of a resource — the provider's authoritative answer,
 * re-evaluated at resolve time (never cached from a curation list). `noindex`
 * is orthogonal (a `published` page can still be `noindex`) and lives on
 * `SeoVisibility` separately.
 */
export type SeoPublicationState =
  | "published"
  | "draft"
  | "scheduled"
  | "archived"
  | "deleted"
  | "private"
  | "unpublished";

export type SeoVisibility = {
  state: SeoPublicationState;
  /** `true` → the page may still render, but with `robots: noindex` and never in a sitemap/feed. */
  noindex: boolean;
  /** ISO-8601. When `state === "scheduled"`, the resource is not public until this instant. `null` otherwise. */
  scheduledPublishAt: string | null;
};

export type SeoRobotsDirective =
  "index,follow" | "index,nofollow" | "noindex,follow" | "noindex,nofollow";

export type SeoMetadata = {
  title: string;
  description: string | null;
  robots: SeoRobotsDirective;
};

export type SeoLocaleAlternate = {
  /** BCP-47 locale tag, or `"x-default"`. */
  locale: string;
  /** Path relative to the tenant's primary domain — host is derived by `seo_distribution`, never carried here. */
  path: string;
};

export type SeoOpenGraph = {
  title: string;
  description: string | null;
  /** Media object id resolved through `MediaLibraryPort` (same-tenant, verified) — never a raw URL. `null` when the resource has no social image. */
  imageMediaId: string | null;
  /** Open Graph object type, e.g. `"article"` / `"website"`. */
  type: string;
};

/** Present (non-`null`) only for resources that belong in a sitemap — i.e. publicly indexable ones. */
export type SeoSitemapEntry = {
  /** ISO-8601 `<lastmod>`; `null` when unknown. */
  lastmod: string | null;
  changefreq?:
    "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  /** 0.0–1.0. */
  priority?: number;
};

/** Present (non-`null`) only for resources that are feed items. */
export type SeoFeedEntry = {
  publishedAt: string;
  updatedAt: string | null;
};

/** The controlled schema.org `@type` set — JSON-LD injection is blocked by this union, not by ad-hoc sanitization. */
export type JsonLdType =
  | "Article"
  | "NewsArticle"
  | "BlogPosting"
  | "WebPage"
  | "WebSite"
  | "BreadcrumbList"
  | "Organization"
  | "ImageObject"
  | "Person";

export type JsonLdScalar = string | number | boolean;

export type JsonLdValue = JsonLdScalar | JsonLdNode | readonly JsonLdValue[];

export type JsonLdNode = {
  readonly "@type": JsonLdType;
  readonly [key: string]: JsonLdValue;
};

/**
 * Everything `seo_distribution` needs about ONE public resource of ONE tenant,
 * derived by the owning content module. The base article/page and any future
 * content type flow through this identical shape — `resourceType` is an opaque
 * string (same generic pattern as `media_library`'s `owner_resource_type`), so
 * `seo_distribution` never knows any specific content type.
 */
export type SeoResourceFacts = {
  /** Opaque content-type discriminator, e.g. `"blog_post"`, `"blog_page"`, a future `"product"`. Never interpreted by `seo_distribution`. */
  resourceType: string;
  resourceId: string;
  visibility: SeoVisibility;
  /** Canonical path relative to the tenant's primary domain (leading `/`). */
  canonicalPath: string;
  localeAlternates: readonly SeoLocaleAlternate[];
  metadata: SeoMetadata;
  openGraph: SeoOpenGraph;
  jsonLd: readonly JsonLdNode[];
  /** `null` when this resource must NOT appear in a sitemap (draft/private/deleted/scheduled/noindex/...). */
  sitemap: SeoSitemapEntry | null;
  /** `null` when this resource is not a feed item. */
  feed: SeoFeedEntry | null;
};

/**
 * Ordering for `listPublicResourceFacts` (`seo_facts` 1.1.0). `"id_asc"` — the
 * historical default — is the STABLE keyset order used for deterministic sitemap
 * pagination (`cursor`/`offset` walk it identically every request).
 * `"published_desc"` is newest-first, used to build feeds (RSS/Atom/JSON) bounded
 * to the latest N items; it is a single-page order (take the first `pageSize`, no
 * cursor walk).
 */
export type SeoFactsListOrder = "id_asc" | "published_desc";

export type ListPublicResourceFactsOptions = {
  /** Keyset pagination cursor from a previous page; `undefined`/`null` for the first page. Applies to `"id_asc"` order only. */
  cursor?: string | null;
  pageSize?: number;
  /** When set, the provider returns only facts for this locale's public resources. */
  locale?: string;
  /**
   * Positional page start for deterministic sitemap paging (`seo_facts` 1.1.0).
   * When set, the provider returns the window `[offset, offset+pageSize)` of the
   * stable `"id_asc"` order — the sitemap generator maps child-sitemap page N to
   * `offset = (N-1)*perPage` so page N is fetched without walking pages 1..N-1.
   * `cursor` takes precedence when both are given. Ignored for `"published_desc"`.
   */
  offset?: number;
  /** Result ordering (`seo_facts` 1.1.0); defaults to `"id_asc"` (unchanged historical behavior). */
  order?: SeoFactsListOrder;
};

export type SeoResourceFactsPage = {
  items: readonly SeoResourceFacts[];
  nextCursor: string | null;
};

/**
 * A cheap, bounded roll-up of a tenant's public sitemap/feed-eligible resource
 * set (`seo_facts` 1.1.0) — `count` plus the latest change/publish timestamps —
 * WITHOUT materializing every resource's full `SeoResourceFacts`.
 * `seo_distribution` uses it to (a) size the sitemap index deterministically
 * (`pageCount = ceil(count / urlsPerPage)`) and (b) derive HTTP cache validators
 * (ETag / `Last-Modified`) so a conditional request is answered without rendering
 * the whole surface. Because the count/max are re-derived from the provider's own
 * tables at call time (never a cached curation list), any publish/update/archive/
 * delete/restore that changes the eligible set also changes them — exactly the
 * event-driven invalidation signal the validators need (ADR-0038 §7).
 */
export type SeoResourceFactsSummary = {
  /** Number of public, sitemap/feed-eligible resources for this tenant (and `locale`, when given). */
  count: number;
  /** Latest resource `updated_at` across the eligible set, ISO-8601 — the `<lastmod>` / `Last-Modified` source; `null` when the set is empty. */
  latestLastmod: string | null;
  /** Latest resource `published_at` across the eligible set, ISO-8601; `null` when the set is empty. */
  latestPublishedAt: string | null;
};

/**
 * The port itself. A content module implements it as
 * `<module>/application/seo-facts-port-adapter.ts`; the SEO renderer/sitemap/feed
 * generator imports that adapter at the composition root and injects it as a
 * plain function parameter — never a direct cross-module import inside
 * `application`/`domain`.
 */
export type SeoFactsSource = {
  /** Enumerate this tenant's public, sitemap/feed-eligible resources, keyset-paginated. Excludes every non-public resource by construction (ADR-0038 §6). */
  listPublicResourceFacts(
    tx: Bun.SQL,
    tenantId: string,
    options?: ListPublicResourceFactsOptions
  ): Promise<SeoResourceFactsPage>;

  /** Resolve one resource's facts for metadata rendering; `null` when the id does not exist for this tenant. Visibility is carried in the result (a `noindex`/`private` resource still resolves, so the caller can render `robots`/deny correctly) — the caller, not the provider, decides what to emit per ADR-0038 §6. */
  resolveResourceFacts(
    tx: Bun.SQL,
    tenantId: string,
    resourceType: string,
    resourceId: string
  ): Promise<SeoResourceFacts | null>;

  /**
   * Cheap, bounded roll-up (`count` + latest `updated_at`/`published_at`) of the
   * SAME public, sitemap/feed-eligible set `listPublicResourceFacts` enumerates —
   * a single aggregate query, never a full listing. OPTIONAL (backward-compatible
   * `seo_facts` 1.1.0 addition): a provider written against 1.0.0 is still a valid
   * `SeoFactsSource`, and `seo_distribution` falls back to a bounded listing when
   * this is absent. When implemented it MUST use the IDENTICAL visibility
   * predicate as `listPublicResourceFacts` so the count/max exactly describe the
   * set the listing would return (ADR-0038 §6/§7).
   */
  summarizePublicResourceFacts?(
    tx: Bun.SQL,
    tenantId: string,
    options?: Pick<ListPublicResourceFactsOptions, "locale">
  ): Promise<SeoResourceFactsSummary>;
};

// ---------------------------------------------------------------------------
// Contract invariants (pure). These are the CONTRACT's teeth, not the runtime
// renderer: the discovery/metadata surfaces inherit them as compile/asserted
// guarantees instead of re-deriving (and possibly weakening) them. None of these
// render a page, generate a sitemap, or touch a table.
// ---------------------------------------------------------------------------

export type SeoCacheKeyParts = {
  tenantId: string;
  /** The resolved primary host for this tenant (server-derived from `tenant_domain`), never the raw request `Host`. */
  host: string;
  locale: string;
  resourceType: string;
  resourceId: string;
  /** Contract version so a shape change invalidates every cached entry. */
  contractVersion: string;
};

/**
 * Compose the cache key for one rendered SEO contract. The three isolation
 * components — `tenantId`, `host`, `locale` — are MANDATORY: a missing/empty one
 * throws, so no implementation can accidentally build a key that lets one tenant's
 * output serve another (ADR-0038 §7, the cache-poisoning / cross-tenant defense).
 * Because `tenantId` is always part of the key, cross-tenant cache confusion is
 * structurally impossible.
 */
export function buildSeoCacheKey(parts: SeoCacheKeyParts): string {
  const required: readonly (keyof SeoCacheKeyParts)[] = [
    "tenantId",
    "host",
    "locale",
    "resourceType",
    "resourceId",
    "contractVersion"
  ];
  for (const field of required) {
    const value = parts[field];
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(
        `buildSeoCacheKey: "${field}" is required and must be a non-empty string — the SEO cache key must include tenant/host/locale so one tenant's output can never serve another (ADR-0038 §7).`
      );
    }
  }
  // Order is fixed and tenant-first; EVERY component (including
  // `contractVersion`) is percent-encoded so a value containing the `:`
  // separator cannot shift a component and forge a different key (uniform
  // injectivity).
  return [
    "seo",
    encodeURIComponent(parts.contractVersion),
    encodeURIComponent(parts.tenantId),
    encodeURIComponent(parts.host.toLowerCase()),
    encodeURIComponent(parts.locale),
    encodeURIComponent(parts.resourceType),
    encodeURIComponent(parts.resourceId)
  ].join(":");
}

/**
 * `true` when a resource may be SERVED as a public page (renders). A `noindex`
 * page is still resolvable (it renders with `robots: noindex`) — that is why
 * `noindex` does not fail this check.
 */
export function isPubliclyResolvable(
  visibility: SeoVisibility,
  nowIso: string
): boolean {
  switch (visibility.state) {
    case "draft":
    case "deleted":
    case "private":
    case "unpublished":
    case "archived":
      return false;
    case "scheduled":
      return (
        visibility.scheduledPublishAt !== null &&
        Date.parse(visibility.scheduledPublishAt) <= Date.parse(nowIso)
      );
    case "published":
      return true;
    default:
      // Fail-closed: any state outside the union (e.g. a value cast past the
      // type system) is treated as not public.
      return false;
  }
}

/**
 * `true` when a resource belongs in public discovery surfaces (sitemap, feeds,
 * `index` robots directive). Strictly stronger than `isPubliclyResolvable`: it
 * additionally requires NOT `noindex`. This single predicate is the
 * unpublished-content-leakage defense (ADR-0038 §6) — nothing that is not
 * publicly resolvable, and nothing marked `noindex`, ever reaches a sitemap or
 * feed.
 */
export function isPubliclyIndexable(
  visibility: SeoVisibility,
  nowIso: string
): boolean {
  return !visibility.noindex && isPubliclyResolvable(visibility, nowIso);
}

export const JSON_LD_ALLOWED_TYPES: ReadonlySet<JsonLdType> =
  new Set<JsonLdType>([
    "Article",
    "NewsArticle",
    "BlogPosting",
    "WebPage",
    "WebSite",
    "BreadcrumbList",
    "Organization",
    "ImageObject",
    "Person"
  ]);

/**
 * Escape a text value for safe embedding inside a
 * `<script type="application/ld+json">` block. Escapes `<`, `>`, `&` (and the
 * line/paragraph separators JSON leaves raw) to their `\uXXXX` forms so a value
 * can never terminate the script element or open a new tag. The controlled
 * `JsonLdType` union already blocks structural injection; this handles the
 * remaining string-content vector (ADR-0038 threat model, JSON-LD injection).
 */
export function escapeJsonLdText(value: string): string {
  return value
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Object keys allowed in a controlled JSON-LD node. Deliberately narrow: a key
 * like `</script><script>` can break out of a `<script>` block exactly as a value
 * can, so keys must be plain schema.org term names / `@`-keywords. If a future
 * `@context` compact-IRI style key is ever needed, extend this pattern
 * consciously rather than loosening it silently.
 */
const JSON_LD_KEY_PATTERN = /^[A-Za-z@][A-Za-z0-9_@]*$/;

/**
 * Assert a JSON-LD node is built from the controlled schema only: every `@type`
 * (recursively) is in `JSON_LD_ALLOWED_TYPES` and every object KEY matches
 * `JSON_LD_KEY_PATTERN`. Throws on the first violation.
 *
 * This validates STRUCTURE (types + keys) ONLY — it deliberately does NOT throw on
 * the CONTENT of a string value (e.g. a value that contains a `</script`
 * substring). Value content is neutralized by ESCAPING, not by rejection:
 * `renderControlledJsonLd` runs `escapeJsonLdText` over the whole serialized
 * string, turning `<`/`>`/`&` (and U+2028/U+2029) into `\uXXXX`, so a value can
 * never terminate the `<script>` element by construction. Rejecting a `</script`
 * value here would instead let legitimate tenant content (a post title that
 * literally contains `</script`) fail the ENTIRE head render — a self-DoS — for no
 * added safety, since escaping already covers it. Structural controls (the closed
 * `@type` union and the key pattern) still throw, because those are NOT
 * neutralized by escaping the serialized string.
 *
 * This alone is NOT sufficient to emit safe markup — use `renderControlledJsonLd`,
 * which validates here AND escapes the serialized output so both keys and values
 * are neutralized (a caller cannot forget to escape).
 */
export function assertControlledJsonLd(node: JsonLdNode): void {
  const visit = (value: JsonLdValue, path: string): void => {
    if (typeof value === "string") {
      // No throw on value CONTENT — see the header: escaping (not rejection)
      // neutralizes a `</script` in a string value, and rejecting it would be a
      // self-DoS on legitimate tenant text.
      return;
    }
    if (typeof value === "number" || typeof value === "boolean") return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    // Object node.
    const objectNode = value as JsonLdNode;
    const type = objectNode["@type"];
    if (!JSON_LD_ALLOWED_TYPES.has(type)) {
      throw new Error(
        `assertControlledJsonLd: "@type" ${JSON.stringify(
          type
        )} at ${path} is not in the controlled schema set (ADR-0038 threat model, JSON-LD injection).`
      );
    }
    for (const [key, child] of Object.entries(objectNode)) {
      if (!JSON_LD_KEY_PATTERN.test(key)) {
        throw new Error(
          `assertControlledJsonLd: object key ${JSON.stringify(
            key
          )} at ${path} is not a controlled JSON-LD key — a key can break out of a <script> block just like a value can (ADR-0038 threat model, JSON-LD injection).`
        );
      }
      visit(child, `${path}.${key}`);
    }
  };
  visit(node, "$");
}

/**
 * Render a JSON-LD node to the exact string safe to place inside a
 * `<script type="application/ld+json">` block — the SINGLE guard the head renderer
 * should use, so escaping can never be forgotten:
 *
 * 1. `assertControlledJsonLd` validates every `@type` and every object key against
 *    the closed schema;
 * 2. `JSON.stringify` serializes;
 * 3. `escapeJsonLdText` neutralizes `<`, `>`, `&`, U+2028, U+2029 across the WHOLE
 *    serialized string — so KEYS and VALUES are both covered (a `\uXXXX` escape
 *    inside a JSON string round-trips to the original character for a JSON-LD
 *    parser, but can never terminate the script element).
 *
 * The output is guaranteed to contain no raw `<`, `>`, or `&`.
 */
export function renderControlledJsonLd(node: JsonLdNode): string {
  assertControlledJsonLd(node);
  return escapeJsonLdText(JSON.stringify(node));
}
