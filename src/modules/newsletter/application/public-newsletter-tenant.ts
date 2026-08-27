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
import { fetchTenantModuleEntry } from "../../module-management/application/tenant-module-lifecycle";
import {
  newsletterCorsHeaders,
  type NewsletterOriginDecision
} from "../domain/newsletter-cors";
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
 *
 * ## Two entry points since ADR-0118
 *
 * `withNewsletterTenant` is the host-resolved one, kept for anything this repo
 * calls itself. `withPublicNewsletterTenant` is what the three JSON endpoints
 * use: same gate, same neutral outcomes, but it classifies the request's
 * `Origin` first and resolves a CROSS-ORIGIN request's tenant from that origin
 * instead of from the host — because the host of a request from a statically
 * built site is this CMS, and the host chain's default-tenant fallback would
 * have written a stranger's address into somebody else's list. `site_search`
 * met the same problem first (ADR-0107); this follows its solution rather than
 * inventing a second one. See `domain/newsletter-cors.ts`.
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

  return runWithNewsletterTenant(sql, tenant, handler);
}

/**
 * The half of `withNewsletterTenant` that runs once a tenant is known, shared
 * with the cross-origin path below so both pay the same module gate in the same
 * order.
 */
async function runWithNewsletterTenant<T>(
  sql: Bun.SQL,
  tenant: PublicTenantResolution,
  handler: NewsletterTenantHandler<T>
): Promise<T | null> {
  return withTenantOrThrow(sql, tenant.tenantId, async (tx) => {
    if (!(await isNewsletterEnabled(tx, tenant.tenantId))) {
      return null;
    }
    return handler(tx, tenant);
  });
}

/**
 * Classify a public newsletter request's `Origin` and, when it is cross-origin,
 * resolve the tenant that origin names.
 *
 * The lookup is `resolvePublicTenantByHost` and nothing else: no env default,
 * no setup-state default. A cross-origin caller naming a hostname this
 * deployment does not serve gets `refused` — never somebody else's tenant, and
 * never this deployment's own default list.
 *
 * That last sentence is the reason this function exists. Before it, a
 * subscription posted from a statically built site resolved its tenant from the
 * HOST, and the host of such a request is this CMS: the address would have been
 * written into whichever tenant owns this deployment's hostname. Not an error
 * anybody would have seen — a wrong success.
 */
export async function resolvePublicNewsletterOrigin(
  sql: Bun.SQL,
  request: Request
): Promise<{
  decision: NewsletterOriginDecision;
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

export type PublicNewsletterOutcome<T> = {
  /** `null` for every non-resolving/disabled/refused case — the caller answers with its neutral body. */
  result: T | null;
  /** CORS headers to attach to that answer, granted or not. */
  corsHeaders: Record<string, string>;
  /** The classified origin. The caller needs it to build a token URL on the SITE's origin; nothing in the response may distinguish these. */
  decision: NewsletterOriginDecision;
};

/**
 * The public entry point for the three JSON endpoints (ADR-0118): classify the
 * origin, resolve the tenant on whichever path that implies, and hand back both
 * the handler's answer and the CORS headers it must be sent with.
 *
 * A refused origin pays `padUnresolvedNewsletterTenantLatency`, exactly like an
 * unresolved host. Without it, "this origin is a tenant of this deployment"
 * would be readable from response TIME even though the body says nothing — and
 * the body saying nothing is the whole design of this module.
 */
export async function withPublicNewsletterTenant<T>(
  sql: Bun.SQL,
  request: Request,
  handler: NewsletterTenantHandler<T>,
  env: NodeJS.ProcessEnv = process.env
): Promise<PublicNewsletterOutcome<T>> {
  const { decision, tenant: originTenant } =
    await resolvePublicNewsletterOrigin(sql, request);
  const corsHeaders = newsletterCorsHeaders(decision);

  if (decision.kind === "refused") {
    await padUnresolvedNewsletterTenantLatency(sql);
    return { result: null, corsHeaders, decision };
  }

  if (decision.kind === "granted" && originTenant) {
    return {
      result: await runWithNewsletterTenant(sql, originTenant, handler),
      corsHeaders,
      decision
    };
  }

  return {
    result: await withNewsletterTenant(sql, request, handler, env),
    corsHeaders,
    decision
  };
}
