import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import {
  resolvePublicTenantFromRequest,
  type PublicHostResolverConfig,
  type PublicTenantResolution
} from "../../../lib/tenant/public-host-tenant-resolver";
import { fetchTenantModuleEntry } from "../../module-management/application/tenant-module-lifecycle";
import { NEWSLETTER_MODULE_KEY } from "../domain/newsletter-permissions";

/**
 * Public tenant resolution for the three anonymous newsletter endpoints
 * (ADR-0103), mirroring `withSiteSearchTenant` exactly.
 *
 * ## The tenant comes from the HOST, never from a header
 *
 * This is the security property, not a convenience. A `X-Tenant-Id` header on an
 * anonymous endpoint would let any caller choose whose list they are writing to,
 * which is FR-NWL-002's isolation defeated by the request that is supposed to be
 * subject to it.
 *
 * ## Every non-resolving case collapses to `null`
 *
 * An unknown host, a suspended tenant, a tenant with `newsletter` disabled — one
 * answer, and the caller maps it to the same neutral body a successful
 * subscription gets. The unresolved path is cost-normalized against the gate
 * path so a prober cannot learn "this host is a real tenant" from latency.
 */
export type NewsletterTenantHandler<T> = (
  tx: Bun.TransactionSQL,
  tenant: PublicTenantResolution
) => Promise<T>;

/** See `public-search-tenant-resolution.ts` — the fail-closed sentinel `app.current_tenant_id` defaults to. */
const TIMING_PAD_TENANT_ID = "00000000-0000-0000-0000-000000000000";

function buildConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): PublicHostResolverConfig {
  return {
    mode: env.PUBLIC_TENANT_RESOLUTION_MODE,
    trustProxy: env.PUBLIC_TRUST_PROXY === "true"
  };
}

async function isNewsletterEnabled(
  tx: Bun.TransactionSQL,
  tenantId: string
): Promise<boolean> {
  const entry = await fetchTenantModuleEntry(
    tx,
    tenantId,
    NEWSLETTER_MODULE_KEY
  );
  // Fail-closed: a missing entry is disabled. A tenant that has not turned the
  // newsletter on must not be collecting addresses.
  return entry?.tenantEnabled ?? false;
}

/** Exported so a test can prove the two paths pay the same round trip. */
export async function padUnresolvedNewsletterTenantLatency(
  sql: Bun.SQL
): Promise<void> {
  await withTenantOrThrow(sql, TIMING_PAD_TENANT_ID, async (tx) => {
    await isNewsletterEnabled(tx, TIMING_PAD_TENANT_ID);
  });
}

export async function withNewsletterTenant<T>(
  sql: Bun.SQL,
  request: Request,
  handler: NewsletterTenantHandler<T>,
  env: NodeJS.ProcessEnv = process.env
): Promise<T | null> {
  const tenant = await resolvePublicTenantFromRequest(
    sql,
    request,
    buildConfigFromEnv(env)
  );

  if (!tenant) {
    await padUnresolvedNewsletterTenantLatency(sql);
    return null;
  }

  return withTenantOrThrow(sql, tenant.tenantId, async (tx) => {
    if (!(await isNewsletterEnabled(tx, tenant.tenantId))) {
      return null;
    }
    return handler(tx, tenant);
  });
}
