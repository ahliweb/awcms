-- `blog_content` module — core permission catalog seed. Ported from
-- awcms-mini migration 027, consolidated to this base's permission set
-- (posts, pages, taxonomies, revisions, settings, seo, search). Presentation
-- (templates/menus/widgets/ads/theme) and internal-tag-linking permissions
-- are seeded by migrations 038/040. Wires up `src/modules/blog-content/
-- module.ts`'s `permissions` declaration. No implicit role grants —
-- assignable through the existing Access & Users management (RBAC/ABAC),
-- same as every other module's permission seed.
--
-- `awcms_permissions` is a GLOBAL catalog (no tenant_id / no RLS — sql/005);
-- the unique key is `(module_key, activity_code, action)`, so this insert is
-- idempotent via `ON CONFLICT ... DO NOTHING`. Existing tenants' `owner`
-- role does NOT retroactively gain these — only tenants created after this
-- migration runs get them at setup-wizard bootstrap (which seeds owner from
-- the catalog).
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('blog_content', 'posts', 'read', 'Read blog posts'),
  ('blog_content', 'posts', 'create', 'Create blog posts'),
  ('blog_content', 'posts', 'update', 'Update blog posts'),
  ('blog_content', 'posts', 'publish', 'Publish blog posts'),
  ('blog_content', 'posts', 'schedule', 'Schedule blog posts for future publishing'),
  ('blog_content', 'posts', 'archive', 'Archive blog posts'),
  ('blog_content', 'posts', 'delete', 'Soft delete blog posts'),
  ('blog_content', 'posts', 'restore', 'Restore soft-deleted blog posts'),
  ('blog_content', 'posts', 'purge', 'Purge soft-deleted blog posts'),
  ('blog_content', 'posts', 'export', 'Export blog posts'),
  ('blog_content', 'pages', 'read', 'Read blog pages'),
  ('blog_content', 'pages', 'create', 'Create blog pages'),
  ('blog_content', 'pages', 'update', 'Update blog pages'),
  ('blog_content', 'pages', 'publish', 'Publish blog pages'),
  ('blog_content', 'pages', 'archive', 'Archive blog pages'),
  ('blog_content', 'pages', 'delete', 'Soft delete blog pages'),
  ('blog_content', 'pages', 'restore', 'Restore soft-deleted blog pages'),
  ('blog_content', 'pages', 'purge', 'Purge soft-deleted blog pages'),
  ('blog_content', 'taxonomies', 'read', 'Read blog categories and tags'),
  ('blog_content', 'taxonomies', 'configure', 'Create, update, or delete blog categories and tags'),
  ('blog_content', 'revisions', 'read', 'Read blog post/page revision history'),
  ('blog_content', 'revisions', 'restore', 'Restore a blog post/page revision'),
  ('blog_content', 'settings', 'read', 'Read blog module settings'),
  ('blog_content', 'settings', 'configure', 'Update blog module settings'),
  ('blog_content', 'seo', 'configure', 'Configure blog SEO metadata defaults'),
  ('blog_content', 'search', 'read', 'Search blog posts and pages')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
