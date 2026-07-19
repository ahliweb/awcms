-- Issue #180 (epic #177, Wave 2 authorization) — permission catalog seed for
-- the business-scope assignment endpoints. Ported from awcms-mini migration
-- 062 (`062_awcms_mini_business_scope_permissions.sql`, Issue #746), REDUCED
-- to the generic scope-assignment permissions only:
--
--   * PORTED here (#180): `business_scope_assignments.read/create/revoke`.
--   * NOT ported (belongs to #181, segregation of duties): mini 062's
--     `business_scope_conflicts.read` and `business_scope_exceptions.*`
--     permissions — those gate the SoD conflict/exception endpoints that are
--     out of scope for #180.
--
-- Same shape as sql/026 (SSO permissions seed): extends the GLOBAL ABAC
-- permission catalog under the existing `identity_access` module_key, no
-- roles/access-assignments wired here (tenant admins grant these via the
-- existing role management UI). Seeding here — in addition to the module.ts
-- descriptor — is what makes the permission available to the setup-wizard
-- bootstrap owner role at first migrate, exactly the precedent sql/023
-- (office delete) and sql/024 (MFA admin) already set: a `module.ts`
-- permission descriptor alone is synced lazily and would leave the owner
-- default-denied until the next sync.
--
-- `awcms_permissions` is a GLOBAL catalog (no tenant_id / no RLS — sql/005);
-- the unique key is `(module_key, activity_code, action)`, so this insert is
-- idempotent via `ON CONFLICT ... DO NOTHING`.

INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('identity_access', 'business_scope_assignments', 'read', 'Read business-scope assignments for the caller''s tenant'),
  ('identity_access', 'business_scope_assignments', 'create', 'Create a business-scope assignment'),
  ('identity_access', 'business_scope_assignments', 'revoke', 'Revoke an active business-scope assignment')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
