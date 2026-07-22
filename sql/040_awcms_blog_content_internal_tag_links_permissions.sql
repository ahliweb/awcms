-- `blog_content` module — permission catalog seed for automatic internal
-- tag linking. Ported from awcms-mini migration 052. Three distinct
-- actions, deliberately kept separate from `blog_content.settings.*` (see
-- migration 039's header) so a role can be granted read/preview access to
-- this narrow concern without blanket `blog_content.settings.*` access.
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('blog_content', 'internal_links', 'read', 'Read automatic internal tag linking settings'),
  ('blog_content', 'internal_links', 'configure', 'Configure automatic internal tag linking settings'),
  ('blog_content', 'internal_links', 'preview', 'Preview automatic internal tag links for a post before publishing')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
