-- form_drafts — permission catalog seed for the new `form_drafts` module
-- descriptor (src/modules/form-drafts/module.ts). Ported from the permission
-- block of awcms-micro migration 019, split out into its own migration to
-- match this repo's schema-then-permissions convention (see 055/056, 057/058,
-- 060/061). Verbatim match to
-- `src/modules/form-drafts/domain/form-draft-permissions.ts`'s
-- `FORM_DRAFT_PERMISSIONS` — the single source of truth reused by `module.ts`'s
-- `permissions` array and by every route handler's `authorizeInTransaction`
-- guard, so the catalog, the descriptor, and the guards cannot drift.
--
-- There is deliberately no separate `submit` action: submitting is a state
-- transition on a draft you may already edit, so `POST /{id}/submit` guards on
-- `draft.update`. Adding a `submit` action would also mean widening the
-- `AccessAction` union, and an action nobody seeds into a role is a
-- latent-authz trap — it denies even the owner while looking correct.
--
-- Extends the global ABAC permission catalog only; no roles or
-- access-assignments are wired here. Only tenants created AFTER this migration
-- runs pick these up automatically via the setup bootstrap's
-- `INSERT INTO awcms_role_permissions ... SELECT ... FROM awcms_permissions`.
-- EXISTING tenants must be backfilled explicitly — every prior permission-seed
-- migration shares this limitation, and a tenant that misses the backfill gets
-- a bare 403 with nothing pointing at the cause.
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('form_drafts', 'draft', 'read', 'Read own tenant form drafts'),
  ('form_drafts', 'draft', 'create', 'Create a form draft'),
  ('form_drafts', 'draft', 'update', 'Update or submit a form draft'),
  ('form_drafts', 'draft', 'delete', 'Delete (abandon) a form draft')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
