/**
 * Server-derived canonical host resolution (ADR-0038 §5) — the
 * host-header-poisoning defense at its source. The SEO renderer's canonical /
 * `og:url` / hreflang absolute URLs are built from the tenant's VERIFIED PRIMARY
 * domain (`awcms_tenant_domains.is_primary`, migration 046), never from
 * the request `Host`/`X-Forwarded-Host`.
 *
 * Runs inside the caller's tenant transaction (RLS is FORCE'd on
 * `awcms_tenant_domains` since migration 046), so it can only ever see
 * THIS tenant's domain rows — a second, structural layer under the explicit
 * `tenant_id` filter. Only an `active` (verified), non-soft-deleted primary
 * resolves; anything else returns `null`, and the renderer then degrades to a
 * relative canonical rather than inventing a host (ADR-0038 §5.4, offline-lan
 * safe).
 */

type PrimaryHostRow = { normalized_hostname: string };

/**
 * Resolve `tenantId`'s primary canonical host, or `null` when the tenant has no
 * verified primary domain (offline-lan / not-yet-configured deployments). The
 * returned value is the already-normalized hostname (lowercased, port-stripped —
 * migration 046's `normalized_hostname`), safe to place directly into
 * `https://{host}{path}`.
 */
export async function resolveTenantPrimaryHost(
  tx: Bun.SQL,
  tenantId: string
): Promise<string | null> {
  const rows = (await tx`
    SELECT normalized_hostname
    FROM awcms_tenant_domains
    WHERE tenant_id = ${tenantId}
      AND is_primary = true
      AND status = 'active'
      AND deleted_at IS NULL
    LIMIT 1
  `) as PrimaryHostRow[];

  return rows[0] ? rows[0].normalized_hostname : null;
}
