-- Runtime schema for the `theming` module — the FIRST website module implemented
-- directly in the awcms base (ADR-0034 Fase 3, "template dipakai-langsung";
-- ported/adapted from awcms-micro migration 085). Tenant theme assignment,
-- IMMUTABLE published configuration versions, and short-lived preview sessions.
-- All three tables are tenant-scoped, ENABLE + FORCE ROW LEVEL SECURITY with the
-- standard `tenant_isolation` policy (sql/013 convention). Tenant A's theme
-- config can NEVER be read/resolved under tenant B's context — RLS is the
-- structural floor under the explicit `tenant_id` filter every query also carries.
--
-- ## What is (and is NOT) in the database (ADR-0034/awcms-micro ADR-0029 §3/§4)
--
-- A THEME itself is trusted, reviewed, BUILD-TIME source code (a `ThemeDescriptor`
-- composed by `src/modules/theming/theme-registry.ts`), NEVER a database row and
-- NEVER uploaded/runtime-discovered. What lives here is only a tenant's DATA
-- configuration OF a chosen theme: validated design-token overrides, slot variant
-- selections, media asset ids, section ordering, nav placement — all bounded and
-- schema-validated in `domain/theme-config.ts` before ever being stored, and all
-- serialized to CSS only through the reject-not-sanitize spine
-- (`domain/css-value-validation.ts`). There is NO executable-template column
-- anywhere in this schema.
--
-- ## Published-version immutability ("a change is a new version")
--
-- `awcms_theming_config_versions` holds two statuses: a single mutable `draft`
-- per tenant, and numbered `published` versions. A published version is IMMUTABLE
-- — enforced at THREE layers: (1) the application engine only ever INSERTs a new
-- published row, never UPDATEs an old one; (2) the BEFORE UPDATE OR DELETE trigger
-- below RAISES on any attempt to mutate/delete a `status = 'published'` row; (3)
-- the active pointer (which theme + which published version is live) lives in
-- `awcms_theming_tenant_state`, so rollback/retire move a pointer and never touch
-- a version row. This keeps published versions reproducible and history intact.
--
-- ## GRANTS / worker role (port adaptation)
--
-- No explicit GRANT statements: sql/019 (`019_awcms_db_role_separation.sql`) set
-- `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ...
-- TO awcms_app`, so tables created here inherit the least-privilege runtime grant
-- automatically (same posture as sql/024). awcms-micro 085 granted the preview
-- table to `awcms_micro_worker` for a generic data_lifecycle purge job; awcms has
-- NO `awcms_worker` role and the data_lifecycle purge engine is not ported, so
-- that GRANT is deliberately dropped. Preview sessions stay safe without a purge
-- job because every read filters on `expires_at >= now()` (see
-- `application/theme-preview-directory.ts`).

-- ===========================================================================
-- 1. awcms_theming_config_versions — draft + immutable published versions
-- ===========================================================================
CREATE TABLE IF NOT EXISTS awcms_theming_config_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  -- The chosen theme's key (a `ThemeDescriptor.themeKey` from the build-time
  -- registry) and the theme descriptor version bound at publish time, so a
  -- published config is reproducible against the exact theme shape it validated
  -- against.
  theme_key text NOT NULL,
  theme_version text NOT NULL,
  -- 'draft' (the single mutable work-in-progress per tenant) | 'published'
  -- (an immutable numbered version — see the trigger below).
  status text NOT NULL DEFAULT 'draft',
  -- Monotonic per-tenant version number, assigned only to published rows
  -- (NULL for the draft). The partial unique index below prevents a race from
  -- assigning the same number twice.
  version_number integer,
  -- The validated `ThemeConfig` (token overrides, slot selections, asset media
  -- ids, section order, nav placement). Plain data — no template, no code.
  config jsonb NOT NULL,
  -- SHA-256 of the canonical config, for idempotent replays + cheap change
  -- detection.
  config_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  published_at timestamptz,
  published_by uuid,
  CONSTRAINT awcms_theming_config_versions_status_check
    CHECK (status IN ('draft', 'published')),
  -- A published row must carry a version number + publish stamp; a draft must not.
  CONSTRAINT awcms_theming_config_versions_publish_fields_check
    CHECK (
      (status = 'published' AND version_number IS NOT NULL AND published_at IS NOT NULL)
      OR (status = 'draft' AND version_number IS NULL)
    ),
  CONSTRAINT awcms_theming_config_versions_theme_key_len_check
    CHECK (theme_key <> '' AND char_length(theme_key) <= 64),
  CONSTRAINT awcms_theming_config_versions_theme_version_len_check
    CHECK (theme_version <> '' AND char_length(theme_version) <= 32),
  -- Coarse size floor under the application validation — a config is a small,
  -- bounded token/slot map, never a megabyte blob.
  CONSTRAINT awcms_theming_config_versions_config_size_check
    CHECK (octet_length(config::text) <= 65536)
);

-- Exactly one draft per tenant (the mutable working copy).
CREATE UNIQUE INDEX IF NOT EXISTS awcms_theming_config_versions_one_draft
  ON awcms_theming_config_versions (tenant_id)
  WHERE status = 'draft';

-- Published version numbers are unique per tenant (concurrency guard: two
-- concurrent publishes computing the same next number -> one fails here).
CREATE UNIQUE INDEX IF NOT EXISTS awcms_theming_config_versions_pub_number
  ON awcms_theming_config_versions (tenant_id, version_number)
  WHERE status = 'published';

-- Version-history listing (newest published first) + rollback target lookup.
CREATE INDEX IF NOT EXISTS awcms_theming_config_versions_history_idx
  ON awcms_theming_config_versions (tenant_id, version_number DESC)
  WHERE status = 'published';

ALTER TABLE awcms_theming_config_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_theming_config_versions FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_theming_config_versions_tenant_isolation
  ON awcms_theming_config_versions
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Published-version immutability enforcement. A BEFORE trigger that RAISES on any
-- UPDATE/DELETE of a published row. Draft rows stay freely mutable (the working
-- copy). The BEGIN/END below are PL/pgSQL block delimiters inside a dollar-quoted
-- body, NOT transaction control — the migration runner strips dollar-quoted
-- blocks before its transaction-control scan (see scripts/db-migrate.ts).
CREATE OR REPLACE FUNCTION awcms_theming_versions_guard()
RETURNS trigger AS $awcms_theming_guard$
BEGIN
  IF OLD.status = 'published' THEN
    RAISE EXCEPTION
      'awcms_theming_config_versions row % is published and immutable (ADR-0034): a change must create a new version',
      OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$awcms_theming_guard$ LANGUAGE plpgsql;

CREATE TRIGGER awcms_theming_versions_immutable
  BEFORE UPDATE OR DELETE ON awcms_theming_config_versions
  FOR EACH ROW
  EXECUTE FUNCTION awcms_theming_versions_guard();

-- ===========================================================================
-- 2. awcms_theming_tenant_state — the tenant's active theme + pointers
-- ===========================================================================
-- One upsert-shaped row per tenant. The ACTIVE pointer is here, not on a version
-- row, so publish/rollback/retire move a pointer while published versions stay
-- immutable. `active_theme_key`/`active_version_id` NULL = this tenant has not
-- published a theme yet (the site falls back to the default theme's defaults).
CREATE TABLE IF NOT EXISTS awcms_theming_tenant_state (
  tenant_id uuid PRIMARY KEY REFERENCES awcms_tenants (id),
  active_theme_key text,
  active_version_id uuid REFERENCES awcms_theming_config_versions (id),
  -- The current draft's key (denormalized convenience; the draft row itself is
  -- the source of truth via the one-draft-per-tenant index above).
  draft_theme_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  CONSTRAINT awcms_theming_tenant_state_active_theme_len_check
    CHECK (active_theme_key IS NULL OR char_length(active_theme_key) <= 64),
  CONSTRAINT awcms_theming_tenant_state_draft_theme_len_check
    CHECK (draft_theme_key IS NULL OR char_length(draft_theme_key) <= 64)
);

ALTER TABLE awcms_theming_tenant_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_theming_tenant_state FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_theming_tenant_state_tenant_isolation
  ON awcms_theming_tenant_state
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ===========================================================================
-- 3. awcms_theming_preview_sessions — short-lived, non-indexable previews
-- ===========================================================================
-- An authorized, short-lived session that renders a tenant's DRAFT theme config
-- at a non-indexable URL isolated from the public cache. Only the SHA-256 HASH of
-- the raw token is stored (mirrors awcms_sessions) so a table leak never yields a
-- usable token. Every read filters `expires_at >= now()` so a stale session is
-- inert even without a background purge job (the generic data_lifecycle purge
-- engine is NOT ported to awcms; see the GRANTS note in the header).
CREATE TABLE IF NOT EXISTS awcms_theming_preview_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  -- SHA-256 hex of the raw preview token (never the raw token).
  token_hash text NOT NULL,
  -- The version the preview renders — a draft version id (the working copy).
  version_id uuid NOT NULL REFERENCES awcms_theming_config_versions (id),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT awcms_theming_preview_sessions_token_hash_len_check
    CHECK (char_length(token_hash) = 64)
);

-- Token lookup is by hash — unique so a hash maps to at most one live session.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_theming_preview_sessions_token_hash
  ON awcms_theming_preview_sessions (token_hash);

-- Age-based lookup cursor (tenant + expires_at) — supports the `expires_at >= now`
-- read filter and any future age-based cleanup without a table scan.
CREATE INDEX IF NOT EXISTS awcms_theming_preview_sessions_tenant_expires_idx
  ON awcms_theming_preview_sessions (tenant_id, expires_at);

ALTER TABLE awcms_theming_preview_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_theming_preview_sessions FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_theming_preview_sessions_tenant_isolation
  ON awcms_theming_preview_sessions
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
