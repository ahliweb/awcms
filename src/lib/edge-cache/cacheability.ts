/**
 * The fail-closed cacheability decision — ADR-0042 §3. **This is the security
 * spine of the edge cache; read this before changing anything in it.**
 *
 * A shared cache in front of a multi-tenant application is, by default, a
 * cross-tenant disclosure machine: cache one authenticated admin response
 * against a URL and every subsequent anonymous visitor to that URL is served
 * another tenant's data. Nothing about Varnish prevents that. This function is
 * what prevents it, and it is the only thing that does.
 *
 * ## The shape of the guarantee
 *
 * `decideCacheability` is **pure** and **allow-list first**. A response is
 * cacheable only if it clears EVERY check below; there is no path that reaches
 * `cacheable: true` by default, by omission, or by an unrecognized input. New
 * routes are uncacheable until someone deliberately declares a surface profile
 * for them, so forgetting about this subsystem is always the safe outcome.
 *
 * The checks, in order, each with the reason it exists:
 *
 * 1. **Mode off** — subsystem disabled, nothing is ever cacheable.
 * 2. **No declared surface** — the allow-list gate. An undeclared path is never
 *    cached even if it looks public.
 * 3. **Method** — only `GET`/`HEAD`. A cached `POST` is a correctness bug.
 * 4. **`Authorization` header** — the request is authenticated; its response is
 *    per-principal by definition.
 * 5. **Identity-bearing cookie** — same reasoning, via cookies. Matched by the
 *    `awcms_` **prefix** rather than an enumerated list, so adding a new
 *    identity cookie tomorrow cannot silently open a hole. (`edge-cache`'s test
 *    suite asserts the real session/tenant cookie names still match this
 *    prefix — that is the coupling to reality.)
 * 6. **Status** — only statuses whose bodies are safe and stable to reuse.
 * 7. **`Set-Cookie` on the response** — caching this hands one visitor's cookie
 *    to everyone who follows. Non-negotiable.
 * 8. **`Cache-Control: private` / `no-store` / `no-cache`** — a route that has
 *    already declared itself uncacheable always wins over a surface profile.
 *    Route-level intent is more specific than a registry pattern.
 * 9. **`Vary: *`** — explicitly means "never reusable".
 *
 * ## What this function deliberately does NOT decide
 *
 * It does not decide the TTL's *magnitude* — that is the auto-activation ramp in
 * `pressure.ts`. Keeping the two apart is intentional: load can only ever change
 * how long something is cached, never whether a private response becomes
 * cacheable. No pressure reading can widen the allow-list.
 */
import type { EdgeCacheConfig } from "./config";
import type { PublicCacheSurface } from "./surface-registry";
import type { SurrogateKeyScope } from "./surrogate-keys";

/**
 * Every cookie this application uses to carry identity or tenant selection is
 * named with this prefix. Matching on the prefix (not a fixed list) is what
 * makes the guard robust against future cookies.
 */
export const IDENTITY_COOKIE_PREFIX = "awcms_";

/** Statuses whose bodies are safe and useful to reuse across visitors. */
const CACHEABLE_STATUSES = new Set([200, 203, 300, 301, 404, 410]);

const CACHEABLE_METHODS = new Set(["GET", "HEAD"]);

/** Why a response was refused. Surfaced in diagnostics and in the `X-Edge-Cache-Skip` debug header. */
export type CacheSkipReason =
  | "mode_off"
  | "surface_not_declared"
  | "method_not_cacheable"
  | "authorization_header"
  | "identity_cookie"
  | "status_not_cacheable"
  | "response_sets_cookie"
  | "response_declares_private"
  | "response_varies_on_everything"
  | "tenant_unresolved"
  | "query_not_allowed";

export type CacheDecision =
  | { cacheable: false; reason: CacheSkipReason }
  | {
      cacheable: true;
      /** Advertised `Surrogate-Control: max-age`, already clamped to the config ceiling. */
      ttlSeconds: number;
      staleWhileRevalidateSeconds: number;
      surrogateKeys: readonly SurrogateKeyScope[];
    };

export type CacheabilityInput = {
  config: EdgeCacheConfig;
  method: string;
  requestHeaders: Headers;
  responseStatus: number;
  responseHeaders: Headers;
  /** The matched public surface, or `null` when the path is not declared cacheable. */
  surface: PublicCacheSurface | null;
  /** Resolved tenant for the request; `null` when tenant resolution failed. */
  tenantId: string | null;
  /** The request's query parameters, checked against the surface's allow-list. */
  searchParams: URLSearchParams;
  /**
   * Effective TTL for this surface after the auto-activation ramp. Supplied by
   * the caller so this function stays pure and clock-free.
   */
  effectiveTtlSeconds: number;
};

/** True when any request cookie is identity-bearing. */
export function hasIdentityCookie(cookieHeader: string | null): boolean {
  if (!cookieHeader) {
    return false;
  }

  return cookieHeader
    .split(";")
    .map((pair) => pair.trim().split("=", 1)[0]?.trim() ?? "")
    .some((name) => name.startsWith(IDENTITY_COOKIE_PREFIX));
}

function declaresUncacheable(cacheControl: string | null): boolean {
  if (!cacheControl) {
    return false;
  }

  const normalized = cacheControl.toLowerCase();

  return (
    normalized.includes("private") ||
    normalized.includes("no-store") ||
    normalized.includes("no-cache")
  );
}

export function decideCacheability(input: CacheabilityInput): CacheDecision {
  if (input.config.mode === "off") {
    return { cacheable: false, reason: "mode_off" };
  }

  if (!input.surface) {
    return { cacheable: false, reason: "surface_not_declared" };
  }

  if (!CACHEABLE_METHODS.has(input.method.toUpperCase())) {
    return { cacheable: false, reason: "method_not_cacheable" };
  }

  if (input.requestHeaders.has("authorization")) {
    return { cacheable: false, reason: "authorization_header" };
  }

  if (hasIdentityCookie(input.requestHeaders.get("cookie"))) {
    return { cacheable: false, reason: "identity_cookie" };
  }

  if (!CACHEABLE_STATUSES.has(input.responseStatus)) {
    return { cacheable: false, reason: "status_not_cacheable" };
  }

  if (input.responseHeaders.has("set-cookie")) {
    return { cacheable: false, reason: "response_sets_cookie" };
  }

  if (declaresUncacheable(input.responseHeaders.get("cache-control"))) {
    return { cacheable: false, reason: "response_declares_private" };
  }

  if (input.responseHeaders.get("vary")?.trim() === "*") {
    return { cacheable: false, reason: "response_varies_on_everything" };
  }

  // An object with no tenant key cannot be reached by any purge, so it would go
  // stale permanently. Refusing to cache it is strictly better than caching
  // something nobody can invalidate.
  if (input.surface.requiresTenant && !input.tenantId) {
    return { cacheable: false, reason: "tenant_unresolved" };
  }

  // The edge keys on the full URL, so an unbounded query string is an unbounded
  // number of cache entries — one cheap request each, and the hot objects get
  // evicted. Only declared parameters may participate.
  for (const name of input.searchParams.keys()) {
    if (!input.surface.allowedQueryParams.includes(name)) {
      return { cacheable: false, reason: "query_not_allowed" };
    }
  }

  const ttlSeconds = Math.max(
    0,
    Math.min(input.effectiveTtlSeconds, input.config.maxTtlSeconds)
  );

  return {
    cacheable: true,
    ttlSeconds,
    staleWhileRevalidateSeconds: input.config.staleWhileRevalidateSeconds,
    surrogateKeys: buildScopesForSurface(input.surface, input.tenantId)
  };
}

/**
 * Tag every cacheable response with a tenant key and a surface key, so
 * invalidation can be as coarse as "everything for this tenant" or as narrow as
 * "this one surface". Resource-level keys are added by the routes that know
 * their own resource ids; the registry cannot know them.
 *
 * When the tenant could not be resolved the response gets NO keys, which makes
 * it un-invalidatable — so `surfaceRequiresTenant` surfaces are refused a TTL
 * upstream rather than cached untagged. A cached object nobody can purge is a
 * permanent stale-content bug.
 */
function buildScopesForSurface(
  surface: PublicCacheSurface,
  tenantId: string | null
): SurrogateKeyScope[] {
  if (!tenantId) {
    return [];
  }

  return [
    { kind: "tenant", tenantId },
    { kind: "surface", tenantId, surface: surface.key },
    ...(surface.moduleKey
      ? ([
          { kind: "module", tenantId, moduleKey: surface.moduleKey }
        ] satisfies SurrogateKeyScope[])
      : [])
  ];
}
