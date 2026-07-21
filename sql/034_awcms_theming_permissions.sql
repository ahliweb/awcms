-- Permission catalog seed for the `theming` module's admin API
-- (`/api/v1/theming/*`) — ADR-0034 Fase 3, ported from awcms-micro migration 086.
-- Wires up the constants in `theming/domain/theme-permissions.ts` and this
-- module's own `module.ts` `permissions` declaration.
--
-- `awcms_permissions` is a GLOBAL catalog (no tenant_id / no RLS — sql/005); the
-- unique key is `(module_key, activity_code, action)`, so this insert is
-- idempotent via `ON CONFLICT ... DO NOTHING`. Same shape/limitation as every
-- prior permission-seed migration here (sql/026/028): it extends the global ABAC
-- catalog only. Existing tenants' `owner` role does NOT retroactively gain these —
-- only tenants created after this migration runs get them at setup-wizard
-- bootstrap (which seeds owner from the catalog).
--
-- ## Why the activities/actions are split this way
--
--  - `config.read`    — read theme state, available theme descriptors, the draft,
--    and published version history (low blast radius; not audited).
--  - `config.update`  — save/edit the draft config (tokens, slots, assets, order).
--    Bounded, schema-validated data only; high-risk enough to audit.
--  - `version.publish` — promote a validated draft to an IMMUTABLE published
--    version and make it the tenant's active/live look. Changes the public
--    presentation surface -> high-risk, idempotency-keyed, audited.
--  - `version.restore` — roll the active pointer back to an earlier published
--    version. High-risk (changes the live look), audited.
--  - `version.archive` — retire the active theme (clear the active pointer; the
--    site falls back to the default theme). High-risk, audited.
--  - `preview.create` — mint a short-lived, non-indexable preview session for the
--    draft. Audited (an authorization event), not idempotency-keyed (each preview
--    session is intentionally distinct).
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('theming', 'config', 'read', 'Read this tenant''s theme selection, available themes, the draft config, and published version history'),
  ('theming', 'config', 'update', 'Edit this tenant''s draft theme config (design tokens, slot variants, media assets, section order) — bounded, validated data (high-risk, audited)'),
  ('theming', 'version', 'publish', 'Publish a validated draft as an immutable theme version and make it the live look (high-risk, idempotency-keyed, audited)'),
  ('theming', 'version', 'restore', 'Roll the active theme back to an earlier published version (high-risk, idempotency-keyed, audited)'),
  ('theming', 'version', 'archive', 'Retire the active theme so the site falls back to the default (high-risk, idempotency-keyed, audited)'),
  ('theming', 'preview', 'create', 'Create a short-lived, non-indexable preview session for the draft theme config (audited)')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
