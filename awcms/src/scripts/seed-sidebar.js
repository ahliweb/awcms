import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Load .env then .env.local (override)
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local', override: true });

// Load env vars
const supabaseUrl = process.env.VITE_SUPABASE_URL;
// Use Secret Key for seeding
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !supabaseSecretKey) {
    console.error('Missing VITE_SUPABASE_URL or SUPABASE_SECRET_KEY environment variables.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseSecretKey);

const DEFAULT_MENU_CONFIG = [
    // CONTENT Group
    { id: 'home', key: 'home', label: 'Dashboard', path: 'home', icon: 'LayoutDashboard', permission: null, group_label: 'CONTENT', group_order: 10, order: 10, is_visible: true },
    { id: 'blogs', key: 'blogs', label: 'Blogs', path: 'blogs', icon: 'FileText', permission: 'tenant.blog.read', group_label: 'CONTENT', group_order: 10, order: 20, is_visible: true },
    { id: 'pages', key: 'pages', label: 'Pages', path: 'pages', icon: 'FileEdit', permission: 'tenant.page.read', group_label: 'CONTENT', group_order: 10, order: 30, is_visible: true },
    { id: 'visual_builder', key: 'visual_builder', label: 'Visual Builder', path: 'visual-pages', icon: 'Layout', permission: 'tenant.visual_pages.read', group_label: 'CONTENT', group_order: 10, order: 35, is_visible: true },
    { id: 'themes', key: 'themes', label: 'Themes', path: 'themes', icon: 'Palette', permission: 'tenant.theme.read', group_label: 'CONTENT', group_order: 10, order: 40, is_visible: true },
    { id: 'widgets', key: 'widgets', label: 'Widgets', path: 'widgets', icon: 'Layers', permission: 'tenant.widgets.read', group_label: 'CONTENT', group_order: 10, order: 45, is_visible: true },
    { id: 'portfolio', key: 'portfolio', label: 'Portfolio', path: 'portfolio', icon: 'Briefcase', permission: 'tenant.portfolio.read', group_label: 'CONTENT', group_order: 10, order: 50, is_visible: true },
    { id: 'testimonials', key: 'testimonials', label: 'Testimonials', path: 'testimonies', icon: 'MessageSquareQuote', permission: 'tenant.testimonies.read', group_label: 'CONTENT', group_order: 10, order: 60, is_visible: true },
    { id: 'announcements', key: 'announcements', label: 'Announcements', path: 'announcements', icon: 'Megaphone', permission: 'tenant.announcements.read', group_label: 'CONTENT', group_order: 10, order: 70, is_visible: true },
    { id: 'promotions', key: 'promotions', label: 'Promotions', path: 'promotions', icon: 'Tag', permission: 'tenant.promotions.read', group_label: 'CONTENT', group_order: 10, order: 80, is_visible: true },
    { id: 'contact_messages', key: 'contact_messages', label: 'Contact Messages', path: 'messages', icon: 'Inbox', permission: 'tenant.contact_messages.read', group_label: 'CONTENT', group_order: 10, order: 90, is_visible: true },
    { id: 'contacts', key: 'contacts', label: 'Contacts CRM', path: 'contacts', icon: 'Contact', permission: 'tenant.contacts.read', group_label: 'CONTENT', group_order: 10, order: 95, is_visible: true },

    // MEDIA Group
    { id: 'files', key: 'files', label: 'Media Library', path: 'files', icon: 'FolderOpen', permission: 'tenant.files.read', group_label: 'MEDIA', group_order: 20, order: 10, is_visible: true },
    { id: 'photo_gallery', key: 'photo_gallery', label: 'Photo Gallery', path: 'photo-gallery', icon: 'Image', permission: 'tenant.photo_gallery.read', group_label: 'MEDIA', group_order: 20, order: 20, is_visible: true },
    { id: 'video_gallery', key: 'video_gallery', label: 'Video Gallery', path: 'video-gallery', icon: 'Video', permission: 'tenant.video_gallery.read', group_label: 'MEDIA', group_order: 20, order: 30, is_visible: true },

    // COMMERCE Group
    { id: 'products', key: 'products', label: 'Products', path: 'products', icon: 'Package', permission: 'tenant.products.read', group_label: 'COMMERCE', group_order: 30, order: 10, is_visible: true },
    { id: 'product_types', key: 'product_types', label: 'Product Types', path: 'product-types', icon: 'Box', permission: 'tenant.product_types.read', group_label: 'COMMERCE', group_order: 30, order: 20, is_visible: true },
    { id: 'orders', key: 'orders', label: 'Orders', path: 'orders', icon: 'ShoppingCart', permission: 'tenant.orders.read', group_label: 'COMMERCE', group_order: 30, order: 30, is_visible: true },

    // NAVIGATION Group
    { id: 'menus', key: 'menus', label: 'Menu Manager', path: 'menus', icon: 'Menu', permission: 'tenant.menu.read', group_label: 'NAVIGATION', group_order: 40, order: 10, is_visible: true },
    { id: 'categories', key: 'categories', label: 'Categories', path: 'categories', icon: 'FolderTree', permission: 'tenant.categories.read', group_label: 'NAVIGATION', group_order: 40, order: 20, is_visible: true },
    { id: 'tags', key: 'tags', label: 'Tags', path: 'tags', icon: 'Hash', permission: 'tenant.tag.read', group_label: 'NAVIGATION', group_order: 40, order: 30, is_visible: true },

    // USERS Group
    { id: 'users', key: 'users', label: 'Users', path: 'users', icon: 'Users', permission: 'tenant.user.read', group_label: 'USERS', group_order: 50, order: 10, is_visible: true },
    { id: 'roles', key: 'roles', label: 'Roles & Permissions', path: 'roles', icon: 'Shield', permission: 'tenant.role.read', group_label: 'USERS', group_order: 50, order: 20, is_visible: true },
    { id: 'policies', key: 'policies', label: 'Policies', path: 'policies', icon: 'ShieldCheck', permission: 'tenant.policy.read', group_label: 'USERS', group_order: 50, order: 30, is_visible: true },

    // SYSTEM Group
    { id: 'seo_manager', key: 'seo_manager', label: 'SEO Manager', path: 'seo', icon: 'Search', permission: 'tenant.seo.read', group_label: 'SYSTEM', group_order: 60, order: 10, is_visible: true },
    { id: 'languages', key: 'languages', label: 'Languages', path: 'languages', icon: 'Languages', permission: 'tenant.languages.read', group_label: 'SYSTEM', group_order: 60, order: 20, is_visible: true },
    { id: 'extensions', key: 'extensions', label: 'Extensions', path: 'extensions', icon: 'Puzzle', permission: 'platform.extensions.read', group_label: 'SYSTEM', group_order: 60, order: 30, is_visible: true },
    { id: 'modules', key: 'modules', label: 'Modules', path: 'modules', icon: 'Box', permission: 'platform.module.read', group_label: 'SYSTEM', group_order: 60, order: 35, is_visible: true },
    { id: 'sidebar_manager', key: 'sidebar_manager', label: 'Sidebar Manager', path: 'admin-navigation', icon: 'List', permission: 'platform.sidebar.read', group_label: 'SYSTEM', group_order: 60, order: 40, is_visible: true },
    { id: 'notifications', key: 'notifications', label: 'Notifications', path: 'notifications', icon: 'MessageSquareQuote', permission: 'tenant.notification.read', group_label: 'SYSTEM', group_order: 60, order: 50, is_visible: true },
    { id: 'audit_logs', key: 'audit_logs', label: 'Audit Logs', path: 'audit-logs', icon: 'FileClock', permission: 'tenant.audit.read', group_label: 'SYSTEM', group_order: 60, order: 60, is_visible: true },
    { id: 'visitor_stats', key: 'visitor_stats', label: 'Visitor Statistics', path: 'visitor-stats', icon: 'LineChart', permission: 'tenant.analytics.read', group_label: 'SYSTEM', group_order: 60, order: 65, is_visible: true },

    // CONFIGURATION Group
    { id: 'settings_general', key: 'settings_general', label: 'General Settings', path: 'settings/general', icon: 'Settings', permission: 'tenant.setting.read', group_label: 'CONFIGURATION', group_order: 70, order: 5, is_visible: true },
    { id: 'settings_branding', key: 'branding', label: 'Branding', path: 'settings/branding', icon: 'Palette', permission: 'tenant.setting.update', group_label: 'CONFIGURATION', group_order: 70, order: 10, is_visible: true },
    { id: 'sso', key: 'sso', label: 'SSO & Security', path: 'sso', icon: 'Lock', permission: 'tenant.sso.read', group_label: 'CONFIGURATION', group_order: 70, order: 20, is_visible: true },
    { id: 'email_settings', key: 'email_settings', label: 'Email Settings', path: 'email-settings', icon: 'Mail', permission: 'tenant.setting.update', group_label: 'CONFIGURATION', group_order: 70, order: 30, is_visible: true },
    { id: 'email_logs', key: 'email_logs', label: 'Email Logs', path: 'email-logs', icon: 'MailOpen', permission: 'tenant.setting.read', group_label: 'CONFIGURATION', group_order: 70, order: 40, is_visible: true },

    // IoT Group
    { id: 'iot_devices', key: 'iot_devices', label: 'IoT Devices', path: 'devices', icon: 'Cpu', permission: 'tenant.iot.read', group_label: 'IoT', group_order: 80, order: 10, is_visible: true },

    // MOBILE Group
    { id: 'mobile_users', key: 'mobile_users', label: 'Mobile Users', path: 'mobile/users', icon: 'Smartphone', permission: 'tenant.mobile_users.read', group_label: 'MOBILE', group_order: 85, order: 10, is_visible: true },
    { id: 'push_notifications', key: 'push_notifications', label: 'Push Notifications', path: 'mobile/push', icon: 'Bell', permission: 'tenant.push_notifications.read', group_label: 'MOBILE', group_order: 85, order: 20, is_visible: true },
    { id: 'mobile_config', key: 'mobile_config', label: 'App Config', path: 'mobile/config', icon: 'Settings', permission: 'tenant.mobile.update', group_label: 'MOBILE', group_order: 85, order: 30, is_visible: true },

    // PLATFORM Group
    { id: 'tenants', key: 'tenants', label: 'Tenant Management', path: 'tenants', icon: 'Building', permission: 'platform.tenant.read', group_label: 'PLATFORM', group_order: 100, order: 10, is_visible: true },
];

const PLUGINS_TO_SEED = [
    { name: 'Backup System', slug: 'backup', extension_type: 'core', is_active: true },
    { name: 'Regions Manager', slug: 'regions', extension_type: 'core', is_active: true },
    { name: 'Mailketing', slug: 'mailketing', extension_type: 'core', is_active: true },
    { name: 'Ahliweb Analytics', slug: 'awcms-ext-ahliweb-analytics', extension_type: 'core', is_active: true }
];

async function seedSidebar() {
    console.log('Seeding Sidebar...');

    // Seed Menu
    for (const item of DEFAULT_MENU_CONFIG) {
        const { id: _id, ...data } = item;
        const { error } = await supabase
            .from('admin_menus')
            .upsert({
                ...data,
                key: item.key || item.id, // Ensure key is set
                updated_at: new Date().toISOString()
            }, { onConflict: 'key' });

        if (error) {
            console.error(`Failed to seed menu ${item.label}:`, error);
        } else {
            console.log(`Seeded Menu: ${item.label}`);
        }
    }

    // Seed Extensions
    console.log('Seeding Extensions...');
    // Fetch a valid tenant ID to seed extensions for. 
    // In dev env, we grab the first tenant we find.
    const { data: tenants } = await supabase.from('tenants').select('id').limit(1);
    const infoTenantId = tenants?.[0]?.id;

    if (infoTenantId) {
        for (const plugin of PLUGINS_TO_SEED) {
            const { error } = await supabase
                .from('extensions')
                .upsert({
                    tenant_id: infoTenantId,
                    name: plugin.name,
                    slug: plugin.slug,
                    extension_type: plugin.extension_type,
                    is_active: plugin.is_active,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'slug' });

            if (error) {
                console.error(`Failed to seed extension ${plugin.name}:`, error);
            } else {
                console.log(`Seeded Extension: ${plugin.name}`);
            }
        }
    } else {
        console.warn('No tenant found to seed extensions. Skipping extension seeding.');
    }

    console.log('Seed Complete.');
}

seedSidebar();
