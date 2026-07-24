/**
 * Per-tenant redirect-settings data access (ADR-0039) over
 * `awcms_seo_redirect_settings` (sql/060). Runs inside a tenant transaction (RLS
 * FORCE'd). `EMPTY_REDIRECT_SETTINGS` is returned when no row exists yet, so callers
 * never handle a null. `updateRedirectSettings` is the only writer and records an
 * audit event via the injected hook (the legacy-blog toggle changes routing
 * behavior — high-risk).
 */
import {
  EMPTY_REDIRECT_SETTINGS,
  type RedirectSettings
} from "../domain/redirect-settings";

type SettingsRow = {
  legacy_blog_redirect_enabled: boolean;
  url_change_auto_policy: RedirectSettings["urlChangeAutoPolicy"];
};

function toSettings(row: SettingsRow): RedirectSettings {
  return {
    legacyBlogRedirectEnabled: row.legacy_blog_redirect_enabled,
    urlChangeAutoPolicy: row.url_change_auto_policy
  };
}

export async function fetchRedirectSettings(
  tx: Bun.SQL,
  tenantId: string
): Promise<RedirectSettings> {
  const rows = (await tx`
    SELECT legacy_blog_redirect_enabled, url_change_auto_policy
    FROM awcms_seo_redirect_settings
    WHERE tenant_id = ${tenantId}
  `) as SettingsRow[];

  return rows[0] ? toSettings(rows[0]) : { ...EMPTY_REDIRECT_SETTINGS };
}

export type RedirectSettingsAuditHook = (
  tx: Bun.SQL,
  detail: { previous: RedirectSettings; next: RedirectSettings }
) => Promise<void>;

export async function updateRedirectSettings(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  next: RedirectSettings,
  recordAudit: RedirectSettingsAuditHook
): Promise<RedirectSettings> {
  const previous = await fetchRedirectSettings(tx, tenantId);

  const rows = (await tx`
    INSERT INTO awcms_seo_redirect_settings
      (tenant_id, legacy_blog_redirect_enabled, url_change_auto_policy, created_by, updated_by)
    VALUES (
      ${tenantId}, ${next.legacyBlogRedirectEnabled}, ${next.urlChangeAutoPolicy},
      ${actorTenantUserId}, ${actorTenantUserId}
    )
    ON CONFLICT (tenant_id) DO UPDATE SET
      legacy_blog_redirect_enabled = EXCLUDED.legacy_blog_redirect_enabled,
      url_change_auto_policy = EXCLUDED.url_change_auto_policy,
      updated_by = EXCLUDED.updated_by,
      updated_at = now()
    RETURNING legacy_blog_redirect_enabled, url_change_auto_policy
  `) as SettingsRow[];

  const saved = toSettings(rows[0]!);
  await recordAudit(tx, { previous, next: saved });
  return saved;
}
