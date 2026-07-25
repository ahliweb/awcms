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
 */
import { withTenant } from "../../../lib/database/tenant-context";
import {
  resolvePublicTenantFromRequest,
  type PublicHostResolverConfig,
  type PublicTenantResolution
} from "../../../lib/tenant/public-host-tenant-resolver";
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
  await withTenant(sql, TIMING_PAD_TENANT_ID, async (tx) => {
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

  return withTenant(sql, tenant.tenantId, async (tx) => {
    const { enabled, settings } = await checkSiteSearchGate(
      tx,
      tenant.tenantId
    );
    if (!enabled) return null;
    return handler(tx, tenant, settings);
  });
}
