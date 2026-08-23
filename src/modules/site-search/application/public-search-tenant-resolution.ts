/**
 * Public tenant resolution + module-enablement gate for the public search
 * surfaces (`/search` page, `/api/v1/site-search/query`, `/suggest`) — ADR-0040
 * §5, ported from awcms-micro Issue #270. Mirrors `seo_distribution`'s
 * `withSeoPublicTenant` exactly: resolve the tenant from the request host
 * (`resolvePublicTenantFromRequest`, host trusted only behind a trusted proxy),
 * then confirm `site_search` is enabled for that tenant before running the
 * handler.
 *
 * Every non-resolving case collapses to the same generic `null` (mapped to a 404
 * / neutral empty payload by the caller — never leak WHY), and the unresolved
 * path is cost-normalized (`padUnresolvedSearchTenantLatency`) so a prober cannot
 * learn "this host maps to a real active tenant" from response latency.
 *
 * NO cross-content-module import: this file consumes only `module_management`'s
 * tenant lifecycle (the module registry authority), the neutral tenant resolver,
 * and `site_search`'s own settings table.
 *
 * ## Two entry points since ADR-0107
 *
 * `withSiteSearchTenant` is the host-resolved one above, used by the `/search`
 * HTML page. `withPublicSearchTenant` (below) is what the two JSON endpoints
 * use: same gate, same neutral outcomes, but it classifies the request's
 * `Origin` first and resolves a CROSS-ORIGIN request's tenant from that origin
 * instead of from the host — because the host of a request from a statically
 * built site is this CMS, and the host chain's default-tenant fallback would
 * hand that site somebody else's articles. See `domain/search-cors.ts`.
 */
import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import {
  isCrossOriginRequest,
  parseRequestOrigin
} from "../../../lib/security/request-origin";
import {
  resolvePublicTenantByHost,
  resolvePublicTenantFromRequest,
  type PublicHostResolverConfig,
  type PublicTenantResolution
} from "../../../lib/tenant/public-host-tenant-resolver";
import {
  publicSearchCorsHeaders,
  type PublicSearchOriginDecision
} from "../domain/search-cors";
import { fetchTenantModuleEntry } from "../../module-management/application/tenant-module-lifecycle";
import type { SiteSearchSettings } from "../domain/search-settings";
import { SITE_SEARCH_MODULE_KEY } from "../domain/site-search-permissions";
import { fetchSiteSearchSettings } from "./search-settings-directory";

export type SiteSearchTenantHandler<T> = (
  tx: Bun.TransactionSQL,
  tenant: PublicTenantResolution,
  settings: SiteSearchSettings
) => Promise<T>;

/**
 * The all-zero tenant id — the fail-closed sentinel `app.current_tenant_id`
 * defaults to (migration 013). No real tenant ever has it, so a query scoped to
 * it matches zero rows; it exists purely as a round-trip-shape placeholder for
 * the timing pad below.
 */
const TIMING_PAD_TENANT_ID = "00000000-0000-0000-0000-000000000000";

/** Build the host-resolver config from the documented env vars (the resolver itself never reads `process.env`, for testability). */
export function buildPublicHostResolverConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): PublicHostResolverConfig {
  return {
    mode: env.PUBLIC_TENANT_RESOLUTION_MODE,
    trustProxy: env.PUBLIC_TRUST_PROXY === "true"
  };
}

async function checkSiteSearchGate(
  tx: Bun.TransactionSQL,
  tenantId: string
): Promise<{ enabled: boolean; settings: SiteSearchSettings }> {
  const entry = await fetchTenantModuleEntry(
    tx,
    tenantId,
    SITE_SEARCH_MODULE_KEY
  );
  const settings = await fetchSiteSearchSettings(tx, tenantId);
  return {
    // Fail-closed: a missing entry is treated as disabled. Also honor the
    // tenant's own `enabled` search config switch.
    enabled: (entry?.tenantEnabled ?? false) && settings.enabled,
    settings
  };
}

/**
 * Pad the "tenant did not resolve" path with the same round-trip shape the
 * "resolved but disabled" path pays. Exported so a test can prove parity
 * directly.
 */
export async function padUnresolvedSearchTenantLatency(
  sql: Bun.SQL
): Promise<void> {
  await withTenantOrThrow(sql, TIMING_PAD_TENANT_ID, async (tx) => {
    await checkSiteSearchGate(tx, TIMING_PAD_TENANT_ID);
  });
}

/**
 * Resolve the public tenant for a search request and, only if resolved + enabled,
 * open a tenant-scoped transaction and run `handler` with the tenant's search
 * settings. Returns `null` for every non-resolving/disabled case.
 */
export async function withSiteSearchTenant<T>(
  sql: Bun.SQL,
  request: Request,
  handler: SiteSearchTenantHandler<T>,
  env: NodeJS.ProcessEnv = process.env
): Promise<T | null> {
  const config = buildPublicHostResolverConfigFromEnv(env);
  const tenant = await resolvePublicTenantFromRequest(sql, request, config);

  if (!tenant) {
    // Awaited and discarded — pays the same cost as the gate branch below so the
    // two outcomes are latency-indistinguishable.
    await padUnresolvedSearchTenantLatency(sql);
    return null;
  }

  return runWithSiteSearchTenant(sql, tenant, handler);
}

/** The half of `withSiteSearchTenant` that runs once a tenant is known, shared with the cross-origin path so both pay the same gate in the same order. */
async function runWithSiteSearchTenant<T>(
  sql: Bun.SQL,
  tenant: PublicTenantResolution,
  handler: SiteSearchTenantHandler<T>
): Promise<T | null> {
  return withTenantOrThrow(sql, tenant.tenantId, async (tx) => {
    const { enabled, settings } = await checkSiteSearchGate(
      tx,
      tenant.tenantId
    );
    if (!enabled) return null;
    return handler(tx, tenant, settings);
  });
}

/**
 * Classify a public search request's `Origin` and, when it is cross-origin,
 * resolve the tenant it names — ADR-0107, reasoning in `domain/search-cors.ts`.
 *
 * The lookup is `resolvePublicTenantByHost` and nothing else: no env default,
 * no setup-state default. A cross-origin caller that names a hostname this
 * deployment does not serve gets `refused`, never somebody else's tenant.
 */
export async function resolvePublicSearchOrigin(
  sql: Bun.SQL,
  request: Request
): Promise<{
  decision: PublicSearchOriginDecision;
  tenant: PublicTenantResolution | null;
}> {
  const parsed = parseRequestOrigin(request.headers.get("origin"));

  if (!parsed || !isCrossOriginRequest(parsed, request.url)) {
    return { decision: { kind: "same_origin" }, tenant: null };
  }

  const tenant = await resolvePublicTenantByHost(sql, parsed.hostname);

  return tenant
    ? { decision: { kind: "granted", origin: parsed.origin }, tenant }
    : { decision: { kind: "refused" }, tenant: null };
}

export type PublicSearchOutcome<T> = {
  /** `null` for every non-resolving/disabled/refused case — the caller answers with its neutral empty payload. */
  result: T | null;
  /** CORS headers to attach to that answer, granted or not. */
  corsHeaders: Record<string, string>;
  /** Which branch ran. For METRICS only — the response must not distinguish these. */
  origin: PublicSearchOriginDecision["kind"];
};

/**
 * The public-search entry point for the two JSON endpoints: classify the
 * origin, resolve the tenant on whichever path that implies, and hand back both
 * the handler's answer and the CORS headers it must be sent with (ADR-0107).
 *
 * `/search` (the HTML page) keeps calling `withSiteSearchTenant` directly: a
 * top-level navigation carries no `Origin`, so the classification would be
 * `same_origin` for every request and the extra return value would be noise.
 *
 * A refused origin pays `padUnresolvedSearchTenantLatency`, exactly like an
 * unresolved host. Without it, "this origin is a tenant of this deployment"
 * would be readable from response TIME even though it is not readable from the
 * body — and the body being neutral is the whole design.
 */
export async function withPublicSearchTenant<T>(
  sql: Bun.SQL,
  request: Request,
  handler: SiteSearchTenantHandler<T>,
  env: NodeJS.ProcessEnv = process.env
): Promise<PublicSearchOutcome<T>> {
  const { decision, tenant: originTenant } = await resolvePublicSearchOrigin(
    sql,
    request
  );
  const corsHeaders = publicSearchCorsHeaders(decision);

  if (decision.kind === "refused") {
    await padUnresolvedSearchTenantLatency(sql);
    return { result: null, corsHeaders, origin: decision.kind };
  }

  if (decision.kind === "granted" && originTenant) {
    return {
      result: await runWithSiteSearchTenant(sql, originTenant, handler),
      corsHeaders,
      origin: decision.kind
    };
  }

  return {
    result: await withSiteSearchTenant(sql, request, handler, env),
    corsHeaders,
    origin: decision.kind
  };
}
