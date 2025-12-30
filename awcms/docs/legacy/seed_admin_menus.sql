-- Reset and seed admin_menus with correct data matching existing routes
-- First, clear the table
TRUNCATE TABLE admin_menus;

-- Insert menu items that match actual routes in MainRouter.jsx
INSERT INTO admin_menus (key, label, path, icon, permission, group_label, group_order, "order", is_visible, created_at, updated_at)
VALUES
  -- CONTENT Group
  ('files', 'Media Library', 'files', 'FolderOpen', 'view_files', 'CONTENT', 10, 10, true, NOW(), NOW()),
  ('articles', 'Articles', 'articles', 'FileText', 'view_articles', 'CONTENT', 10, 20, true, NOW(), NOW()),
  ('pages', 'Pages', 'pages', 'FileEdit', 'view_pages', 'CONTENT', 10, 30, true, NOW(), NOW()),
  ('products', 'Products', 'products', 'Package', 'view_products', 'CONTENT', 10, 40, true, NOW(), NOW()),
  ('product_types', 'Product Types', 'product-types', 'Box', 'view_product_types', 'CONTENT', 10, 50, true, NOW(), NOW()),
  ('portfolio', 'Portfolio', 'portfolio', 'Briefcase', 'view_portfolio', 'CONTENT', 10, 60, true, NOW(), NOW()),
  ('testimonies', 'Testimonials', 'testimonies', 'MessageSquareQuote', 'view_testimonials', 'CONTENT', 10, 70, true, NOW(), NOW()),
  ('announcements', 'Announcements', 'announcements', 'Megaphone', 'view_announcements', 'CONTENT', 10, 80, true, NOW(), NOW()),
  ('promotions', 'Promotions', 'promotions', 'Tag', 'view_promotions', 'CONTENT', 10, 90, true, NOW(), NOW()),
  ('photo_gallery', 'Photo Gallery', 'photo-gallery', 'Image', 'view_photo_galleries', 'CONTENT', 10, 100, true, NOW(), NOW()),
  ('video_gallery', 'Video Gallery', 'video-gallery', 'Video', 'view_video_galleries', 'CONTENT', 10, 110, true, NOW(), NOW()),
  ('contacts', 'Locations & Contacts', 'contacts', 'MapPin', 'view_contacts', 'CONTENT', 10, 120, true, NOW(), NOW()),
  ('inbox', 'Inbox', 'inbox', 'Inbox', 'view_inbox', 'CONTENT', 10, 130, true, NOW(), NOW()),
  ('menus', 'Menu Public', 'menus', 'Menu', 'view_menus', 'CONTENT', 10, 140, true, NOW(), NOW()),
  ('categories', 'Categories', 'categories', 'FolderTree', 'view_categories', 'CONTENT', 10, 150, true, NOW(), NOW()),
  ('tags', 'Tags', 'tags', 'Hash', 'view_tags', 'CONTENT', 10, 160, true, NOW(), NOW()),
  ('themes', 'Themes', 'themes', 'Palette', 'view_themes', 'CONTENT', 10, 170, true, NOW(), NOW()),

  -- CMS Group  
  ('seo_manager', 'SEO Manager', 'seo', 'Search', 'manage_seo', 'CMS', 20, 10, true, NOW(), NOW()),
  ('sso', 'SSO & Security', 'sso', 'Lock', 'manage_sso', 'CMS', 20, 20, true, NOW(), NOW()),
  ('languages', 'Languages', 'languages', 'Languages', 'manage_languages', 'CMS', 20, 30, true, NOW(), NOW()),
  ('extensions', 'Extensions', 'extensions', 'Puzzle', 'view_extensions', 'CMS', 20, 40, true, NOW(), NOW()),
  ('sidebar_admin', 'Sidebar Admin', 'admin-navigation', 'List', 'manage_admin_menu', 'CMS', 20, 50, true, NOW(), NOW()),

  -- USERS Group
  ('users', 'Users', 'users', 'Users', 'view_users', 'USERS', 30, 10, true, NOW(), NOW()),
  ('roles', 'Roles & Permissions', 'roles', 'Shield', 'view_roles', 'USERS', 30, 20, true, NOW(), NOW()),

  -- SYSTEM Group
  ('notifications', 'Notifications', 'notifications', 'MessageSquareQuote', 'view_notifications', 'SYSTEM', 100, 10, true, NOW(), NOW());
