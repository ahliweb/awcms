-- Issue #181 (epic #177, Wave 2 authorization) — permission catalog seed for
-- the SoD conflict/exception endpoints. Ported from awcms-mini migration 062
-- (`062_awcms_mini_business_scope_permissions.sql`, Issue #746), the SoD subset
-- only (the generic scope-assignment permissions were already seeded by #180's
-- `sql/028`):
--
--   * `business_scope_conflicts.read` — read the SoD conflict evaluation log.
--   * `business_scope_exceptions.read/create/approve/reject/revoke` — the
--     exception lifecycle. `create` and `approve` are DELIBERATELY separate
--     permissions (never one `.manage`): a subject who can REQUEST an exception
--     must not also be able to APPROVE one (maker/checker), the exact conflict a
--     derived application's SoD rule fixture registers.
--
-- Same shape as sql/028 (business-scope permissions seed): extends the GLOBAL
-- ABAC permission catalog under the existing `identity_access` module_key, no
-- roles/access-assignments wired here (tenant admins grant these via role
-- management). Seeding here — in addition to the module.ts descriptor — is what
-- makes the permission available to the setup-wizard bootstrap owner role at
-- first migrate (a module.ts descriptor alone is synced lazily and would leave
-- the owner default-denied until the next sync), the precedent sql/023/024/028
-- already set.
--
-- `awcms_permissions` is a GLOBAL catalog (no tenant_id / no RLS — sql/005); the
-- unique key is `(module_key, activity_code, action)`, so this insert is
-- idempotent via `ON CONFLICT ... DO NOTHING`.

INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('identity_access', 'business_scope_conflicts', 'read', 'Read segregation-of-duties conflict evaluation history'),
  ('identity_access', 'business_scope_exceptions', 'read', 'Read segregation-of-duties conflict exceptions'),
  ('identity_access', 'business_scope_exceptions', 'create', 'Request a segregation-of-duties conflict exception'),
  ('identity_access', 'business_scope_exceptions', 'approve', 'Approve a segregation-of-duties conflict exception'),
  ('identity_access', 'business_scope_exceptions', 'reject', 'Reject a segregation-of-duties conflict exception'),
  ('identity_access', 'business_scope_exceptions', 'revoke', 'Revoke a previously approved segregation-of-duties conflict exception')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
