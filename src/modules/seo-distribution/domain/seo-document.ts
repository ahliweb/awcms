/**
 * The central SEO document builder (ADR-0038 §4/§6) — the ONE place
 * a public resource's `SeoResourceFacts` (server-derived by a content module's
 * `SeoFactsSource` adapter) plus the tenant's SEO defaults plus the
 * server-resolved primary host become a single, deterministic head model. This
 * replaces the ad-hoc, per-route metadata derivation ADR-0038 §Konteks names as
 * the drift risk: canonical, hreflang, robots, Open Graph, Twitter, and
 * controlled JSON-LD are all decided here, once.
 *
 * This module is PURE (no I/O). It imports ONLY the frozen contract port
 * (`_shared/ports/seo-facts-port.ts`, ADR-0038) — never a content
 * module's internals. Every security-relevant decision delegates to that port's
 * frozen guards rather than re-deriving them:
 *
 * - `isPubliclyResolvable` / `isPubliclyIndexable` — the publication-state
 *   leakage defense. A resource the provider says is not publicly resolvable
 *   yields `{ renderable: false }` and the route denies it; a resolvable but
 *   non-indexable (or tenant-wide `noindex`) resource renders with
 *   `robots: noindex` and carries NO structured data.
 * - The HOST is server-derived (passed in from `tenant_domain`, never a request
 *   header) — this builder never sees `Host`/`X-Forwarded-Host`.
 *
 * The actual `<head>` string is emitted by `seo-head-rendering.ts`, which is the
 * only place JSON-LD is serialized (via the port's `renderControlledJsonLd`) —
 * keeping "decide the model" and "escape the markup" separate, same discipline
 * `blog-content`'s own `seo-rendering.ts` / `public-page-rendering.ts` split.
 */
import {
  isPubliclyIndexable,
  isPubliclyResolvable,
  type JsonLdNode,
  type SeoResourceFacts,
  type SeoRobotsDirective
} from "../../_shared/ports/seo-facts-port";
import type { SeoTenantSettings } from "./seo-config";

/**
 * The contract version stamped into the SEO cache key (`buildSeoCacheKey`). Kept
 * equal to `CAPABILITY_CONTRACT_VERSIONS["seo_facts"]` — a unit test
 * (`tests/unit/seo-document-builder.test.ts`) pins the two together so a
 * contract shape change that bumps the capability version also invalidates every
 * cached rendered head.
 */
export const SEO_RENDER_CONTRACT_VERSION = "1.1.0";

/** An OG/Twitter image already resolved through `MediaLibraryPort` (same-tenant, verified) by the application layer — never a raw tenant URL. */
export type ResolvedSeoImage = {
  url: string;
  alt: string | null;
  mimeType: string;
  width: number | null;
  height: number | null;
};

/** Everything the builder needs that is NOT on `SeoResourceFacts` — all server-derived by the application layer before this pure step. */
export type SeoRenderContext = {
  /** The tenant's primary host (server-derived from `tenant_domain`), or `null` when the deployment has no primary domain (offline-lan degrade — no host is invented, ADR-0038 §5.4). */
  primaryHost: string | null;
  /** The tenant's display name (`awcms_tenants.tenant_name`) — the `og:site_name` fallback when `settings.siteName` is null. */
  tenantDisplayName: string;
  settings: SeoTenantSettings;
  /** The effective social image, already resolved (facts image id first, then the tenant default), or `null` when neither resolved to a safe same-tenant object. */
  resolvedImage: ResolvedSeoImage | null;
  /** ISO-8601 "now" used for scheduled-publish and indexability evaluation — passed in so the builder stays pure/testable. */
  nowIso: string;
};

export type SeoOpenGraphModel = {
  title: string;
  description: string | null;
  type: string;
  /** = canonical URL, or `null` when there is no absolute/relative canonical. */
  url: string | null;
  siteName: string;
  locale: string;
  image: ResolvedSeoImage | null;
};

export type SeoTwitterModel = {
  card: "summary" | "summary_large_image";
  site: string | null;
  title: string;
  description: string | null;
  image: ResolvedSeoImage | null;
};

export type SeoLocaleLink = {
  /** BCP-47 tag or `"x-default"`. */
  hreflang: string;
  href: string;
};

/** The fully-resolved head model — everything `seo-head-rendering.ts` needs, with zero further decisions. */
export type SeoDocument = {
  locale: string;
  title: string;
  description: string | null;
  robots: SeoRobotsDirective;
  /** Absolute (`https://host/path`) when a primary host is known; relative (`/path`) when it is not — never invented from a request header. */
  canonicalUrl: string;
  localeAlternates: readonly SeoLocaleLink[];
  openGraph: SeoOpenGraphModel;
  twitter: SeoTwitterModel;
  /** Controlled schema.org nodes — resource nodes (from the provider) plus site-identity nodes (from tenant config). Empty when the resource is not indexable (structured data is a discovery surface). */
  jsonLd: readonly JsonLdNode[];
};

export type SeoDocumentResult =
  { renderable: false } | { renderable: true; document: SeoDocument };

function absoluteOrRelative(primaryHost: string | null, path: string): string {
  // Host is ALWAYS server-derived; when absent we degrade to the relative path
  // rather than inventing a host from the request (host-header-poisoning
  // defense, ADR-0038 §5). A relative canonical still resolves correctly
  // against the page's own URL for every crawler.
  if (primaryHost === null) return path;
  return `https://${primaryHost}${path}`;
}

function parseRobots(directive: SeoRobotsDirective): {
  noindex: boolean;
  nofollow: boolean;
} {
  return {
    noindex: directive.startsWith("noindex"),
    nofollow: directive.endsWith("nofollow")
  };
}

function composeRobots(
  noindex: boolean,
  nofollow: boolean
): SeoRobotsDirective {
  return `${noindex ? "noindex" : "index"},${
    nofollow ? "nofollow" : "follow"
  }` as SeoRobotsDirective;
}

/**
 * Build the WebSite/Organization site-identity JSON-LD nodes from tenant config.
 * Emitted only when there is enough identity to be meaningful (a name), and
 * always through the controlled `@type` union so injection is structurally
 * blocked. `logoUrl` is an already-resolved media URL or `null`.
 */
function buildSiteIdentityNodes(
  context: SeoRenderContext,
  siteName: string,
  organizationLogoUrl: string | null
): JsonLdNode[] {
  const nodes: JsonLdNode[] = [];
  const siteUrl =
    context.primaryHost !== null ? `https://${context.primaryHost}/` : null;

  const website: Record<string, unknown> = {
    "@type": "WebSite",
    name: siteName
  };
  if (siteUrl !== null) website.url = siteUrl;
  nodes.push(website as JsonLdNode);

  if (context.settings.organizationName !== null) {
    const org: Record<string, unknown> = {
      "@type": "Organization",
      name: context.settings.organizationName
    };
    if (siteUrl !== null) org.url = siteUrl;
    if (organizationLogoUrl !== null) org.logo = organizationLogoUrl;
    nodes.push(org as JsonLdNode);
  }

  return nodes;
}

/**
 * Resolve one public resource's facts into a complete `SeoDocument`, or signal
 * `{ renderable: false }` when the provider says it is not publicly resolvable
 * (draft/scheduled-future/archived/deleted/private/unpublished) — the route
 * turns that into the same 404/deny it already returns today, and NOTHING about
 * the resource reaches public output.
 *
 * `organizationLogoUrl` is the already-resolved Organization logo media URL (or
 * `null`); the application layer resolves it through `MediaLibraryPort` before
 * calling this pure step, exactly like `context.resolvedImage`.
 */
export function buildSeoDocument(
  facts: SeoResourceFacts,
  context: SeoRenderContext,
  organizationLogoUrl: string | null = null
): SeoDocumentResult {
  if (!isPubliclyResolvable(facts.visibility, context.nowIso)) {
    return { renderable: false };
  }

  const indexable =
    isPubliclyIndexable(facts.visibility, context.nowIso) &&
    !context.settings.defaultRobotsNoindex;

  const factsRobots = parseRobots(facts.metadata.robots);
  const robots = composeRobots(
    // Force noindex when the resource is not indexable OR the provider already
    // said noindex — tenant/state can only ever REMOVE indexability here.
    !indexable || factsRobots.noindex,
    factsRobots.nofollow
  );

  const canonicalUrl = absoluteOrRelative(
    context.primaryHost,
    facts.canonicalPath
  );

  // Reciprocal alternates only — the provider already excludes locales with no
  // published translation (ADR-0038 §4). `x-default` points at the resource's
  // own canonical, the deterministic "no better locale match" target.
  const localeAlternates: SeoLocaleLink[] = [
    ...facts.localeAlternates.map((alt) => ({
      hreflang: alt.locale,
      href: absoluteOrRelative(context.primaryHost, alt.path)
    })),
    { hreflang: "x-default", href: canonicalUrl }
  ];

  const siteName = context.settings.siteName ?? context.tenantDisplayName;
  const description =
    facts.metadata.description ?? context.settings.defaultMetaDescription;
  const ogDescription = facts.openGraph.description ?? description;

  // The resource's own locale — its canonical alternate's locale when present,
  // else the first alternate's; empty when the resource carries no alternates.
  const resourceLocale =
    facts.localeAlternates.find((alt) => alt.path === facts.canonicalPath)
      ?.locale ??
    facts.localeAlternates[0]?.locale ??
    "";

  const openGraph: SeoOpenGraphModel = {
    title: facts.openGraph.title,
    description: ogDescription,
    type: facts.openGraph.type,
    url: canonicalUrl,
    siteName,
    locale: resourceLocale,
    image: context.resolvedImage
  };

  const twitter: SeoTwitterModel = {
    card: context.resolvedImage ? "summary_large_image" : "summary",
    site: context.settings.twitterSiteHandle,
    title: facts.openGraph.title,
    description: ogDescription,
    image: context.resolvedImage
  };

  // Structured data is a DISCOVERY surface: present only for indexable
  // resources (ADR-0038 §6 — draft/private/noindex absent from public
  // structured data). Resource nodes come from the provider (already controlled
  // `@type`s); site-identity nodes come from tenant config.
  const jsonLd: JsonLdNode[] = indexable
    ? [
        ...buildSiteIdentityNodes(context, siteName, organizationLogoUrl),
        ...facts.jsonLd
      ]
    : [];

  return {
    renderable: true,
    document: {
      locale: resourceLocale,
      title: facts.metadata.title,
      description,
      robots,
      canonicalUrl,
      localeAlternates,
      openGraph,
      twitter,
      jsonLd
    }
  };
}
