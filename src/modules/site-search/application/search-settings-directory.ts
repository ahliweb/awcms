/**
 * Tenant search-config data access (ADR-0040 §6, ported from awcms-micro Issue
 * #270) over `awcms_site_search_settings` (sql/064). Every query runs inside a
 * caller-provided tenant transaction (`withTenant`, RLS FORCE'd), so tenant
 * isolation holds twice (explicit `tenant_id` filter + RLS).
 *
 * `updateSiteSearchSettings` is the only writer and records an audit event on
 * every write via the injected `recordAudit` callback (the route wires
 * `recordAuditEvent`; tests pass a spy).
 */
import {
  DEFAULT_SITE_SEARCH_SETTINGS,
  type SiteSearchSettings
} from "../domain/search-settings";

type SettingsRow = {
  enabled: boolean;
  enabled_resource_types: string[] | null;
  result_limit: number;
  min_query_length: number;
  suggestions_enabled: boolean;
  suggestion_limit: number;
  analytics_enabled: boolean;
};

const SETTINGS_COLUMNS =
  "enabled, enabled_resource_types, result_limit, min_query_length, " +
  "suggestions_enabled, suggestion_limit, analytics_enabled";

function toSettings(row: SettingsRow): SiteSearchSettings {
  return {
    enabled: row.enabled,
    enabledResourceTypes: row.enabled_resource_types,
    resultLimit: row.result_limit,
    minQueryLength: row.min_query_length,
    suggestionsEnabled: row.suggestions_enabled,
    suggestionLimit: row.suggestion_limit,
    analyticsEnabled: row.analytics_enabled
  };
}

/** Read this tenant's search config, returning defaults when no row exists yet. */
export async function fetchSiteSearchSettings(
  tx: Bun.SQL,
  tenantId: string
): Promise<SiteSearchSettings> {
  const rows = (await tx`
    SELECT ${tx.unsafe(SETTINGS_COLUMNS)}
    FROM awcms_site_search_settings
    WHERE tenant_id = ${tenantId}
  `) as SettingsRow[];

  return rows[0] ? toSettings(rows[0]) : { ...DEFAULT_SITE_SEARCH_SETTINGS };
}

export type SiteSearchSettingsAuditHook = (
  tx: Bun.SQL,
  detail: { previous: SiteSearchSettings; next: SiteSearchSettings }
) => Promise<void>;

/**
 * Upsert this tenant's search config (full replace of the mutable fields — PUT
 * semantics), then record an audit event. Idempotent at the DB level.
 */
export async function updateSiteSearchSettings(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  next: SiteSearchSettings,
  recordAudit: SiteSearchSettingsAuditHook
): Promise<SiteSearchSettings> {
  const previous = await fetchSiteSearchSettings(tx, tenantId);

  const enabledTypesParam =
    next.enabledResourceTypes === null
      ? null
      : tx.array(next.enabledResourceTypes, "text");

  const rows = (await tx`
    INSERT INTO awcms_site_search_settings
      (tenant_id, enabled, enabled_resource_types, result_limit, min_query_length,
       suggestions_enabled, suggestion_limit, analytics_enabled, created_by, updated_by)
    VALUES (
      ${tenantId}, ${next.enabled}, ${enabledTypesParam}, ${next.resultLimit},
      ${next.minQueryLength}, ${next.suggestionsEnabled}, ${next.suggestionLimit},
      ${next.analyticsEnabled}, ${actorTenantUserId}, ${actorTenantUserId}
    )
    ON CONFLICT (tenant_id) DO UPDATE SET
      enabled = EXCLUDED.enabled,
      enabled_resource_types = EXCLUDED.enabled_resource_types,
      result_limit = EXCLUDED.result_limit,
      min_query_length = EXCLUDED.min_query_length,
      suggestions_enabled = EXCLUDED.suggestions_enabled,
      suggestion_limit = EXCLUDED.suggestion_limit,
      analytics_enabled = EXCLUDED.analytics_enabled,
      updated_by = EXCLUDED.updated_by,
      updated_at = now()
    RETURNING ${tx.unsafe(SETTINGS_COLUMNS)}
  `) as SettingsRow[];

  const saved = toSettings(rows[0]!);
  await recordAudit(tx, { previous, next: saved });
  return saved;
}
