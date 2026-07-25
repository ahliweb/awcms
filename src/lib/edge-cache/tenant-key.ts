/**
 * Resolve the tenant a cacheable public response belongs to — ADR-0042 §8.
 *
 * The surrogate key is what makes a cached object invalidatable, and every key
 * is rooted at a tenant id. So a response we cannot attribute to a tenant is a
 * response we must not cache (`decideCacheability` enforces that).
 *
 * ## Two sources, in priority order, and why there is no third
 *
 * 1. **Published by the route** (`locals.edgeCacheTenantId`). Preferred, and the
 *    only source for host-resolved surfaces. Routes like the SEO discovery
 *    pipeline already resolve the tenant with the full ADR-0010 host
 *    configuration — re-deriving that in middleware would mean a second query
 *    AND a second, subtly different implementation of the rule. Publishing is
 *    free and exact.
 * 2. **Path-scoped `{tenantCode}`** (ADR-0009 `/blog/{code}/…`,
 *    `/theming/{code}/tokens.css`). Unambiguous from the URL, so middleware can
 *    resolve it without the route's cooperation. Costs one indexed lookup, and
 *    only on a cache MISS — a HIT never reaches the origin at all.
 *
 * There is deliberately no "guess from the Host header" fallback. Host→tenant
 * mapping is configuration-dependent (ADR-0010 has several modes, including one
 * where host routing is off entirely), and a wrong guess here does not fail
 * loudly — it tags one tenant's content with another tenant's key, which is both
 * a disclosure on purge and a purge that silently misses. Unresolvable stays
 * unresolvable, and unresolvable means uncached.
 *
 * Every failure path returns `null` rather than throwing: the edge cache is an
 * optimization, and no fault in it may ever turn a working public page into a
 * 500.
 */
import { getDatabaseClient } from "../database/client";
import { log } from "../logging/logger";
import { safeErrorDetail } from "../logging/error-sanitizer";
import { resolvePublicTenantByCode } from "../tenant/public-tenant-resolver";

/**
 * Paths whose SECOND segment is a tenant code. Anchored and `[^/]+` bounded so
 * a deeper path cannot be mistaken for a two-segment one.
 */
const TENANT_CODE_PATH = /^\/(?:blog|theming)\/([^/]+)(?:\/|$)/;

/**
 * A tenant code is an opaque short identifier. Validate before it reaches a
 * query so a hostile path segment is rejected here rather than relied upon to be
 * neutralized downstream — and so it is safe as a surrogate-key segment.
 */
const TENANT_CODE_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export function extractTenantCodeFromPath(pathname: string): string | null {
  const match = TENANT_CODE_PATH.exec(pathname);
  const code = match?.[1];

  if (!code || !TENANT_CODE_PATTERN.test(code)) {
    return null;
  }

  return code;
}

/**
 * Resolve the tenant id to tag a response with, or `null` when it cannot be
 * established. `publishedTenantId` is `locals.edgeCacheTenantId`.
 */
export async function resolveEdgeCacheTenantId(
  pathname: string,
  publishedTenantId: string | null | undefined
): Promise<string | null> {
  if (publishedTenantId) {
    return publishedTenantId;
  }

  const tenantCode = extractTenantCodeFromPath(pathname);

  if (!tenantCode) {
    return null;
  }

  try {
    const resolution = await resolvePublicTenantByCode(
      getDatabaseClient(),
      tenantCode
    );

    return resolution?.tenantId ?? null;
  } catch (error) {
    log(
      "warning",
      "Edge-cache tenant resolution failed; the response will not be cached.",
      {
        moduleKey: "edge_cache",
        event: "edge_cache.tenant_resolution_failed",
        detail: safeErrorDetail(error)
      }
    );

    return null;
  }
}
