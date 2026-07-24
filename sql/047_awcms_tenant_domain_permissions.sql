-- tenant_domain — permission catalog seed for the `awcms_tenant_domains` table
-- (migration 046). Ported from awcms-micro migration 032. Exactly the six
-- permissions this module's `module.ts` `permissions` array declares.
-- `module_key` 'tenant_domain' and `activity_code' 'domains' are new — not
-- used by any other module's permission seed in this repo. No endpoints/roles
-- are wired to these here; this migration only extends the global ABAC
-- permission catalog, same shape as sql/042. Only tenants created AFTER this
-- migration runs pick these up automatically via the setup bootstrap's
-- `INSERT INTO awcms_role_permissions ... SELECT ... FROM awcms_permissions`
-- (same limitation every prior permission-seed migration has).
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('tenant_domain', 'domains', 'read', 'Read tenant domain/subdomain mappings'),
  ('tenant_domain', 'domains', 'create', 'Add a tenant domain/subdomain mapping'),
  ('tenant_domain', 'domains', 'update', 'Update a tenant domain/subdomain mapping'),
  ('tenant_domain', 'domains', 'delete', 'Soft delete a tenant domain/subdomain mapping'),
  ('tenant_domain', 'domains', 'verify', 'Verify ownership of a tenant domain/subdomain'),
  ('tenant_domain', 'domains', 'set_primary', 'Set a tenant domain as the active primary domain')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
