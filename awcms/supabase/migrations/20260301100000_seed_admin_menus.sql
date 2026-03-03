-- Seed admin menus
DO $$
DECLARE
    item record;
BEGIN
    FOR item IN (
        SELECT * FROM (VALUES
        ('home', 'Dashboard', 'home', 'LayoutDashboard', NULL, 'CONTENT', 10, 10, true),
        ('blogs', 'Blogs', 'blogs', 'FileText', 'tenant.blog.read', 'CONTENT', 10, 20, true),
        ('pages', 'Pages', 'pages', 'FileEdit', 'tenant.page.read', 'CONTENT', 10, 30, true),
        ('visual_builder', 'Visual Builder', 'visual-pages', 'Layout', 'tenant.visual_pages.read', 'CONTENT', 10, 35, true),
        ('themes', 'Themes', 'themes', 'Palette', 'tenant.theme.read', 'CONTENT', 10, 40, true),
        ('widgets', 'Widgets', 'widgets', 'Layers', 'tenant.widgets.read', 'CONTENT', 10, 45, true),
        ('portfolio', 'Portfolio', 'portfolio', 'Briefcase', 'tenant.portfolio.read', 'CONTENT', 10, 50, true),
        ('testimonials', 'Testimonials', 'testimonies', 'MessageSquareQuote', 'tenant.testimonies.read', 'CONTENT', 10, 60, true),
        ('announcements', 'Announcements', 'announcements', 'Megaphone', 'tenant.announcements.read', 'CONTENT', 10, 70, true),
        ('promotions', 'Promotions', 'promotions', 'Tag', 'tenant.promotions.read', 'CONTENT', 10, 80, true),
        ('contact_messages', 'Contact Messages', 'messages', 'Inbox', 'tenant.contact_messages.read', 'CONTENT', 10, 90, true),
        ('contacts', 'Contacts CRM', 'contacts', 'Contact', 'tenant.contacts.read', 'CONTENT', 10, 95, true),
        ('files', 'Media Library', 'files', 'FolderOpen', 'tenant.files.read', 'MEDIA', 20, 10, true),
        ('photo_gallery', 'Photo Gallery', 'photo-gallery', 'Image', 'tenant.photo_gallery.read', 'MEDIA', 20, 20, true),
        ('video_gallery', 'Video Gallery', 'video-gallery', 'Video', 'tenant.video_gallery.read', 'MEDIA', 20, 30, true),
        ('products', 'Products', 'products', 'Package', 'tenant.products.read', 'COMMERCE', 30, 10, true),
        ('product_types', 'Product Types', 'product-types', 'Box', 'tenant.product_types.read', 'COMMERCE', 30, 20, true),
        ('orders', 'Orders', 'orders', 'ShoppingCart', 'tenant.orders.read', 'COMMERCE', 30, 30, true),
        ('menus', 'Menu Manager', 'menus', 'Menu', 'tenant.menu.read', 'NAVIGATION', 40, 10, true),
        ('categories', 'Categories', 'categories', 'FolderTree', 'tenant.categories.read', 'NAVIGATION', 40, 20, true),
        ('tags', 'Tags', 'tags', 'Hash', 'tenant.tag.read', 'NAVIGATION', 40, 30, true),
        ('users', 'Users', 'users', 'Users', 'tenant.user.read', 'USERS', 50, 10, true),
        ('roles', 'Roles & Permissions', 'roles', 'Shield', 'tenant.role.read', 'USERS', 50, 20, true),
        ('policies', 'Policies', 'policies', 'ShieldCheck', 'tenant.policy.read', 'USERS', 50, 30, true),
        ('seo_manager', 'SEO Manager', 'seo', 'Search', 'tenant.seo.read', 'SYSTEM', 60, 10, true),
        ('languages', 'Languages', 'languages', 'Languages', 'tenant.languages.read', 'SYSTEM', 60, 20, true),
        ('extensions', 'Extensions', 'extensions', 'Puzzle', 'platform.extensions.read', 'SYSTEM', 60, 30, true),
        ('modules', 'Modules', 'modules', 'Box', 'tenant.modules.read', 'SYSTEM', 60, 35, true),
        ('sidebar_manager', 'Sidebar Manager', 'admin-navigation', 'List', 'platform.sidebar.read', 'SYSTEM', 60, 40, true),
        ('notifications', 'Notifications', 'notifications', 'MessageSquareQuote', 'tenant.notification.read', 'SYSTEM', 60, 50, true),
        ('visitor_stats', 'Visitor Statistics', 'visitor-stats', 'LineChart', 'tenant.analytics.read', 'SYSTEM', 60, 65, true)
        ) AS v(key, label, path, icon, permission, group_label, group_order, "order", is_visible)
    )
    LOOP
        IF EXISTS (SELECT 1 FROM public.admin_menus WHERE key = item.key::text AND tenant_id IS NULL) THEN
            UPDATE public.admin_menus
            SET label = item.label::text,
                path = item.path::text,
                icon = item.icon::text,
                permission = item.permission::text,
                group_label = item.group_label::text,
                group_order = item.group_order::integer,
                "order" = item."order"::integer,
                is_visible = item.is_visible::boolean,
                updated_at = NOW()
            WHERE key = item.key::text AND tenant_id IS NULL;
        ELSE
            INSERT INTO public.admin_menus (key, label, path, icon, permission, group_label, group_order, "order", is_visible, updated_at)
            VALUES (item.key::text, item.label::text, item.path::text, item.icon::text, item.permission::text, item.group_label::text, item.group_order::integer, item."order"::integer, item.is_visible::boolean, NOW());
        END IF;
    END LOOP;
END $$;
