-- data_lifecycle — permission catalog seed for the new `data_lifecycle` module
-- descriptor (src/modules/data-lifecycle/module.ts), ADR-0037. Ported from
-- awcms-micro migration 058 (rename `awcms_micro_permissions` ->
-- `awcms_permissions`). Verbatim match to
-- `src/modules/data-lifecycle/domain/data-lifecycle-permissions.ts`'s
-- `DATA_LIFECYCLE_PERMISSIONS` (single source of truth reused by `module.ts`'s
-- `permissions` array and every route handler's `authorizeInTransaction`
-- guard). `legal_hold.create` and `legal_hold.release` are deliberately separate
-- permissions — see that file's own header comment for why ("default-deny
-- release"); the `data_lifecycle.legal_hold_maker_checker` SoD rule enforces the
-- pairing as a maker/checker conflict.
--
-- Extends the global ABAC permission catalog only, no roles/access-assignments
-- wired here. Only tenants created AFTER this migration runs pick these up
-- automatically via the setup bootstrap's
-- `INSERT INTO awcms_role_permissions ... SELECT ... FROM awcms_permissions`
-- (same limitation every prior permission-seed migration has).
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('data_lifecycle', 'registry', 'read', 'Read the high-volume table lifecycle registry (code-declared metadata only, never row contents)'),
  ('data_lifecycle', 'legal_hold', 'read', 'Read legal hold records'),
  ('data_lifecycle', 'legal_hold', 'create', 'Create a legal hold'),
  ('data_lifecycle', 'legal_hold', 'release', 'Release (end) an active legal hold'),
  ('data_lifecycle', 'plan', 'analyze', 'Trigger an on-demand, read-only dry-run lifecycle plan'),
  ('data_lifecycle', 'runs', 'read', 'Read lifecycle run history (aggregated counts only)')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
