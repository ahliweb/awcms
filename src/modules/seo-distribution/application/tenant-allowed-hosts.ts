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

type HostRow = { normalized_hostname: string };

export async function resolveTenantAllowedHosts(
  tx: Bun.SQL,
  tenantId: string
): Promise<string[]> {
  const rows = (await tx`
    SELECT normalized_hostname
    FROM awcms_tenant_domains
    WHERE tenant_id = ${tenantId}
      AND status = 'active'
      AND deleted_at IS NULL
    ORDER BY normalized_hostname
  `) as HostRow[];

  return rows.map((r) => r.normalized_hostname);
}
