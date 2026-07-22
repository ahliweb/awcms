-- `blog_content` module — permission catalog seed for the
-- presentation/monetization features (templates, menus, widgets, ads,
-- theme). Ported from awcms-mini migration 030. One `read` + one
-- `configure` permission per resource — these are admin-configured
-- master/config data, not lifecycle-managed content like posts (no
-- publish/schedule/restore/purge concept applies here). No implicit role
-- grants; assignable through the existing Access & Users management
-- (RBAC/ABAC), same as every other module's permission seed.
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('blog_content', 'templates', 'read', 'Read blog presentation templates'),
  ('blog_content', 'templates', 'configure', 'Create, update, or delete blog presentation templates'),
  ('blog_content', 'menus', 'read', 'Read blog navigation menus'),
  ('blog_content', 'menus', 'configure', 'Create, update, or delete blog navigation menus'),
  ('blog_content', 'widgets', 'read', 'Read blog widgets'),
  ('blog_content', 'widgets', 'configure', 'Create, update, or delete blog widgets'),
  ('blog_content', 'ads', 'read', 'Read blog advertisements'),
  ('blog_content', 'ads', 'configure', 'Create, update, or delete blog advertisements'),
  ('blog_content', 'theme', 'read', 'Read blog theme mode setting'),
  ('blog_content', 'theme', 'configure', 'Update blog theme mode setting')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
