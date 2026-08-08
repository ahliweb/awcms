/**
 * Public redirect resolution (ADR-0039; adapted from awcms-micro ADR-0028 §8) — the
 * single service the middleware calls, BEFORE public content route resolution, to
 * decide whether an incoming request is redirected. Two ordered strategies:
 *
 *  1. **Retired `/news/**` → `/blog/{tenantCode}/**`** (ADR-0071 §4, NOT
 *     policy-gated). Resolves the tenant by the server-derived HOST and
 *     301-redirects the retired family to this repo's permanent vocabulary. This
 *     is the INVERSE of the strategy that stood here through ADR-0039/0059,
 *     which pointed `/blog/{tenantCode}` at `/news`: ADR-0071 makes `/news/**`
 *     `awcms-astro`'s vocabulary, so the old direction now targets a family this
 *     repo does not serve. Skipped for a tenant whose `legacyTenantRouteEnabled`
 *     is `false` — it has no `/blog/**` either, so redirecting would hand a
 *     reader a 301 to a guaranteed 404.
 *  2. **Tenant-authored exact-path rules**: resolves the tenant by the server-
 *     derived HOST, then walks a bounded, non-recursive chain of exact-path rules.
 *     This is the FIRST-CUT tenant-resolution strategy for awcms (host-based-only,
 *     ADR-0039 §Tenant resolution): host rules resolve for tenants with a verified
 *     custom domain. A path-tenant strategy (deriving the tenant from a
 *     `/blog/{tenantCode}` segment for exact-path rules) is a documented DEFERRED
 *     follow-up, not built here.
 *
 * ## Safety invariants
 *  - The caller has ALREADY excluded admin/API/auth/static/system paths
 *    (`isRedirectEligiblePath`) — this service is only ever asked about content paths.
 *  - The host + tenant are server-derived (`resolvePublicTenantFromRequest`),
 *    never a trusted raw `Host` for URL generation.
 *  - EVERY emitted target is re-validated at resolve time through the FROZEN
 *    `assertSafeRedirectTarget` guard against the tenant's CURRENT verified hosts —
 *    so a `verified_external` target to a domain the tenant has since removed fails
 *    closed (no redirect), not open.
 *  - Loops / over-long chains fail CLOSED (no redirect) and are surfaced for
 *    operator remediation, never bounced.
 *  - The whole thing is wrapped so a failure degrades to "no redirect" (fail open
 *    to normal content resolution) — a redirect subsystem error must never take
 *    down public pages.
 *
 * awcms adaptation (ADR-0039): there is NO i18n/locale seam in this base, so the
 * middleware passes `locale = null` all the way through — locale-scoped rules simply
 * never match a locale, only the all-locales (`locale_scope IS NULL`) rules do.
 */
import { assertSafeRedirectTarget } from "../domain/redirect-target-classification";
import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import { log } from "../../../lib/logging/logger";
import {
  normalizePublicHost,
  resolvePublicTenantFromRequest
} from "../../../lib/tenant/public-host-tenant-resolver";
import { fetchTenantModuleEntry } from "../../module-management/application/tenant-module-lifecycle";
import { fetchEffectivePublicRouteSettings } from "../../blog-content/application/public-route-settings";
import {
  buildLegacyBlogPath,
  parseRetiredNewsPath
} from "../domain/retired-news-redirect";
import {
  resolveRedirectChain,
  type RedirectChainOutcome
} from "../domain/redirect-chain";
import { applyRedirectQueryPolicy } from "../domain/redirect-query-policy";
import { normalizeRedirectPath } from "../domain/redirect-path";
import type { RedirectStatusCode } from "../domain/redirect-rule";
import { SEO_MODULE_KEY } from "../domain/seo-permissions";
import { buildPublicHostResolverConfigFromEnv } from "./public-seo-tenant-resolution";
import {
  findActiveRedirectByPath,
  incrementRedirectHit
} from "./redirect-directory";
import { resolveTenantAllowedHosts } from "./tenant-allowed-hosts";
import { resolveTenantPrimaryHost } from "./resolve-canonical-host";

/** Context the middleware needs to record a privacy-minimized 404 observation later. */
export type NotFoundCaptureContext = {
  tenantId: string;
  normalizedPath: string;
  locale: string | null;
  domainHost: string | null;
};

export type RedirectResolution =
  | { kind: "redirect"; status: RedirectStatusCode; location: string }
  | { kind: "passthrough"; capture: NotFoundCaptureContext | null }
  | { kind: "skip" };

export type ResolveRedirectOptions = {
  pathname: string;
  /** The incoming request's raw query string including leading `?` (or ""). */
  search: string;
  locale: string | null;
  now?: Date;
};

async function isSeoDistributionEnabled(
  tx: Bun.SQL,
  tenantId: string
): Promise<boolean> {
  const entry = await fetchTenantModuleEntry(tx, tenantId, SEO_MODULE_KEY);
  return entry?.tenantEnabled ?? false;
}

/**
 * Strategy 1 — the retired `/news/**` family redirects to `/blog/{tenantCode}/**`
 * (ADR-0071 §4). Returns a redirect resolution or `null` (not a retired path /
 * no tenant / that tenant has no `/blog/**` either — fall through to normal
 * serving, which for `/news/**` is now a 404).
 *
 * NOT gated on `seo_distribution` being enabled, and that is deliberate. The
 * strategy this replaces was OPTIONAL governance a tenant switched on; this one
 * is a URL migration the tenant did not choose and cannot undo — the routes are
 * gone for everyone. Gating it on a module a tenant can disable would mean the
 * tenants who disabled it are exactly the ones whose published URLs break.
 *
 * `_env` keeps its underscore for the reason the old strategy's `_request` did:
 * both strategies are called through the same `(sql, request, options, env)`
 * shape by `resolvePublicRedirect`, and a trimmed signature would force the
 * dispatcher to remember which strategy takes what. Unlike the old one, this
 * strategy DOES use `request` — it resolves its tenant from the host, not from
 * a path segment, because the retired family never carried a tenant code.
 */
async function resolveRetiredNewsRedirect(
  sql: Bun.SQL,
  request: Request,
  options: ResolveRedirectOptions,
  _env: NodeJS.ProcessEnv
): Promise<RedirectResolution | null> {
  const rest = parseRetiredNewsPath(options.pathname);
  if (rest === null) return null;

  const config = buildPublicHostResolverConfigFromEnv(process.env);
  const tenant = await resolvePublicTenantFromRequest(sql, request, config);
  if (!tenant) return null;

  return withTenantOrThrow(sql, tenant.tenantId, async (tx) => {
    const routeSettings = await fetchEffectivePublicRouteSettings(
      tx,
      tenant.tenantId
    );

    // The tenant turned its public content surface off entirely. It has no
    // `/blog/**` to send anyone to, so a 301 here would be a redirect to a
    // certain 404 — the failure ADR-0059 §C existed to prevent and ADR-0071 §3
    // restates. Let the 404 it already chose stand.
    if (!routeSettings.legacyTenantRouteEnabled) return null;

    const primaryHost = await resolveTenantPrimaryHost(tx, tenant.tenantId);
    if (!primaryHost) return null; // no canonical host — cannot safely redirect

    const allowedHosts = await resolveTenantAllowedHosts(tx, tenant.tenantId);
    const target = `https://${primaryHost}${buildLegacyBlogPath(tenant.tenantCode, rest)}${options.search}`;

    try {
      assertSafeRedirectTarget(target, allowedHosts);
    } catch {
      return null; // fail closed — never emit an unsafe redirect
    }

    return {
      kind: "redirect",
      status: 301 as RedirectStatusCode,
      location: target
    };
  });
}

/**
 * Strategy 2 — tenant-authored exact-path rules resolved by server-derived host.
 * Returns `redirect`, or `passthrough` with a 404-capture context when the tenant
 * resolved but no rule fired (so the middleware can observe a subsequent 404).
 */
async function resolveHostBasedRedirect(
  sql: Bun.SQL,
  request: Request,
  options: ResolveRedirectOptions,
  env: NodeJS.ProcessEnv
): Promise<RedirectResolution> {
  const config = buildPublicHostResolverConfigFromEnv(env);
  const tenant = await resolvePublicTenantFromRequest(sql, request, config);
  if (!tenant) return { kind: "skip" };

  const normalized = normalizeRedirectPath(options.pathname);
  if (!normalized.ok) return { kind: "skip" };
  const normalizedPath = normalized.path;

  // Server-validated served host: the request Host, but only trusted for scope /
  // 404 attribution if it is actually one of THIS tenant's verified domains.
  const rawHost = request.headers.get("host");
  const requestHost = rawHost ? normalizePublicHost(rawHost) : null;
  const now = options.now ?? new Date();

  return withTenantOrThrow(sql, tenant.tenantId, async (tx) => {
    if (!(await isSeoDistributionEnabled(tx, tenant.tenantId))) {
      return { kind: "skip" };
    }

    const allowedHosts = await resolveTenantAllowedHosts(tx, tenant.tenantId);
    const allowedLower = new Set(allowedHosts.map((h) => h.toLowerCase()));
    const scopeHost =
      requestHost && allowedLower.has(requestHost) ? requestHost : null;
    const primaryHost = await resolveTenantPrimaryHost(tx, tenant.tenantId);
    const domainHost = scopeHost ?? primaryHost;

    const capture: NotFoundCaptureContext = {
      tenantId: tenant.tenantId,
      normalizedPath,
      locale: options.locale,
      domainHost
    };

    const outcome: RedirectChainOutcome = await resolveRedirectChain(
      normalizedPath,
      (pathKey) =>
        findActiveRedirectByPath(tx, tenant.tenantId, pathKey, {
          locale: options.locale,
          host: scopeHost,
          now
        }),
      // Fold a `verified_external` hop to one of THIS tenant's own verified hosts
      // back into the chain so a same-host redirect loop is detected and fails
      // closed (passthrough), instead of being emitted as a terminal 301.
      { allowedHosts }
    );

    if (outcome.outcome === "loop" || outcome.outcome === "chain_too_long") {
      // Fail closed + surface for operator remediation. Do NOT bounce the client.
      log("warning", "seo_distribution.redirect.chain_rejected", {
        moduleKey: SEO_MODULE_KEY,
        tenantId: tenant.tenantId,
        outcome: outcome.outcome,
        hops: outcome.hops.length
      });
      return { kind: "passthrough", capture };
    }

    if (outcome.outcome === "none") {
      return { kind: "passthrough", capture };
    }

    // outcome === "redirect": re-validate the FINAL target against the tenant's
    // CURRENT verified hosts through the frozen guard (defense in depth — hosts may
    // have changed since the rule was written).
    const location = applyRedirectQueryPolicy({
      target: outcome.finalTarget,
      targetType: outcome.finalTargetType,
      preserveQuery: outcome.hops[outcome.hops.length - 1]!.preserveQuery,
      incomingSearch: options.search
    });

    try {
      assertSafeRedirectTarget(location, allowedHosts);
    } catch {
      log("warning", "seo_distribution.redirect.target_unsafe_at_resolve", {
        moduleKey: SEO_MODULE_KEY,
        tenantId: tenant.tenantId
      });
      return { kind: "passthrough", capture };
    }

    // Best-effort hit projection on the entry rule — never breaks the response.
    try {
      await incrementRedirectHit(tx, tenant.tenantId, outcome.hops[0]!.id, now);
    } catch {
      // ignore — a projection failure must not fail the redirect
    }

    return { kind: "redirect", status: outcome.statusCode, location };
  });
}

/**
 * Resolve a public redirect for an eligible request. Tries the retired-`/news`
 * redirect first, then tenant-authored host-based rules. Never throws:
 * any error degrades to `{ kind: "skip" }` so a redirect-subsystem fault can never
 * break public content serving.
 */
export async function resolvePublicRedirect(
  sql: Bun.SQL,
  request: Request,
  options: ResolveRedirectOptions,
  env: NodeJS.ProcessEnv = process.env
): Promise<RedirectResolution> {
  try {
    const retired = await resolveRetiredNewsRedirect(
      sql,
      request,
      options,
      env
    );
    if (retired && retired.kind === "redirect") return retired;

    return await resolveHostBasedRedirect(sql, request, options, env);
  } catch (error) {
    log("error", "seo_distribution.redirect.resolution_failed", {
      moduleKey: SEO_MODULE_KEY,
      error: error instanceof Error ? error.message : String(error)
    });
    return { kind: "skip" };
  }
}
