/**
 * Tenant resolution + module-enablement gate for the public discovery /
 * syndication routes (ADR-0038 §5/§8) — robots.txt, sitemap
 * index/child, and RSS/Atom/JSON feeds. The SEO counterpart of blog_content's
 * `withNewsTenant`: every one of those routes needs the identical gate before it
 * may aggregate a single resource fact.
 *
 * 1. Resolve the tenant from the request via `resolvePublicTenantFromRequest`
 *    (host trusted only behind a trusted proxy, `PUBLIC_TRUST_PROXY`) — the
 *    host-header-poisoning defense at the door (ADR-0038 §5): the host is
 *    server-controlled, never taken from a raw `Host` for URL generation.
 * 2. Open a tenant-scoped transaction (`withTenant`, RLS FORCE'd) and confirm
 *    `seo_distribution` is ENABLED for that tenant — the route-owning module. A
 *    tenant may opt out of ALL central discovery by disabling it; the routes then
 *    404 exactly like an unknown tenant, leaking no "why".
 *
 * Like `withNewsTenant`, every non-serving outcome — unknown/inactive tenant,
 * unmapped host, `tenant_code_legacy` mode, or `seo_distribution` disabled —
 * returns the SAME generic `null`, and the unresolved-tenant path is
 * cost-normalized (`padUnresolvedSeoTenantLatency`) so a prober cannot learn "this
 * host maps to a real active tenant" from response latency (the same
 * side-channel migration 033 / blog_content's `padUnresolvedTenantLatency` close).
 *
 * NO cross-content-module import: this file consumes only `module_management`'s
 * tenant lifecycle (the module registry authority) and the neutral tenant
 * resolver — never `blog_content`/`news_portal` internals. The content providers
 * are injected at the route composition root (`src/lib/seo/discovery-providers.ts`).
 */
import { withTenant } from "../../../lib/database/tenant-context";
import {
  resolvePublicTenantFromRequest,
  type PublicHostResolverConfig,
  type PublicTenantResolution
} from "../../../lib/tenant/public-host-tenant-resolver";
import { fetchTenantModuleEntry } from "../../module-management/application/tenant-module-lifecycle";
import { SEO_MODULE_KEY } from "../domain/seo-permissions";

export type SeoPublicTenantHandler<T> = (
  tx: Bun.TransactionSQL,
  tenant: PublicTenantResolution
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

/** Whether `seo_distribution` is enabled for a tenant — the single-module gate this route family applies. */
async function isSeoDistributionEnabled(
  tx: Bun.TransactionSQL,
  tenantId: string
): Promise<boolean> {
  const entry = await fetchTenantModuleEntry(tx, tenantId, SEO_MODULE_KEY);
  // Fail-closed: a missing entry (descriptor not registered — unreachable in
  // practice since seo_distribution is always in listModules()) reads as disabled.
  return entry?.tenantEnabled ?? false;
}

/**
 * Pads the "tenant did not resolve" path with the same round-trip SHAPE the
 * resolved-but-disabled path pays (`withTenant` + one `fetchTenantModuleEntry`),
 * so every outcome collapsing to the same generic 404 costs the same DB work.
 * Exported so the integration test can prove parity directly.
 */
export async function padUnresolvedSeoTenantLatency(
  sql: Bun.SQL
): Promise<void> {
  await withTenant(sql, TIMING_PAD_TENANT_ID, async (tx) => {
    await isSeoDistributionEnabled(tx, TIMING_PAD_TENANT_ID);
  });
}

/**
 * Resolve the public tenant for a discovery request and, only if resolved AND
 * `seo_distribution` is enabled, run `handler` inside its tenant transaction.
 * Returns `null` for every other case (the caller maps it to a generic 404).
 */
export async function withSeoPublicTenant<T>(
  sql: Bun.SQL,
  request: Request,
  handler: SeoPublicTenantHandler<T>,
  env: NodeJS.ProcessEnv = process.env
): Promise<T | null> {
  const config = buildPublicHostResolverConfigFromEnv(env);
  const tenant = await resolvePublicTenantFromRequest(sql, request, config);

  if (!tenant) {
    // Awaited and discarded — pays the same cost as the gate branch below so the
    // two outcomes are latency-indistinguishable.
    await padUnresolvedSeoTenantLatency(sql);
    return null;
  }

  return withTenant(sql, tenant.tenantId, async (tx) => {
    if (!(await isSeoDistributionEnabled(tx, tenant.tenantId))) {
      return null;
    }
    return handler(tx, tenant);
  });
}
