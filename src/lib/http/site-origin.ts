/**
 * site-origin.ts — the ONE place that decides the scheme and host of an
 * absolute, outward-facing URL.
 *
 * ## The defect this exists to end
 *
 * The Node adapter derives `url.origin` from its OWN listener. This deployment
 * terminates TLS at Traefik and the app listens on plain HTTP, so `url.origin`
 * is `http://…` on a site every visitor reaches over `https://…`. Nothing in
 * this repo read `X-Forwarded-Proto`, so nothing corrected it, and the wrong
 * scheme LEAKED into output. Verified in production, not inferred:
 *
 *     curl https://awcms.ahlikoding.com/blog/ahliweb/feed.xml
 *     → <link>http://awcms.ahlikoding.com/…</link>   for every entry
 *
 * It also produced the canonical/`og:url` pair that looked like evidence of two
 * independent URL builders and was not: both come from ONE variable, both leave
 * the origin as `http`, and Cloudflare's Automatic HTTPS Rewrites patches
 * `href`/`src` attributes on the way through — so the `href` canonical arrives
 * correct and the `content`-attribute `og:url` arrives wrong. One producer,
 * wrong everywhere, masked on exactly one tag by an intermediary we do not
 * control. Every output that does NOT pass through that rewrite — feeds,
 * sitemaps, JSON-LD, share links, `Location` headers, email bodies — was simply
 * wrong.
 *
 * It is the same root cause as the `checkOrigin` class that cost v9.1.1: Astro
 * compares `request.headers.get("origin")` against `url.origin`, and behind TLS
 * termination those can never match.
 *
 * ## Where the answer comes from, and why in this order
 *
 * 1. **`X-Forwarded-Proto` / `X-Forwarded-Host`, but only when
 *    `PUBLIC_TRUST_PROXY=true`.** This reuses the flag and the trust contract
 *    that `public-host-tenant-resolver.ts` already established, rather than
 *    inventing a fourth proxy-trust switch next to `TRUSTED_PROXY_ENABLED`,
 *    `PUBLIC_TRUST_PROXY` and the visitor-analytics one. An untrusted client can
 *    set either header to anything, so neither is read without the flag.
 *
 * 2. **`APP_URL`'s scheme.** `APP_URL` is REQUIRED (`scripts/validate-env.ts`)
 *    and is the operator's own statement of how the site is reached. It is the
 *    load-bearing fallback: production has `APP_URL=https://awcms.ahlikoding.com`
 *    and does NOT set `PUBLIC_TRUST_PROXY`, so this branch — not the header one
 *    — is what actually corrects the live defect. A fix that only worked with
 *    proxy trust enabled would have shipped and changed nothing.
 *
 * 3. **The request's own scheme.** Dev, tests, and any deployment that declares
 *    nothing. This is the current (wrong-in-production) behaviour, kept as the
 *    last resort so a missing `APP_URL` degrades to today's output rather than
 *    to a hard failure in a request path.
 *
 * The HOST is deliberately NOT taken from `APP_URL`. Multi-host deployments
 * serve several tenant domains from one app, and the host the visitor used is
 * the host their canonical must name. Only the SCHEME is uniform across hosts,
 * because they all sit behind the same TLS termination.
 */
import { log } from "../logging/logger";

/** `https` unless a deployment genuinely serves plain HTTP. */
export type SiteScheme = "http" | "https";

/**
 * What `APP_URL` falls back to when unset. Matches `scripts/lib/app-url.ts` and
 * `.env.example`.
 */
export const DEFAULT_APP_BASE_URL = "http://localhost:4321";

/**
 * The operator-declared base URL, for links built OUTSIDE a request.
 *
 * OIDC `redirect_uri`, password-reset links, invitation links and
 * registration-approval links are all built from `APP_URL`, and each of the four
 * call sites carried its own `?? "http://localhost:4321"`. Four copies of a
 * default is four places for it to drift, and these are the most expensive
 * surfaces to get wrong: a wrong `redirect_uri` fails login with
 * `redirect_uri_mismatch`, and a wrong reset link is emailed and clicked later,
 * when nobody is watching a terminal.
 *
 * Deliberately NOT request-derived: an email link must not depend on which host
 * the request that triggered it arrived on.
 */
export function resolveDeclaredBaseUrl(
  env: NodeJS.ProcessEnv = process.env
): string {
  const raw = env.APP_URL?.trim();
  return raw && raw.length > 0 ? raw : DEFAULT_APP_BASE_URL;
}

/**
 * Read `APP_URL`'s scheme, or `null` when it is unset/unparseable.
 *
 * Never throws: this runs on the request path, and an operator typo in an env
 * var must not turn every public page into a 500. It degrades to the next
 * source instead.
 */
export function declaredSiteScheme(
  env: NodeJS.ProcessEnv = process.env
): SiteScheme | null {
  const raw = env.APP_URL?.trim();
  if (!raw) return null;

  try {
    const protocol = new URL(raw).protocol;
    if (protocol === "https:") return "https";
    if (protocol === "http:") return "http";
    return null;
  } catch {
    return null;
  }
}

/** Is this deployment allowed to believe `X-Forwarded-*`? */
function proxyIsTrusted(env: NodeJS.ProcessEnv): boolean {
  return env.PUBLIC_TRUST_PROXY === "true";
}

/**
 * `X-Forwarded-Proto`, when trusted and unambiguous.
 *
 * A multi-value header means a proxy chain that appends rather than overwrites
 * — the same anomaly `extractHostHeader` refuses to guess at. This refuses too:
 * picking one value out of several is choosing which hop to believe, and a
 * wrong guess here silently rewrites every absolute URL the site emits.
 */
function forwardedScheme(request: Request): SiteScheme | null {
  const raw = request.headers.get("x-forwarded-proto");
  if (!raw || raw.trim().length === 0) return null;

  const parts = raw
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);

  if (parts.length > 1) {
    log("warning", "site_origin.x_forwarded_proto_multi_value", {
      valueCount: parts.length,
      firstValuePreview: parts[0]?.slice(0, 20)
    });
    return null;
  }

  const only = parts[0];
  return only === "https" || only === "http" ? only : null;
}

/** `X-Forwarded-Host`, when trusted and unambiguous. Mirrors `extractHostHeader`. */
function forwardedHost(request: Request): string | null {
  const raw = request.headers.get("x-forwarded-host");
  if (!raw || raw.trim().length === 0) return null;

  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length !== 1) {
    if (parts.length > 1) {
      log("warning", "site_origin.x_forwarded_host_multi_value", {
        valueCount: parts.length,
        firstValuePreview: parts[0]?.slice(0, 100)
      });
    }
    return null;
  }

  return parts[0] ?? null;
}

/**
 * The scheme every absolute public URL must use.
 *
 * @param request - omit for contexts with no request (jobs, emails, CLI).
 */
export function resolveSiteScheme(
  request?: Request,
  env: NodeJS.ProcessEnv = process.env
): SiteScheme {
  if (request && proxyIsTrusted(env)) {
    const forwarded = forwardedScheme(request);
    if (forwarded) return forwarded;
  }

  const declared = declaredSiteScheme(env);
  if (declared) return declared;

  return "http";
}

/**
 * The origin (`scheme://host`) for absolute URLs derived from THIS request.
 *
 * Replaces every bare `url.origin` that reached output. Same host as before —
 * the visitor's — with the scheme the site is actually served over.
 */
export function resolveRequestOrigin(
  url: URL,
  request: Request,
  env: NodeJS.ProcessEnv = process.env
): string {
  const trusted = proxyIsTrusted(env);

  const scheme = trusted
    ? (forwardedScheme(request) ??
      declaredSiteScheme(env) ??
      stripColon(url.protocol))
    : (declaredSiteScheme(env) ?? stripColon(url.protocol));

  const host = (trusted ? forwardedHost(request) : null) ?? url.host;

  return `${scheme}://${host}`;
}

/**
 * The origin for a KNOWN host — the tenant's primary hostname read from
 * `awcms_tenant_domains`, rather than whatever host this request arrived on.
 *
 * `seo_distribution` used to hardcode `https://${primaryHost}`. That literal is
 * right in production and wrong everywhere else: a LAN/offline deployment
 * serving plain HTTP gets `https://` sitemaps and feeds pointing at a scheme it
 * does not answer on. Routing it through here keeps the correct production
 * behaviour while making the other profiles correct too.
 */
export function resolveHostOrigin(
  host: string,
  request?: Request,
  env: NodeJS.ProcessEnv = process.env
): string {
  return `${resolveSiteScheme(request, env)}://${host}`;
}

/** `"https:"` -> `"https"`, falling back to `http` for anything else. */
function stripColon(protocol: string): SiteScheme {
  return protocol === "https:" ? "https" : "http";
}
