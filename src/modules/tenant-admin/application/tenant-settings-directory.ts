export type TenantSettingsView = {
  tenantId: string;
  tenantName: string;
  legalName: string | null;
  defaultLocale: string;
  defaultTheme: string;
  timezone: string;
  featureFlags: Record<string, unknown>;
};

/**
 * `awcms_tenants` is intentionally RLS-free — it IS the tenant root, its
 * `id` is the tenant id, there's no separate `tenant_id` column to key a
 * policy on. Callers must scope by `WHERE id = <tenantId>` explicitly.
 */
export async function fetchTenantSettings(
  tx: Bun.SQL,
  tenantId: string
): Promise<TenantSettingsView | null> {
  const tenantRows = (await tx`
    SELECT id, tenant_name, legal_name, default_locale, default_theme
    FROM awcms_tenants
    WHERE id = ${tenantId}
  `) as Array<{
    id: string;
    tenant_name: string;
    legal_name: string | null;
    default_locale: string;
    default_theme: string;
  }>;
  const tenant = tenantRows[0];

  if (!tenant) return null;

  const settingsRows = (await tx`
    SELECT timezone, feature_flags FROM awcms_tenant_settings WHERE tenant_id = ${tenantId}
  `) as Array<{ timezone: string; feature_flags: Record<string, unknown> }>;
  const settings = settingsRows[0];

  return {
    tenantId: tenant.id,
    tenantName: tenant.tenant_name,
    legalName: tenant.legal_name,
    defaultLocale: tenant.default_locale,
    defaultTheme: tenant.default_theme,
    timezone: settings?.timezone ?? "Asia/Jakarta",
    featureFlags: settings?.feature_flags ?? {}
  };
}

export type UpdateTenantSettingsFields = {
  tenantName?: string;
  legalName?: string | null;
  defaultLocale?: string;
  defaultTheme?: string;
  timezone?: string;
  featureFlags?: Record<string, unknown>;
};

export async function updateTenantSettings(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  input: UpdateTenantSettingsFields
): Promise<TenantSettingsView | null> {
  const tenantRows =
    await tx`SELECT id FROM awcms_tenants WHERE id = ${tenantId}`;
  if (!tenantRows[0]) return null;

  if (input.tenantName !== undefined) {
    await tx`UPDATE awcms_tenants SET tenant_name = ${input.tenantName}, updated_at = now(), updated_by = ${actorTenantUserId} WHERE id = ${tenantId}`;
  }
  if (input.legalName !== undefined) {
    await tx`UPDATE awcms_tenants SET legal_name = ${input.legalName}, updated_at = now(), updated_by = ${actorTenantUserId} WHERE id = ${tenantId}`;
  }
  if (input.defaultLocale !== undefined) {
    await tx`UPDATE awcms_tenants SET default_locale = ${input.defaultLocale}, updated_at = now(), updated_by = ${actorTenantUserId} WHERE id = ${tenantId}`;
  }
  if (input.defaultTheme !== undefined) {
    await tx`UPDATE awcms_tenants SET default_theme = ${input.defaultTheme}, updated_at = now(), updated_by = ${actorTenantUserId} WHERE id = ${tenantId}`;
  }
  if (input.timezone !== undefined) {
    await tx`UPDATE awcms_tenant_settings SET timezone = ${input.timezone}, updated_at = now() WHERE tenant_id = ${tenantId}`;
  }
  if (input.featureFlags !== undefined) {
    await tx`UPDATE awcms_tenant_settings SET feature_flags = ${input.featureFlags}, updated_at = now() WHERE tenant_id = ${tenantId}`;
  }

  return fetchTenantSettings(tx, tenantId);
}
