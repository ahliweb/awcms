-- `seo_distribution` — permission catalog seed for the tenant SEO config admin API
-- (`GET`/`PUT /api/v1/seo/config`), ADR-0038 (discovery scope). Ported from
-- awcms-micro ADR-0028 migration 081 (rename `awcms_micro_permissions` ->
-- `awcms_permissions`). Verbatim match to
-- `src/modules/seo-distribution/domain/seo-permissions.ts`'s constants and this
-- module's own `module.ts` `permissions` array (single source of truth reused by
-- the route handler's `authorizeInTransaction` guard).
--
-- Extends the global ABAC permission catalog only, no roles/access-assignments
-- wired here. Only tenants created AFTER this migration runs pick these up
-- automatically via the setup bootstrap's
-- `INSERT INTO awcms_role_permissions ... SELECT ... FROM awcms_permissions`
-- (same limitation every prior permission-seed migration has).
--
-- ## Why `config.read` and `config.update` are separate actions
--
-- Reading the current SEO defaults and CHANGING them have different blast radii:
-- an update rewrites the public metadata surface (canonical site name, default
-- social image, and — decisively — the tenant-wide `noindex` switch that can pull
-- an entire site out of every search index). They are separately grantable so a
-- role that may audit the config need not also hold the power to change what
-- crawlers see. `config.update` is high-risk and audited
-- (`seo-distribution/application/seo-config-directory.ts` records an audit event
-- on every write); `config.read` is not.
--
-- Redirect/404 permissions (`seo_distribution.redirect.*` /
-- `seo_distribution.not_found.*`) are deliberately NOT seeded here — they belong
-- to the redirect-governance follow-up PR, whose tables and endpoints do not exist
-- yet. Seeding a permission for a route that cannot be exercised would be the
-- "descriptor claims a capability it cannot implement" anti-pattern.
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('seo_distribution', 'config', 'read', 'Read this tenant''s SEO defaults (site identity, default social image, robots policy, feed/sitemap config)'),
  ('seo_distribution', 'config', 'update', 'Update this tenant''s SEO defaults — changes the public metadata/indexability/discovery surface (high-risk, audited)')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
