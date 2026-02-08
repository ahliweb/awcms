-- Rename table
ALTER TABLE IF EXISTS articles RENAME TO blogs;

-- Update Permissions
-- Updates 'tenant.article.*' to 'tenant.blog.*'
-- Updates resource 'articles' to 'blogs'
-- Updates module 'articles' to 'blogs'
-- Updates description '... articles' to '... blogs'
UPDATE permissions 
SET 
  name = replace(name, 'tenant.article.', 'tenant.blog.'),
  resource = 'blogs',
  module = 'blogs',
  description = replace(description, 'articles', 'blogs')
WHERE name LIKE 'tenant.article.%';

-- Update Admin Menus
UPDATE admin_menus
SET 
  key = 'blogs',
  path = 'blogs',
  permission = 'tenant.blog.read',
  label = 'Blogs',
  icon = 'BookOpen',
  updated_at = NOW()
WHERE key = 'articles';
