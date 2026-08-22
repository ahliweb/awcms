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

import { normalizePublicHost } from "../../../lib/tenant/public-host-tenant-resolver";

type PrimaryHostRow = { normalized_hostname: string };

/**
 * Defense-in-depth: re-validate a stored hostname's DNS shape at the render
 * boundary. The stored value is already `normalized_hostname` (migration 046
 * rejects CR/LF/whitespace/underscores at write time), so a valid host
 * round-trips to itself; if a future domain-write path ever relaxes that
 * validation, this keeps `https://{host}/sitemap.xml` etc. (robots.txt /
 * sitemap / feed) from being fed a header/response-splitting payload — an
 * out-of-shape value degrades to `null` (discovery 404s), never emits a
 * poisoned host.
 *
 * Exported so the batched reader in `tenant-allowed-hosts.ts` applies the SAME
 * rule rather than a second copy of it: a defense that exists twice is a
 * defense that can be relaxed in one place and still look present in the
 * other.
 */
export function validateRenderableHost(host: string | null): string | null {
  if (host === null) return null;

  return normalizePublicHost(host) === host ? host : null;
}

/**
 * Resolve `tenantId`'s primary canonical host, or `null` when the tenant has no
 * verified primary domain (offline-lan / not-yet-configured deployments). The
 * returned value is the already-normalized hostname (lowercased, port-stripped —
 * migration 046's `normalized_hostname`), safe to place directly into
 * `https://{host}{path}`.
 *
 * For a caller that ALSO needs the tenant's full allowed-host set, use
 * `resolveTenantDomainSet` instead — it answers both from one round trip.
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

  return validateRenderableHost(rows[0]?.normalized_hostname ?? null);
}
