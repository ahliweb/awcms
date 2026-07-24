/**
 * Public discovery / syndication orchestrator (ADR-0038 §4-§7) — the
 * composition point that turns injected `seo_facts` providers + tenant SEO config
 * + the server-derived primary host into a rendered robots.txt / sitemap index /
 * child sitemap / RSS / Atom / JSON feed, plus its HTTP cache validators.
 *
 * Everything host/visibility/injection-sensitive is delegated, never re-derived:
 * - HOST comes from `resolveTenantPrimaryHost` (server-derived, `tenant_domain`)
 *   — this service never reads a request header; absolute URLs are built from it,
 *   and when there is no primary host it degrades to relative paths (never invents
 *   a host — ADR-0038 §5.4).
 * - VISIBILITY gating uses the frozen `isPubliclyIndexable` guard on EVERY fact
 *   before it can reach any public surface — the unpublished-content-leakage
 *   defense, on top of the provider's own eligibility predicate (defense in depth).
 * - IMAGES resolve through `MediaLibraryPort` (same-tenant, verified); an id that
 *   does not resolve is simply dropped.
 * - CACHE VALIDATORS come from a deterministic signature (`discovery-cache.ts`)
 *   over the surface kind + host + locale + contract version + config fingerprint
 *   + a bounded content roll-up — so any publish/update/archive/delete/domain/
 *   config change invalidates the affected output (ADR-0038 §7).
 *
 * NO cross-content-module import: the `SeoFactsSource[]` providers and the
 * `MediaLibraryPort` are plain parameters, wired at the route composition root
 * (`src/lib/seo/discovery-providers.ts`) — this module never imports a content
 * module's internals (the `seo_facts` port is the only shared surface).
 *
 * Bounded by construction: the sitemap index sizes itself from a cheap
 * `summarize` roll-up; each child page is one bounded window; feeds are capped at
 * `feed_item_limit` (≤ 200). No request enumerates all tenant content.
 */
import {
  isPubliclyIndexable,
  type ListPublicResourceFactsOptions,
  type SeoFactsSource,
  type SeoResourceFacts,
  type SeoResourceFactsSummary
} from "../../_shared/ports/seo-facts-port";
import type {
  MediaLibraryPort,
  ResolvedMediaReferenceDTO
} from "../../_shared/ports/media-library-port";
import { SEO_RENDER_CONTRACT_VERSION } from "../domain/seo-document";
import { buildDiscoverySignature, buildEtag } from "../domain/discovery-cache";
import {
  SITEMAP_PROTOCOL_MAX_URLS,
  SITEMAP_URLS_PER_PAGE
} from "../domain/discovery-limits";
import {
  renderSitemapIndex,
  renderUrlset,
  sitemapPageCount,
  type SitemapAlternate,
  type SitemapIndexChild,
  type SitemapUrlEntry
} from "../domain/sitemap-serialization";
import {
  renderAtom,
  renderJsonFeed,
  renderRss,
  type FeedChannel,
  type FeedItem
} from "../domain/feed-serialization";
import { renderRobotsTxt } from "../domain/robots-serialization";
import type { SeoTenantSettings } from "../domain/seo-config";
import {
  fetchSeoSettingsUpdatedAt,
  fetchSeoTenantSettings
} from "./seo-config-directory";
import { resolveTenantPrimaryHost } from "./resolve-canonical-host";

/** Stable no-host sentinel used in cache keys when a tenant has no verified primary domain (never borrows the request host). */
const NO_HOST_SENTINEL = "no-primary-domain.invalid";

export type FeedFormat = "rss" | "atom" | "jsonfeed";

/** Everything a discovery build needs — providers + media port injected by the composition root. */
export type SeoDiscoveryContext = {
  tx: Bun.SQL;
  tenantId: string;
  tenantDisplayName: string;
  defaultLocale: string;
  providers: readonly SeoFactsSource[];
  mediaLibrary: MediaLibraryPort | null;
  /** Defaults to `new Date()` — injectable for deterministic tests. */
  now?: Date;
};

/** A fully-rendered discovery response body plus its cache validators. */
export type DiscoveryPayload = {
  body: string;
  contentType: string;
  etag: string;
  /** `Last-Modified` as a Date; the route formats it. */
  lastModified: Date;
};

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit testing).
// ---------------------------------------------------------------------------

/** Absolute `https://host/path` when a primary host is known, else the relative path (never invents a host). */
export function absoluteUrl(primaryHost: string | null, path: string): string {
  return primaryHost === null ? path : `https://${primaryHost}${path}`;
}

/** Config fingerprint — every settings value that shapes discovery output; a change invalidates the cache. */
export function configFingerprint(settings: SeoTenantSettings): string {
  return [
    settings.siteName ?? "",
    settings.defaultMetaDescription ?? "",
    settings.feedTitle ?? "",
    settings.feedDescription ?? "",
    settings.feedLogoMediaId ?? "",
    String(settings.feedItemLimit),
    (settings.includedResourceTypes ?? []).join(","),
    settings.sitemapEnabled ? "1" : "0",
    settings.feedsEnabled ? "1" : "0",
    settings.defaultRobotsNoindex ? "1" : "0",
    settings.organizationName ?? ""
  ].join("|");
}

/** Content fingerprint — the bounded roll-up that moves on any publish/update/archive/delete. */
export function contentFingerprintOf(summary: SeoResourceFactsSummary): string {
  return `${summary.count}|${summary.latestLastmod ?? ""}|${
    summary.latestPublishedAt ?? ""
  }`;
}

/** `Last-Modified` = latest of (content lastmod, config updated_at); epoch floor when both absent (stable, ETag remains the primary validator). */
export function computeLastModified(
  contentLatestLastmod: string | null,
  settingsUpdatedAt: Date | null
): Date {
  const candidates: number[] = [];
  if (contentLatestLastmod !== null) {
    const parsed = Date.parse(contentLatestLastmod);
    if (!Number.isNaN(parsed)) candidates.push(parsed);
  }
  if (settingsUpdatedAt !== null) candidates.push(settingsUpdatedAt.getTime());
  return candidates.length === 0
    ? new Date(0)
    : new Date(Math.max(...candidates));
}

function isIncludedType(
  settings: SeoTenantSettings,
  fact: SeoResourceFacts
): boolean {
  return (
    settings.includedResourceTypes === null ||
    settings.includedResourceTypes.includes(fact.resourceType)
  );
}

/** Newest of two ISO-8601 UTC strings (lexicographic == chronological for fixed-format `toISOString()` values). */
function maxIso(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}

// ---------------------------------------------------------------------------
// Provider aggregation (bounded).
// ---------------------------------------------------------------------------

/** Cheap per-provider roll-up — the 1.1.0 `summarize` method when present, else a bounded keyset walk (only hit by a pre-1.1.0 derived provider). */
async function providerSummary(
  provider: SeoFactsSource,
  tx: Bun.SQL,
  tenantId: string,
  locale: string | null
): Promise<SeoResourceFactsSummary> {
  if (provider.summarizePublicResourceFacts) {
    return provider.summarizePublicResourceFacts(
      tx,
      tenantId,
      locale !== null ? { locale } : undefined
    );
  }

  let count = 0;
  let latestLastmod: string | null = null;
  let latestPublishedAt: string | null = null;
  let cursor: string | null = null;

  while (count < SITEMAP_PROTOCOL_MAX_URLS) {
    const page = await provider.listPublicResourceFacts(tx, tenantId, {
      cursor,
      pageSize: 1000,
      locale: locale ?? undefined,
      order: "id_asc"
    });
    for (const fact of page.items) {
      count++;
      latestLastmod = maxIso(latestLastmod, fact.sitemap?.lastmod ?? null);
      latestPublishedAt = maxIso(
        latestPublishedAt,
        fact.feed?.publishedAt ?? null
      );
    }
    if (page.nextCursor === null) break;
    cursor = page.nextCursor;
  }

  return { count, latestLastmod, latestPublishedAt };
}

/** Sum across providers — total count + latest timestamps. */
async function summarizeAll(
  ctx: SeoDiscoveryContext,
  locale: string | null
): Promise<SeoResourceFactsSummary> {
  let count = 0;
  let latestLastmod: string | null = null;
  let latestPublishedAt: string | null = null;

  for (const provider of ctx.providers) {
    const summary = await providerSummary(
      provider,
      ctx.tx,
      ctx.tenantId,
      locale
    );
    count += summary.count;
    latestLastmod = maxIso(latestLastmod, summary.latestLastmod);
    latestPublishedAt = maxIso(latestPublishedAt, summary.latestPublishedAt);
  }

  return { count, latestLastmod, latestPublishedAt };
}

/**
 * The global `[offset, offset+pageSize)` window over providers concatenated in a
 * fixed order (id_asc within each) — deterministic child-sitemap paging without
 * walking earlier pages. One bounded query per provider that overlaps the window.
 */
async function listWindow(
  ctx: SeoDiscoveryContext,
  offset: number,
  pageSize: number
): Promise<SeoResourceFacts[]> {
  const out: SeoResourceFacts[] = [];
  let skip = offset;
  let remaining = pageSize;

  for (const provider of ctx.providers) {
    if (remaining <= 0) break;
    const count = (await providerSummary(provider, ctx.tx, ctx.tenantId, null))
      .count;
    if (skip >= count) {
      skip -= count;
      continue;
    }
    const options: ListPublicResourceFactsOptions = {
      offset: skip,
      pageSize: remaining,
      order: "id_asc"
    };
    const page = await provider.listPublicResourceFacts(
      ctx.tx,
      ctx.tenantId,
      options
    );
    out.push(...page.items);
    remaining -= page.items.length;
    skip = 0;
  }

  return out;
}

/** The latest `limit` items merged newest-first across providers (bounded: providers × limit). */
async function listLatest(
  ctx: SeoDiscoveryContext,
  limit: number,
  locale: string | null
): Promise<SeoResourceFacts[]> {
  const collected: SeoResourceFacts[] = [];

  for (const provider of ctx.providers) {
    const page = await provider.listPublicResourceFacts(ctx.tx, ctx.tenantId, {
      pageSize: limit,
      locale: locale ?? undefined,
      order: "published_desc"
    });
    collected.push(...page.items);
  }

  collected.sort((a, b) => {
    const ap = a.feed?.publishedAt ?? "";
    const bp = b.feed?.publishedAt ?? "";
    return bp.localeCompare(ap);
  });

  return collected.slice(0, limit);
}

async function resolveMediaMap(
  ctx: SeoDiscoveryContext,
  ids: readonly string[]
): Promise<ReadonlyMap<string, ResolvedMediaReferenceDTO>> {
  const unique = [...new Set(ids)];
  if (ctx.mediaLibrary === null || unique.length === 0) {
    return new Map();
  }
  return ctx.mediaLibrary.resolveMediaReferences(ctx.tx, ctx.tenantId, unique);
}

// ---------------------------------------------------------------------------
// Surface builders.
// ---------------------------------------------------------------------------

async function loadBase(ctx: SeoDiscoveryContext): Promise<{
  settings: SeoTenantSettings;
  primaryHost: string | null;
  settingsUpdatedAt: Date | null;
}> {
  // Sequential, not Promise.all: concurrent queries on one tx connection leak it (idle in transaction).
  const settings = await fetchSeoTenantSettings(ctx.tx, ctx.tenantId);
  const primaryHost = await resolveTenantPrimaryHost(ctx.tx, ctx.tenantId);
  const settingsUpdatedAt = await fetchSeoSettingsUpdatedAt(
    ctx.tx,
    ctx.tenantId
  );
  return { settings, primaryHost, settingsUpdatedAt };
}

function finalize(
  kind: string,
  page: number | undefined,
  contentType: string,
  body: string,
  settings: SeoTenantSettings,
  summary: SeoResourceFactsSummary,
  tenantId: string,
  host: string | null,
  locale: string,
  settingsUpdatedAt: Date | null
): DiscoveryPayload {
  const signature = buildDiscoverySignature({
    kind,
    tenantId,
    host: host ?? NO_HOST_SENTINEL,
    locale,
    contractVersion: SEO_RENDER_CONTRACT_VERSION,
    page,
    configFingerprint: configFingerprint(settings),
    contentFingerprint: contentFingerprintOf(summary)
  });
  return {
    body,
    contentType,
    etag: buildEtag(signature),
    lastModified: computeLastModified(summary.latestLastmod, settingsUpdatedAt)
  };
}

/** robots.txt — content-independent (host + noindex + sitemapEnabled). */
export async function buildRobotsPayload(
  ctx: SeoDiscoveryContext
): Promise<DiscoveryPayload> {
  const { settings, primaryHost, settingsUpdatedAt } = await loadBase(ctx);
  const body = renderRobotsTxt({
    primaryHost,
    siteNoindex: settings.defaultRobotsNoindex,
    sitemapEnabled: settings.sitemapEnabled
  });
  const emptySummary: SeoResourceFactsSummary = {
    count: 0,
    latestLastmod: null,
    latestPublishedAt: null
  };
  return finalize(
    "robots",
    undefined,
    "text/plain; charset=utf-8",
    body,
    settings,
    emptySummary,
    ctx.tenantId,
    primaryHost,
    ctx.defaultLocale,
    settingsUpdatedAt
  );
}

/** Sitemap index (`<sitemapindex>`) — or `null` when sitemaps are disabled (route → 404). */
export async function buildSitemapIndexPayload(
  ctx: SeoDiscoveryContext
): Promise<DiscoveryPayload | null> {
  const { settings, primaryHost, settingsUpdatedAt } = await loadBase(ctx);
  // Tenant-wide noindex suppresses the machine-readable discovery surfaces too,
  // not just robots.txt and the in-page <head> — otherwise a "whole-site
  // noindex" staging deployment still hands crawlers/scrapers/feed aggregators a
  // full URL enumeration (auditor MEDIUM-1). Mirrors `buildSeoDocument`'s
  // `!defaultRobotsNoindex` gate and robots.txt's `Disallow: /`.
  if (!settings.sitemapEnabled || settings.defaultRobotsNoindex) return null;
  // A sitemap `<loc>` MUST be an absolute URL (sitemaps.org protocol). With no
  // verified primary host we would emit relative paths — an invalid document —
  // so we 404 instead (robots.txt already drops its `Sitemap:` line the same
  // way). Offline-lan / not-yet-configured tenants legitimately have no public
  // sitemap; this refines ADR-0038 §5.4's "degrade to relative" — which is safe
  // for an in-page canonical but not for a machine-consumed sitemap/feed.
  if (primaryHost === null) return null;

  const summary = await summarizeAll(ctx, null);
  const pageCount = sitemapPageCount(summary.count);

  const children: SitemapIndexChild[] = [];
  for (let page = 1; page <= pageCount; page++) {
    children.push({
      loc: absoluteUrl(primaryHost, `/sitemap-${page}.xml`),
      lastmod: summary.latestLastmod
    });
  }

  const body = renderSitemapIndex(children);
  return finalize(
    "sitemap-index",
    undefined,
    "application/xml; charset=utf-8",
    body,
    settings,
    summary,
    ctx.tenantId,
    primaryHost,
    ctx.defaultLocale,
    settingsUpdatedAt
  );
}

/** One child sitemap page (`<urlset>`) — `null` when sitemaps are disabled OR the page is out of range (route → 404). */
export async function buildSitemapPagePayload(
  ctx: SeoDiscoveryContext,
  page: number
): Promise<DiscoveryPayload | null> {
  const { settings, primaryHost, settingsUpdatedAt } = await loadBase(ctx);
  // Tenant-wide noindex suppresses the machine-readable discovery surfaces too,
  // not just robots.txt and the in-page <head> — otherwise a "whole-site
  // noindex" staging deployment still hands crawlers/scrapers/feed aggregators a
  // full URL enumeration (auditor MEDIUM-1). Mirrors `buildSeoDocument`'s
  // `!defaultRobotsNoindex` gate and robots.txt's `Disallow: /`.
  if (!settings.sitemapEnabled || settings.defaultRobotsNoindex) return null;
  // No absolute host → no valid `<loc>` (see the index builder). 404, not a
  // relative-URL 200.
  if (primaryHost === null) return null;
  if (!Number.isInteger(page) || page < 1) return null;

  const summary = await summarizeAll(ctx, null);
  const pageCount = sitemapPageCount(summary.count);
  if (page > pageCount) return null;

  const nowIso = (ctx.now ?? new Date()).toISOString();
  const offset = (page - 1) * SITEMAP_URLS_PER_PAGE;
  const facts = await listWindow(ctx, offset, SITEMAP_URLS_PER_PAGE);

  const eligible = facts.filter(
    (fact) =>
      fact.sitemap !== null &&
      isPubliclyIndexable(fact.visibility, nowIso) &&
      isIncludedType(settings, fact)
  );

  const imageIds = eligible
    .map((fact) => fact.openGraph.imageMediaId)
    .filter((id): id is string => id !== null);
  const mediaMap = await resolveMediaMap(ctx, imageIds);

  const urls: SitemapUrlEntry[] = eligible.map((fact) => {
    // Reciprocal hreflang only for genuinely multi-locale resources (>1 locale);
    // a single self-locale resource emits no xhtml:link (nothing to reciprocate).
    const alternates: SitemapAlternate[] =
      fact.localeAlternates.length > 1
        ? [
            ...fact.localeAlternates.map((alt) => ({
              hreflang: alt.locale,
              href: absoluteUrl(primaryHost, alt.path)
            })),
            {
              hreflang: "x-default",
              href: absoluteUrl(primaryHost, fact.canonicalPath)
            }
          ]
        : [];

    const image =
      fact.openGraph.imageMediaId !== null
        ? mediaMap.get(fact.openGraph.imageMediaId)
        : undefined;

    return {
      loc: absoluteUrl(primaryHost, fact.canonicalPath),
      lastmod: fact.sitemap!.lastmod,
      changefreq: fact.sitemap!.changefreq,
      priority: fact.sitemap!.priority,
      alternates,
      images: image ? [image.publicUrl] : []
    };
  });

  const body = renderUrlset(urls);
  return finalize(
    "sitemap-page",
    page,
    "application/xml; charset=utf-8",
    body,
    settings,
    summary,
    ctx.tenantId,
    primaryHost,
    ctx.defaultLocale,
    settingsUpdatedAt
  );
}

const FEED_CONTENT_TYPE: Record<FeedFormat, string> = {
  rss: "application/rss+xml; charset=utf-8",
  atom: "application/atom+xml; charset=utf-8",
  jsonfeed: "application/feed+json; charset=utf-8"
};

const FEED_SELF_PATH: Record<FeedFormat, string> = {
  rss: "/feed.xml",
  atom: "/atom.xml",
  jsonfeed: "/feed.json"
};

/** A feed (RSS/Atom/JSON) — `null` when feeds are disabled (route → 404). `locale` narrows the feed; `null` = default/all. */
export async function buildFeedPayload(
  ctx: SeoDiscoveryContext,
  format: FeedFormat,
  locale: string | null = null
): Promise<DiscoveryPayload | null> {
  const { settings, primaryHost, settingsUpdatedAt } = await loadBase(ctx);
  // Tenant-wide noindex also suppresses feeds (auditor MEDIUM-1) — see the
  // sitemap gate above.
  if (!settings.feedsEnabled || settings.defaultRobotsNoindex) return null;
  // A feed's `<id>`/`<guid isPermaLink="true">`/`<link>` MUST be absolute
  // (RFC 4287 / RSS). No verified primary host → no valid feed; 404, not a
  // relative-URL 200 (same refinement of ADR-0038 §5.4 as the sitemap builders).
  if (primaryHost === null) return null;

  const nowIso = (ctx.now ?? new Date()).toISOString();
  // Sequential, not Promise.all: concurrent queries on one tx connection leak it (idle in transaction).
  const summary = await summarizeAll(ctx, locale);
  const latest = await listLatest(ctx, settings.feedItemLimit, locale);

  const eligible = latest
    .filter(
      (fact) =>
        fact.feed !== null &&
        isPubliclyIndexable(fact.visibility, nowIso) &&
        isIncludedType(settings, fact)
    )
    .slice(0, settings.feedItemLimit);

  const imageIds = eligible
    .map((fact) => fact.openGraph.imageMediaId)
    .filter((id): id is string => id !== null);
  if (settings.feedLogoMediaId !== null)
    imageIds.push(settings.feedLogoMediaId);
  const mediaMap = await resolveMediaMap(ctx, imageIds);

  const feedLogoUrl =
    settings.feedLogoMediaId !== null
      ? (mediaMap.get(settings.feedLogoMediaId)?.publicUrl ?? null)
      : null;

  const title =
    settings.feedTitle ?? settings.siteName ?? ctx.tenantDisplayName;
  const description =
    settings.feedDescription ??
    settings.defaultMetaDescription ??
    `Latest from ${title}`;
  const language = locale ?? ctx.defaultLocale;

  const channel: FeedChannel = {
    title,
    description,
    siteUrl: absoluteUrl(primaryHost, "/"),
    feedUrl: absoluteUrl(primaryHost, FEED_SELF_PATH[format]),
    language,
    // Empty feed → a STABLE timestamp, not `now()`: it must match the (stable,
    // content-derived) Last-Modified/ETag this same build emits, or an empty
    // feed's `<updated>`/`<lastBuildDate>` would churn on every request while its
    // validators stayed constant. `computeLastModified(null, …)` is exactly the
    // Last-Modified value for the no-content case (settings updated_at, else epoch).
    updated:
      summary.latestLastmod ??
      computeLastModified(null, settingsUpdatedAt).toISOString(),
    logoUrl: feedLogoUrl
  };

  const items: FeedItem[] = eligible.map((fact) => {
    const url = absoluteUrl(primaryHost, fact.canonicalPath);
    const image =
      fact.openGraph.imageMediaId !== null
        ? mediaMap.get(fact.openGraph.imageMediaId)
        : undefined;
    return {
      id: url,
      url,
      title: fact.metadata.title,
      summary: fact.metadata.description,
      contentText: fact.metadata.description,
      publishedAt: fact.feed!.publishedAt,
      updatedAt: fact.feed!.updatedAt,
      imageUrl: image?.publicUrl ?? null,
      imageMimeType: image?.mimeType ?? null,
      imageLength: image?.sizeBytes ?? null
    };
  });

  const body =
    format === "rss"
      ? renderRss(channel, items)
      : format === "atom"
        ? renderAtom(channel, items)
        : renderJsonFeed(channel, items);

  return finalize(
    format,
    undefined,
    FEED_CONTENT_TYPE[format],
    body,
    settings,
    summary,
    ctx.tenantId,
    primaryHost,
    language,
    settingsUpdatedAt
  );
}
