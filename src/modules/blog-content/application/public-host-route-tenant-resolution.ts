/**
 * Public tenant resolution + gate for the HOST-RESOLVED content route family
 * `/news/**` (ADR-0059 §B).
 *
 * Same shape as `site_search`'s `withSiteSearchTenant` and `comments`'
 * `withCommentsTenant` (which in turn mirror `seo_distribution`'s
 * `withSeoPublicTenant`), and deliberately so: this is the fourth public
 * surface in this repo that resolves its tenant from the request rather than
 * from a path segment, and a fourth independently-written version of that rule
 * would be a fourth place for it to drift.
 *
 * Order, and every step's failure collapses to the SAME `null`:
 *
 * 1. `resolvePublicTenantFromRequest` (ADR-0010) — `Host`/domain mapping when
 *    `PUBLIC_TENANT_RESOLUTION_MODE=host_default`, then the env/setup fallback
 *    chain. `tenant_code_legacy` never resolves, by construction.
 * 2. `blog_content` enabled for that tenant (fail-closed: a missing
 *    tenant-module row is disabled).
 * 3. The tenant's effective `publicRouteMode` is not `"disabled"`.
 *
 * The caller maps `null` to its own generic 404 and must never branch on WHY —
 * "unknown host", "module disabled" and "route family switched off" are one
 * outcome from outside. `padUnresolvedHostRouteLatency` keeps that true in the
 * time domain as well: without it, an unresolved host costs zero round trips
 * while a resolved one costs a transaction plus two queries, so response
 * latency alone answers "does this hostname map to a live tenant?".
 *
 * This is NOT the gate for `/blog/{tenantCode}` (ADR-0009). That family
 * resolves its tenant from the path, has its own independent switch
 * (`legacyTenantRouteEnabled`), and needs no timing parity — its tenant code is
 * caller-supplied and already visible in the URL.
 */
import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import {
  resolvePublicTenantFromRequest,
  type PublicHostResolverConfig,
  type PublicTenantResolution
} from "../../../lib/tenant/public-host-tenant-resolver";
import { fetchTenantModuleEntry } from "../../module-management/application/tenant-module-lifecycle";
import {
  fetchEffectivePublicRouteSettings,
  HOST_RESOLVED_PUBLIC_BASE_PATH,
  type EffectivePublicRouteSettings
} from "./public-route-settings";

/** Re-exported so the four `/news/**` route files import one thing, not two. */
export { HOST_RESOLVED_PUBLIC_BASE_PATH };

const BLOG_CONTENT_MODULE_KEY = "blog_content";

/** Fail-closed sentinel tenant (migration 013) — matches zero rows by design. */
const TIMING_PAD_TENANT_ID = "00000000-0000-0000-0000-000000000000";

export type HostResolvedBlogTenantHandler<T> = (
  tx: Bun.TransactionSQL,
  tenant: PublicTenantResolution,
  settings: EffectivePublicRouteSettings
) => Promise<T>;

export function buildPublicHostResolverConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): PublicHostResolverConfig {
  return {
    mode: env.PUBLIC_TENANT_RESOLUTION_MODE,
    trustProxy: env.PUBLIC_TRUST_PROXY === "true"
  };
}

/**
 * Steps 2 + 3, as ONE function so the padding path below runs the identical
 * query shape. Splitting them would let a later edit add a query to only one of
 * the two callers and silently reopen the timing side-channel.
 */
async function checkHostRouteGate(
  tx: Bun.TransactionSQL,
  tenantId: string
): Promise<{ enabled: boolean; settings: EffectivePublicRouteSettings }> {
  const entry = await fetchTenantModuleEntry(
    tx,
    tenantId,
    BLOG_CONTENT_MODULE_KEY
  );
  const settings = await fetchEffectivePublicRouteSettings(tx, tenantId);

  return {
    enabled:
      (entry?.tenantEnabled ?? false) &&
      settings.publicRouteMode !== "disabled",
    settings
  };
}

export async function padUnresolvedHostRouteLatency(
  sql: Bun.SQL
): Promise<void> {
  await withTenantOrThrow(sql, TIMING_PAD_TENANT_ID, async (tx) => {
    await checkHostRouteGate(tx, TIMING_PAD_TENANT_ID);
  });
}

/**
 * Resolve the public tenant for a `/news/**` request and, only when it resolves
 * AND the family is live for it, open a tenant-scoped transaction and run
 * `handler`. Returns `null` for every other case — including a handler that
 * itself returns `null` for "no such post/term", so a missing resource is
 * indistinguishable from a missing tenant.
 */
export async function withHostResolvedBlogTenant<T>(
  sql: Bun.SQL,
  request: Request,
  handler: HostResolvedBlogTenantHandler<T>,
  env: NodeJS.ProcessEnv = process.env
): Promise<T | null> {
  const config = buildPublicHostResolverConfigFromEnv(env);
  const tenant = await resolvePublicTenantFromRequest(sql, request, config);

  if (!tenant) {
    await padUnresolvedHostRouteLatency(sql);
    return null;
  }

  return withTenantOrThrow(sql, tenant.tenantId, async (tx) => {
    const { enabled, settings } = await checkHostRouteGate(tx, tenant.tenantId);

    if (!enabled) {
      return null;
    }

    return handler(tx, tenant, settings);
  });
}
