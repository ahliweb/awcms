-- ADR-0095 — the interface speaks the reader's language.
--
-- `awcms_principal_preferences` — GLOBAL, no `tenant_id`, no RLS, keyed by
-- `principal_id`. The shape is `awcms_principal_mfa_factors`' (sql/114, ADR-0087)
-- reused deliberately: this is a property of the HUMAN, and the reasoning is the
-- same one that moved the second factor up here.
--
-- ## Why not `awcms_identities` (tenant-scoped), which is the obvious answer
--
-- Two reasons, and the second is the one that decides it:
--
-- 1. A person who reads Indonesian reads it in all three tenants they belong to.
--    Keyed per-identity, they set it three times and lose it again on the fourth
--    invitation.
-- 2. ADR-0088's tenant-selection screen renders BEFORE a tenant exists. A
--    preference carrying `tenant_id` is structurally unreadable there, so the
--    first screen an Indonesian reader sees after login would be English
--    forever. That is not a gap to patch later; it follows from the wrong key.
--
-- ## Why this is NOT the cross-tenant read ADR-0094 warns about
--
-- FORCE RLS forbids reading a table WITH `tenant_id` for another tenant. This
-- table has none — exactly like `awcms_principals` and `awcms_permissions`. No
-- policy is bypassed because no policy applies. The controls standing in for RLS
-- are ADR-0085's, reused without loosening; see the ADR §"Keputusan 1".
--
-- ## `theme` lives here too, next to `locale`, on purpose
--
-- Both answer "how does this human want to be shown things", both are innocuous,
-- and splitting them across two tables would mean two round trips to render one
-- topbar. `awcms_tenants.default_theme` (a column that has existed since sql/001
-- and that NOTHING has ever read) becomes the fallback rather than being
-- duplicated here.

BEGIN;

CREATE TABLE IF NOT EXISTS awcms_principal_preferences (
  principal_id uuid PRIMARY KEY REFERENCES awcms_principals (id),
  -- NULL = "not chosen", which is DIFFERENT from choosing English. A NULL falls
  -- through to the tenant default and then to `Accept-Language`, so a reader who
  -- never opened the switcher still gets the language their browser asked for.
  -- Storing `'en'` on account creation would silently override that request.
  locale text,
  -- NULL = "not chosen" → `awcms_tenants.default_theme` → `system`. The
  -- three-value vocabulary matches `ThemeToggle`'s cycle and the init script's.
  theme text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- The supported-locale list is enforced here as well as in TypeScript. A CHECK
  -- is what makes "the column can only hold a locale this build can render" true
  -- for every writer, including a future job or a hand-run UPDATE — neither of
  -- which passes through `src/lib/i18n`.
  --
  -- Adding a locale therefore costs a migration. That is the intended price: a
  -- locale with no catalog renders as untranslated English, and the CHECK is
  -- what stops a value nothing can render from being persisted at all.
  CONSTRAINT awcms_principal_preferences_locale_check
    CHECK (locale IS NULL OR locale IN ('en', 'id')),
  CONSTRAINT awcms_principal_preferences_theme_check
    CHECK (theme IS NULL OR theme IN ('system', 'light', 'dark'))
);

COMMENT ON TABLE awcms_principal_preferences IS
  'ADR-0095 — per-human display preferences (UI locale, colour theme). GLOBAL and RLS-free like awcms_principals: a preference belongs to the person, not to one tenant membership. Registered in GLOBAL_TABLE_FORBIDDEN_PRIVILEGES.';

-- Runtime privileges, narrowed explicitly rather than inherited.
--
-- SELECT/INSERT/UPDATE: the account screen upserts one row. Note that the upsert
-- NEEDS SELECT, not just INSERT — `ON CONFLICT` reads the conflicting row, and
-- `GRANT INSERT` alone fails with `permission denied` at runtime while every
-- migration stays green (the trap sql/127 was written for).
--
-- DELETE is withheld PERMANENTLY, and this differs from the recovery-code table
-- one migration family over for a stated reason: a spent recovery code is
-- deleted because "gone" is its correct end state. A preference is never gone —
-- it is RESET, which is `UPDATE … SET locale = NULL`, a value this schema models
-- as "not chosen". Granting DELETE would add a second way to express the same
-- state and nothing would need it.
REVOKE ALL ON awcms_principal_preferences FROM awcms_app;
GRANT SELECT, INSERT, UPDATE ON awcms_principal_preferences TO awcms_app;

-- `awcms_worker` gets nothing: no job reads or writes a display preference, and
-- a role that holds a privilege no job needs is a privilege nobody is watching.

COMMIT;
