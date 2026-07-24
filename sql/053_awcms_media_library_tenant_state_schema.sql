-- ADR-0036 (media-library ownership inversion) — give `media_library` its own
-- per-tenant "managed media enforcement is on" signal, so that question stops
-- being `news_portal`'s to answer.
--
-- ## The product gap this closes
--
-- `blog_content`'s media gate only enforces registry-backed references when
-- full-online R2-only mode was active for the tenant — a mode owned by
-- `news_portal` (`awcms_news_portal_tenant_state`, sql/043). Consequence: a tenant
-- running a brochure site (`blog_content` + `tenant_domain`, no news portal) could
-- only ever paste raw URLs. Uploading a logo must not require switching on a NEWS
-- PORTAL. This table lets media enforcement be turned on for any tenant.
--
-- ## Why a second table rather than reading sql/043
--
-- Reading `awcms_news_portal_tenant_state` from `media_library` would make a
-- System Foundation module depend on a domain module — the ADR-0013 §1 inversion
-- this change exists to remove. The signal has to be owned by the module that
-- answers the question. sql/043 keeps its own, narrower meaning ("this tenant
-- applied the news portal preset"), which is still genuinely news_portal's fact.
--
-- ## Tamper-proofing — inherited deliberately, not by copy-paste
--
-- Same construction as sql/043, for the same reasons its header documents at
-- length: NO generic write endpoint anywhere, RLS FORCE'd, and the only code that
-- writes it is `media-library/application/media-library-tenant-state.ts`'s
-- `markManagedMediaEnforced`, called only from the sanctioned enforcement-enable
-- entry point (`enable-managed-media-enforcement.ts`, `POST /api/v1/media/enforcement`).
-- The two mechanisms sql/043 rejected (`awcms_tenant_modules` — opt-out-by-default,
-- so every tenant reads as enabled; and `awcms_module_settings` — tenant-writable
-- via the generic `PATCH /api/v1/tenant/modules/{moduleKey}/settings`, confirmed
-- exploitable end-to-end in review) would fail here for EXACTLY the same reasons:
-- this flag decides whether media validation runs at all, so a tenant able to
-- clear it could switch off its own media validation. Do not "simplify" this into
-- a module setting, and never add a DELETE/disable path.
--
-- No explicit `GRANT` for `awcms_app`: sql/019's `ALTER DEFAULT PRIVILEGES ...
-- GRANT ... ON TABLES TO awcms_app` already covers every table created by the
-- migration owner. No `awcms_worker` grant — no background job touches this table.
CREATE TABLE IF NOT EXISTS awcms_media_library_tenant_state (
  tenant_id uuid PRIMARY KEY REFERENCES awcms_tenants (id),
  managed_media_enforced_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE awcms_media_library_tenant_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_media_library_tenant_state FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_media_library_tenant_state_tenant_isolation
  ON awcms_media_library_tenant_state
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Backfill: every tenant that already applied the news_portal R2-only preset has
-- media enforcement TODAY (that is exactly what the old gate keyed on), so it must
-- keep it. Without this, deploying this migration would silently switch media
-- validation OFF for precisely the tenants who opted into it — a security
-- regression disguised as a refactor.
--
-- In THIS base the news_portal preset-ACTIVATION path was not ported, so
-- `awcms_news_portal_tenant_state` has no writer and this SELECT reads zero rows
-- today. The backfill is written anyway for forward-compatibility: if that
-- subsystem is later ported, tenants opted in through it are carried over from
-- day one rather than silently un-enforced.
--
-- Timestamp is carried over verbatim rather than set to now(): this records when
-- enforcement genuinely began for that tenant, and now() would falsely claim
-- every historical activation happened at deploy time.
--
-- This runs as the migration owner (superuser/BYPASSRLS — see sql/019's header:
-- RLS is bypassed unconditionally for SUPERUSER/BYPASSRLS regardless of FORCE), so
-- it reads across every tenant rather than the zero rows a tenant-scoped
-- connection would see. The role-separated integration test asserts the row count
-- actually moves, rather than trusting that reasoning.
INSERT INTO awcms_media_library_tenant_state
  (tenant_id, managed_media_enforced_at, updated_at)
SELECT tenant_id, full_online_r2_mode_applied_at, now()
FROM awcms_news_portal_tenant_state
ON CONFLICT (tenant_id) DO NOTHING;
