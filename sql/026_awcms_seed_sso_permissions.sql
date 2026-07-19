-- Permission catalog seed for the tenant OIDC/SSO admin endpoints (Issue #185,
-- epic ERP-readiness enterprise auth #177) over `awcms_auth_providers` /
-- `awcms_tenant_auth_policies` (sql/025). Same shape as sql/024's MFA-admin
-- seed: the guard action must exist as an `awcms_permissions` catalog row
-- BEFORE tenant bootstrap grants the owner every permission — a guard on an
-- un-seeded action would default-deny even the owner. Declaring it in
-- `identity-access/module.ts` alone is not enough; sql/005 is immutable, so the
-- rows are seeded here (idempotent).
--
-- No roles/access-assignments are wired here — tenant admins grant these via the
-- existing role management UI/API. The provider soft-delete uses the `delete`
-- action (same as office/role delete); provider create/update/read map to the
-- ordinary CRUD actions; the tenant auth policy read/update map to read/update.
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('identity_access', 'sso_providers', 'read',
   'Read tenant OIDC SSO provider configuration'),
  ('identity_access', 'sso_providers', 'create',
   'Add a tenant OIDC SSO provider'),
  ('identity_access', 'sso_providers', 'update',
   'Update a tenant OIDC SSO provider'),
  ('identity_access', 'sso_providers', 'delete',
   'Soft delete a tenant OIDC SSO provider'),
  ('identity_access', 'sso_policy', 'read',
   'Read tenant authentication policy (password/SSO/break-glass)'),
  ('identity_access', 'sso_policy', 'update',
   'Update tenant authentication policy (password/SSO/break-glass)')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
