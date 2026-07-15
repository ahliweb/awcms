/**
 * Public (anonymous, no session) tenant resolution — ADR-0009. Every
 * public tenant-scoped route resolves the tenant from an explicit
 * `tenantCode` path segment (`/<prefix>/{tenantCode}/...`), not a
 * subdomain or header, because this base defaults to a LAN-first/offline
 * topology with no guaranteed public DNS/TLS per tenant.
 *
 * `awcms_tenants` is RLS-free by design (ADR-0003 — it is the root
 * of the tenant hierarchy itself), so this query runs directly on the
 * app-role connection, *before* any `withTenant(...)` transaction is
 * opened for the actual content query that follows. First real consumer:
 * Issue #540's public blog routes.
 */
export type PublicTenantResolution = {
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  defaultLocale: string;
};

type TenantRow = {
  id: string;
  tenant_code: string;
  tenant_name: string;
  status: string;
  default_locale: string;
};

/**
 * Returns `null` for both "no such tenant_code" and "tenant exists but is
 * not active" — callers must respond `404` either way, never leaking
 * which case it was (doc ADR-0009: "tidak ditemukan atau status !=
 * 'active' -> 404, bukan bocor keberadaan tenant").
 */
export async function resolvePublicTenantByCode(
  sql: Bun.SQL,
  tenantCode: string
): Promise<PublicTenantResolution | null> {
  const rows = (await sql`
    SELECT id, tenant_code, tenant_name, status, default_locale
    FROM awcms_tenants
    WHERE tenant_code = ${tenantCode}
  `) as TenantRow[];

  const tenant = rows[0];

  if (!tenant || tenant.status !== "active") {
    return null;
  }

  return {
    tenantId: tenant.id,
    tenantCode: tenant.tenant_code,
    tenantName: tenant.tenant_name,
    defaultLocale: tenant.default_locale
  };
}
