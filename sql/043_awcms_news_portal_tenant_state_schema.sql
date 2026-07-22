-- news_portal — a tamper-proof per-tenant "has this tenant applied the
-- news_portal_full_online_r2 preset" signal, read by the `news_media` port's
-- `isFullOnlineR2ModeActiveForTenant` to decide whether R2-only media
-- validation is active for a given tenant. Ported from awcms-mini migration
-- 043.
--
-- ## Why a NEW, dedicated table (security-auditor finding upstream)
--
-- Two earlier attempts at this signal both failed: (1)
-- `awcms_tenant_modules.enabled` is opt-out-by-default — every tenant reads
-- as "news_portal enabled" whether or not the preset was ever applied, so it
-- cannot distinguish "opted in" from "never touched"; (2) the generic
-- per-tenant module settings store is directly tenant-writable through the
-- generic module-settings endpoint (gated only by the generic
-- `module_management.settings.update` permission, unrelated to news_portal),
-- so a tenant could silently disable R2-only validation for themselves. This
-- table has NO generic write endpoint anywhere; the only sanctioned writer is
-- the preset-application entry point (`markFullOnlineR2ModeApplied`,
-- `news-portal/application/news-portal-tenant-state.ts`). RLS FORCE'd like
-- every other tenant-scoped table.
--
-- ## PORT NOTE (awcms): no writer in this base yet
--
-- The preset-ACTIVATION path (`apply-news-portal-preset.ts`, which called
-- `module_management`'s `applyModulePreset`) was DROPPED in this port because
-- `module_management`'s preset subsystem (`applyModulePreset`/`MODULE_PRESETS`/
-- `planEnableOrder`) is not ported to this base. This table + its read helper
-- are retained (forward-compatible) so that when that subsystem is ported the
-- marker works from day one; until then no row is ever written, so
-- `isFullOnlineR2ModeActiveForTenant` always resolves `false` (fail-closed) —
-- exactly the net behavior blog_content's prior no-op adapter produced.
--
-- One row per tenant (tenant_id is the primary key) — this table only ever
-- answers one yes/no question per tenant, never a list.
CREATE TABLE IF NOT EXISTS awcms_news_portal_tenant_state (
  tenant_id uuid PRIMARY KEY REFERENCES awcms_tenants (id),
  full_online_r2_mode_applied_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE awcms_news_portal_tenant_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_news_portal_tenant_state FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_news_portal_tenant_state_tenant_isolation
  ON awcms_news_portal_tenant_state
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
