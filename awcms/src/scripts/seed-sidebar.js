import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
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

const rootDir = process.cwd();
const EXTENSION_MANIFEST_DIRS = [
    path.join(rootDir, 'src', 'extensions'),
    path.join(rootDir, '..', 'awcms-ext')
];
const PLUGIN_MANIFEST_DIR = path.join(rootDir, 'src', 'plugins');

const GROUP_LABEL_MAP = {
    content: 'CONTENT',
    media: 'MEDIA',
    commerce: 'COMMERCE',
    navigation: 'NAVIGATION',
    users: 'USERS',
    system: 'SYSTEM',
    configuration: 'CONFIGURATION',
    settings: 'CONFIGURATION',
    config: 'CONFIGURATION',
    platform: 'PLATFORM',
    mobile: 'MOBILE',
    iot: 'IoT',
    dashboard: 'CONTENT'
};

const GROUP_ORDER_MAP = {
    CONTENT: 10,
    MEDIA: 20,
    COMMERCE: 30,
    NAVIGATION: 40,
    USERS: 50,
    SYSTEM: 60,
    CONFIGURATION: 70,
    IoT: 80,
    MOBILE: 85,
    PLATFORM: 100
};

const normalizeMenuPath = (value) => {
    if (!value) return '';
    return value.replace(/^\/?admin\/?/, '').replace(/^\//, '');
};

const loadExtensionManifests = () => {
    const manifests = new Map();

    EXTENSION_MANIFEST_DIRS.forEach((baseDir) => {
        if (!fs.existsSync(baseDir)) return;
        const entries = fs.readdirSync(baseDir, { withFileTypes: true });
        entries.forEach((entry) => {
            if (!entry.isDirectory()) return;
            const manifestPath = path.join(baseDir, entry.name, 'manifest.json');
            if (!fs.existsSync(manifestPath)) return;
            try {
                const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                if (!manifest?.vendor || !manifest?.slug) return;
                const key = `${manifest.vendor}:${manifest.slug}`;
                if (!manifests.has(key)) {
                    manifests.set(key, { ...manifest, __source: manifestPath });
                }
            } catch (error) {
                console.warn(`Failed to parse manifest at ${manifestPath}:`, error.message);
            }
        });
    });

    return Array.from(manifests.values());
};

const loadPluginManifests = () => {
    if (!fs.existsSync(PLUGIN_MANIFEST_DIR)) return [];

    const manifests = [];
    const entries = fs.readdirSync(PLUGIN_MANIFEST_DIR, { withFileTypes: true });
    entries.forEach((entry) => {
        if (!entry.isDirectory()) return;
        const manifestPath = path.join(PLUGIN_MANIFEST_DIR, entry.name, 'plugin.json');
        if (!fs.existsSync(manifestPath)) return;
        try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            if (!manifest?.slug) return;
            manifests.push({ ...manifest, __source: manifestPath });
        } catch (error) {
            console.warn(`Failed to parse plugin manifest at ${manifestPath}:`, error.message);
        }
    });

    return manifests;
};

const slugify = (value) => {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
};

const normalizeGroupLabel = (value) => {
    if (!value) return 'SYSTEM';
    const trimmed = String(value).trim();
    if (!trimmed) return 'SYSTEM';
    const mapped = GROUP_LABEL_MAP[trimmed.toLowerCase()];
    return mapped || trimmed;
};

const resolveGroupMeta = (value, fallbackOrder) => {
    const label = normalizeGroupLabel(value);
    const order = GROUP_ORDER_MAP[label] ?? fallbackOrder ?? 999;
    return { label, order };
};

const buildExtensionSlug = (manifest) => {
    if (manifest?.vendor && manifest?.slug) {
        return `awcms-ext-${manifest.vendor}-${manifest.slug}`;
    }
    if (manifest?.slug) return manifest.slug;
    return null;
};

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

async function seedExtensionMenus(infoTenantId) {
    const manifests = loadExtensionManifests();
    if (!manifests.length) {
        console.log('No extension manifests found to seed menus.');
        return;
    }

    for (const manifest of manifests) {
        if (!manifest.menu) continue;

        const extensionSlug = buildExtensionSlug(manifest);
        if (!extensionSlug) {
            console.warn(`Skipping manifest with missing slug/vendor: ${manifest.name || 'Unknown'}`);
            continue;
        }

        const menuPath = normalizeMenuPath(manifest.menu.path);
        if (!menuPath) {
            console.warn(`Skipping menu with empty path for ${manifest.name || extensionSlug}`);
            continue;
        }

        const { data: existingExtension, error: extensionFetchError } = await supabase
            .from('extensions')
            .select('id, tenant_id, extension_type')
            .eq('tenant_id', infoTenantId)
            .eq('slug', extensionSlug)
            .maybeSingle();

        if (extensionFetchError) {
            console.error(`Failed to fetch extension ${extensionSlug}:`, extensionFetchError);
            continue;
        }

        const now = new Date().toISOString();
        let extensionId = existingExtension?.id;
        let tenantId = existingExtension?.tenant_id || infoTenantId;

        const extensionPayload = {
            tenant_id: tenantId,
            name: manifest.name || extensionSlug,
            slug: extensionSlug,
            description: manifest.description || null,
            version: manifest.version || '1.0.0',
            author: manifest.author || null,
            manifest,
            is_active: true,
            updated_at: now
        };

        if (extensionId) {
            const { error: updateError } = await supabase
                .from('extensions')
                .update(extensionPayload)
                .eq('id', extensionId);
            if (updateError) {
                console.error(`Failed to update extension ${extensionSlug}:`, updateError);
                continue;
            }
        } else {
            const { data: inserted, error: insertError } = await supabase
                .from('extensions')
                .insert({
                    ...extensionPayload,
                    extension_type: manifest.type || 'external',
                    is_system: false,
                    created_at: now
                })
                .select('id, tenant_id')
                .single();
            if (insertError) {
                console.error(`Failed to insert extension ${extensionSlug}:`, insertError);
                continue;
            }
            extensionId = inserted?.id;
            tenantId = inserted?.tenant_id;
        }

        if (!extensionId) {
            console.warn(`Extension ${extensionSlug} missing id; skipping menu seed.`);
            continue;
        }

        const { data: existingMenu, error: menuFetchError } = await supabase
            .from('extension_menu_items')
            .select('id')
            .eq('extension_id', extensionId)
            .eq('path', menuPath)
            .maybeSingle();

        if (menuFetchError) {
            console.error(`Failed to fetch menu for ${extensionSlug}:`, menuFetchError);
            continue;
        }

        const menuPayload = {
            extension_id: extensionId,
            label: manifest.menu.label,
            path: menuPath,
            icon: manifest.menu.icon || 'Puzzle',
            order: manifest.menu.order || 90,
            is_active: true,
            tenant_id: tenantId,
            updated_at: now
        };

        if (existingMenu?.id) {
            const { error: menuUpdateError } = await supabase
                .from('extension_menu_items')
                .update(menuPayload)
                .eq('id', existingMenu.id);
            if (menuUpdateError) {
                console.error(`Failed to update menu for ${extensionSlug}:`, menuUpdateError);
            } else {
                console.log(`Updated Extension Menu: ${manifest.menu.label}`);
            }
        } else {
            const { error: menuInsertError } = await supabase
                .from('extension_menu_items')
                .insert({
                    ...menuPayload,
                    created_at: now
                });
            if (menuInsertError) {
                console.error(`Failed to insert menu for ${extensionSlug}:`, menuInsertError);
            } else {
                console.log(`Seeded Extension Menu: ${manifest.menu.label}`);
            }
        }
    }
}

async function seedPluginMenus() {
    const manifests = loadPluginManifests();
    if (!manifests.length) return;

    const { data: existingMenus, error: existingError } = await supabase
        .from('admin_menus')
        .select('id, key, path');

    if (existingError) {
        console.error('Failed to fetch admin menus for plugin seeding:', existingError);
        return;
    }

    const existingKeys = new Set((existingMenus || []).map(item => item.key));
    const existingPaths = new Set((existingMenus || []).map(item => normalizeMenuPath(item.path)));

    for (const manifest of manifests) {
        if (!manifest.menu || !manifest.slug) continue;

        const menu = manifest.menu;
        const label = menu.label || menu.title || manifest.name || manifest.slug;
        const path = normalizeMenuPath(menu.path || '');
        if (!path) continue;

        if (existingKeys.has(manifest.slug) || existingPaths.has(path)) {
            continue;
        }

        const rawGroup = menu.group || menu.parent || menu.section || 'SYSTEM';
        const { label: groupLabel, order: groupOrder } = resolveGroupMeta(rawGroup, menu.group_order);

        const now = new Date().toISOString();
        const payload = {
            key: manifest.slug,
            label,
            path,
            icon: menu.icon || 'Puzzle',
            permission: menu.permission || null,
            group_label: groupLabel,
            group_order: groupOrder,
            order: menu.order || 90,
            is_visible: true,
            created_at: now,
            updated_at: now
        };

        const { error } = await supabase
            .from('admin_menus')
            .insert(payload);

        if (error) {
            console.error(`Failed to seed plugin menu ${manifest.slug}:`, error);
        } else {
            console.log(`Seeded Plugin Menu: ${label}`);
            existingKeys.add(manifest.slug);
            existingPaths.add(path);
        }
    }
}

async function seedModulesForTenants(tenantIds) {
    if (!tenantIds?.length) return;

    const { data: coreMenus, error: coreMenuError } = await supabase
        .from('admin_menus')
        .select('key, label, path, is_visible');

    if (coreMenuError) {
        console.error('Failed to fetch admin menus for module seeding:', coreMenuError);
        return;
    }

    const { data: extMenus, error: extMenuError } = await supabase
        .from('extension_menu_items')
        .select('label, path, is_active, extension:extensions(slug, name, is_active, deleted_at)')
        .is('deleted_at', null);

    if (extMenuError) {
        console.error('Failed to fetch extension menus for module seeding:', extMenuError);
        return;
    }

    const now = new Date().toISOString();
    const menuItems = (coreMenus || [])
        .filter(item => item?.key && !item.key.startsWith('group_placeholder_'))
        .map(item => ({
            name: item.label || item.key,
            slug: item.key,
            description: null,
            status: item.is_visible === false ? 'inactive' : 'active'
        }));

    const extensionItems = (extMenus || [])
        .filter(item => item.extension?.is_active && !item.extension?.deleted_at)
        .map(item => {
            const menuPath = normalizeMenuPath(item.path);
            const slugSuffix = slugify(menuPath || item.label || 'menu');
            const extensionSlug = item.extension?.slug || 'extension';
            return {
                name: item.label || `${item.extension?.name || 'Extension'} Menu`,
                slug: `ext-${extensionSlug}-${slugSuffix}`,
                description: item.extension?.name ? `Extension: ${item.extension.name}` : null,
                status: item.is_active === false ? 'inactive' : 'active'
            };
        });

    const moduleEntries = [...menuItems, ...extensionItems];
    const moduleSlugs = new Set(moduleEntries.map(entry => entry.slug));

    for (const tenantId of tenantIds) {
        if (!tenantId) continue;

        const upserts = moduleEntries.map(entry => ({
            tenant_id: tenantId,
            name: entry.name,
            slug: entry.slug,
            description: entry.description,
            status: entry.status,
            updated_at: now
        }));

        if (upserts.length > 0) {
            const { error } = await supabase
                .from('modules')
                .upsert(upserts, { onConflict: 'tenant_id,slug' });

            if (error) {
                console.error(`Failed to seed modules for tenant ${tenantId}:`, error);
            } else {
                console.log(`Seeded Modules (${upserts.length}) for tenant ${tenantId}`);
            }
        }

        const { data: existingModules, error: existingError } = await supabase
            .from('modules')
            .select('id, slug')
            .eq('tenant_id', tenantId);

        if (existingError) {
            console.error(`Failed to fetch modules for tenant ${tenantId}:`, existingError);
            continue;
        }

        const staleIds = (existingModules || [])
            .filter(module => !moduleSlugs.has(module.slug))
            .map(module => module.id);

        if (staleIds.length > 0) {
            const { error: updateError } = await supabase
                .from('modules')
                .update({ status: 'inactive', updated_at: now })
                .in('id', staleIds);

            if (updateError) {
                console.error(`Failed to mark stale modules inactive for tenant ${tenantId}:`, updateError);
            }
        }
    }
}

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
    const { data: tenants } = await supabase.from('tenants').select('id');
    const tenantIds = (tenants || []).map(t => t.id).filter(Boolean);
    const infoTenantId = tenantIds[0];

    await seedPluginMenus();

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
                }, { onConflict: 'tenant_id,slug' });

            if (error) {
                console.error(`Failed to seed extension ${plugin.name}:`, error);
            } else {
                console.log(`Seeded Extension: ${plugin.name}`);
            }
        }
        await seedExtensionMenus(infoTenantId);
        await seedModulesForTenants(tenantIds);
    } else {
        console.warn('No tenant found to seed extensions. Skipping extension seeding.');
    }

    console.log('Seed Complete.');
}

seedSidebar();
