export type TenantActivityReport = {
  tenantName: string;
  tenantStatus: string;
  tenantCreatedAt: string;
  activeUserCount: number;
  activeOfficeCount: number;
  mostRecentLoginAt: string | null;
};

/**
 * Tenant activity summary (Issue 9.1, `GET /reports/tenant-activity`). Live
 * read-aggregation over tables created by migrations 002 (tenants, offices)
 * and 004 (tenant_users, identities) — no new tables.
 *
 * `awcms_tenant_users` has no `deleted_at` column (see
 * `sql/004_awcms_identity_login_schema.sql`), so "active" here means
 * `status = 'active'` only, unlike offices which also filter
 * `deleted_at IS NULL`.
 */
export async function fetchTenantActivityReport(
  tx: Bun.SQL,
  tenantId: string
): Promise<TenantActivityReport> {
  const tenantRows = await tx`
    SELECT tenant_name, status, created_at
    FROM awcms_tenants
    WHERE id = ${tenantId}
  `;
  const tenant = tenantRows[0] as
    { tenant_name: string; status: string; created_at: Date } | undefined;

  const activeUserRows = await tx`
    SELECT COUNT(*) AS active_user_count
    FROM awcms_tenant_users
    WHERE tenant_id = ${tenantId} AND status = 'active'
  `;

  const activeOfficeRows = await tx`
    SELECT COUNT(*) AS active_office_count
    FROM awcms_offices
    WHERE tenant_id = ${tenantId} AND status = 'active' AND deleted_at IS NULL
  `;

  const lastLoginRows = await tx`
    SELECT MAX(last_login_at) AS most_recent_login_at
    FROM awcms_identities
    WHERE tenant_id = ${tenantId}
  `;

  return {
    tenantName: tenant?.tenant_name ?? "Tenant",
    tenantStatus: tenant?.status ?? "unknown",
    tenantCreatedAt: (tenant?.created_at ?? new Date(0)).toISOString(),
    activeUserCount: Number(activeUserRows[0]?.active_user_count ?? 0),
    activeOfficeCount: Number(activeOfficeRows[0]?.active_office_count ?? 0),
    mostRecentLoginAt:
      (lastLoginRows[0]?.most_recent_login_at as Date | null)?.toISOString() ??
      null
  };
}
