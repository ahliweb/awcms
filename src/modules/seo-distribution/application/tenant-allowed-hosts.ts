/**
 * Resolve the set of hosts a tenant is allowed to redirect TO (ADR-0039; adapted
 * from awcms-micro ADR-0028 §8) — the `allowedHosts` argument every target
 * validation and every resolve-time re-validation passes to the frozen
 * `classifyRedirectTarget` guard.
 *
 * These are the tenant's VERIFIED, active, non-soft-deleted `normalized_hostname`s
 * from `awcms_tenant_domains` (migration 046) — server-derived, never a request
 * `Host`. Runs inside the caller's tenant transaction (RLS FORCE'd on that table),
 * so it can only ever see THIS tenant's domains. An absolute redirect target is
 * `same_tenant_internal` only if its host is in this set; a target to a host the
 * tenant has since removed fails closed on the next resolve.
 */

import { validateRenderableHost } from "./resolve-canonical-host";

type HostRow = { normalized_hostname: string; is_primary: boolean };

/** A tenant's verified active domains: the allow-list, plus which one is canonical. */
export type TenantDomainSet = {
  /** Every verified active host, ordered — the `allowedHosts` guard argument. */
  hosts: string[];
  /** The canonical host for absolute URLs, or `null` when the tenant has none. */
  primaryHost: string | null;
};

/**
 * Both facts about a tenant's domains in ONE round trip.
 *
 * `resolveTenantAllowedHosts` and `resolveTenantPrimaryHost` read the SAME
 * table under the same `active`/not-deleted filter, differing only by
 * `is_primary`. The public redirect path called them one after the other, on
 * every eligible public request, so a fact already in the first result set was
 * fetched a second time — finding B5 of the 17 August 2026 round, where the
 * middleware's per-request round trips are the whole subject.
 *
 * `primaryHost` goes through the same `validateRenderableHost` as the dedicated
 * reader, so a caller cannot get a laxer value by asking this way.
 */
export async function resolveTenantDomainSet(
  tx: Bun.SQL,
  tenantId: string
): Promise<TenantDomainSet> {
  const rows = (await tx`
    SELECT normalized_hostname, is_primary
    FROM awcms_tenant_domains
    WHERE tenant_id = ${tenantId}
      AND status = 'active'
      AND deleted_at IS NULL
    ORDER BY normalized_hostname
  `) as HostRow[];

  return {
    hosts: rows.map((r) => r.normalized_hostname),
    primaryHost: validateRenderableHost(
      rows.find((r) => r.is_primary)?.normalized_hostname ?? null
    )
  };
}

export async function resolveTenantAllowedHosts(
  tx: Bun.SQL,
  tenantId: string
): Promise<string[]> {
  return (await resolveTenantDomainSet(tx, tenantId)).hosts;
}
