import type { BlogThemeMode } from "../domain/theme-policy";

/**
 * `awcms_blog_theme_settings` (Issue #542 §Theme Mode). Absence of a
 * row means "inherit the tenant's own theme" — same "missing row = fall
 * back to a base default" convention `fetchPublicBlogSettings` uses for
 * `awcms_blog_settings` — so this reads `awcms_tenants.
 * default_theme` (migration 002, the base theme engine this issue must not
 * rebuild) as the fallback rather than hardcoding `'system'`.
 */
export type BlogThemeSettings = {
  mode: BlogThemeMode;
  isOverride: boolean;
};

export async function fetchBlogThemeSettings(
  tx: Bun.SQL,
  tenantId: string
): Promise<BlogThemeSettings> {
  const overrideRows = (await tx`
    SELECT mode FROM awcms_blog_theme_settings WHERE tenant_id = ${tenantId}
  `) as { mode: BlogThemeMode }[];

  if (overrideRows[0]) {
    return { mode: overrideRows[0].mode, isOverride: true };
  }

  const tenantRows = (await tx`
    SELECT default_theme FROM awcms_tenants WHERE id = ${tenantId}
  `) as { default_theme: BlogThemeMode }[];

  return {
    mode: tenantRows[0]?.default_theme ?? "system",
    isOverride: false
  };
}

/** Upsert — one row per tenant, same shape `awcms_blog_settings` uses. */
export async function upsertBlogThemeSettings(
  tx: Bun.SQL,
  tenantId: string,
  mode: BlogThemeMode
): Promise<BlogThemeSettings> {
  await tx`
    INSERT INTO awcms_blog_theme_settings (tenant_id, mode)
    VALUES (${tenantId}, ${mode})
    ON CONFLICT (tenant_id) DO UPDATE
    SET mode = ${mode}, updated_at = now()
  `;

  return { mode, isOverride: true };
}
