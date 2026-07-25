/**
 * Tenant-first search cache key (ADR-0040 §5 — cache-poisoning / cross-tenant /
 * cross-locale defense, ported from awcms-micro Issue #270). Mirrors
 * `seo-facts-port.ts`'s `buildSeoCacheKey`: the isolation components `tenantId` +
 * `locale` + `queryHash` are MANDATORY, so no caller can build a key that lets
 * one tenant's or one locale's search output serve another. Used for the public
 * search response `ETag` and any downstream caching — a shared key can never
 * collide across tenants because `tenantId` is always the first component.
 */
export type SearchCacheKeyParts = {
  tenantId: string;
  locale: string;
  /** sha256 of the normalized query (`hashSearchQuery`) — never the raw query. */
  queryHash: string;
  /** Admitted-type filter, or `"all"` when unfiltered. */
  resourceType: string;
  /** Opaque pagination cursor, or `"0"` for the first page. */
  cursor: string;
  /** Result limit in effect. */
  limit: number;
};

export function buildSearchCacheKey(parts: SearchCacheKeyParts): string {
  const required: readonly (keyof SearchCacheKeyParts)[] = [
    "tenantId",
    "locale",
    "queryHash"
  ];
  for (const field of required) {
    const value = parts[field];
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(
        `buildSearchCacheKey: "${field}" is required and must be a non-empty string — the search cache key must include tenant/locale/query so one tenant's or locale's results can never serve another (ADR-0040 §5).`
      );
    }
  }
  return [
    "sitesearch",
    encodeURIComponent(parts.tenantId),
    encodeURIComponent(parts.locale),
    encodeURIComponent(parts.queryHash),
    encodeURIComponent(parts.resourceType || "all"),
    encodeURIComponent(parts.cursor || "0"),
    String(Math.trunc(parts.limit))
  ].join(":");
}
