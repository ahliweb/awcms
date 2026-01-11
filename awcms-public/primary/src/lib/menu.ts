import { createClientFromEnv } from './supabase';

export interface MenuItem {
    label: string;
    url: string;
    children?: MenuItem[];
    order?: number; // Internal use for sorting
}

export async function getTenantMenus(tenantSlug: string, env: any = {}): Promise<MenuItem[]> {
    const supabase = createClientFromEnv(env);
    if (!supabase) return [];

    // 1. Get Tenant ID
    const { data: tenant } = await supabase
        .from('tenants')
        .select('id')
        .eq('slug', tenantSlug)
        .maybeSingle();

    if (!tenant) return [];

    // 2. Fetch active, public menus with page relation
    const { data: menus, error } = await supabase
        .from('menus')
        .select('id, label, url, parent_id, order, page:pages(slug)')
        .eq('tenant_id', tenant.id)
        .eq('is_active', true)
        .eq('is_public', true)
        .is('deleted_at', null)
        .order('order', { ascending: true });

    if (error || !menus) {
        console.error('Error fetching menus:', error);
        return [];
    }

    // 3. Build Tree
    // We use 'any' for the map temporarily to hold the raw DB row + children
    const menuMap: Record<string, any> = {};
    const roots: any[] = [];

    // Initialize map
    menus.forEach(item => {
        // Dynamic URL Resolution: If page is linked, use its slug.
        // Ensure consistent formatting (e.g. leading slash)
        let finalUrl = item.url;
        if (item.page && (item.page as any).slug) {
            const splitSlug = (item.page as any).slug.split('/');
            // If slug is 'home', mapping to '/' might be desired, but let's stick to standard behavior
            // Usually 'home' -> '/' handles in routing.
            // If the slug doesn't start with '/', add it.
            const rawSlug = (item.page as any).slug;
            finalUrl = rawSlug.startsWith('/') ? rawSlug : `/${rawSlug}`;
        }

        menuMap[item.id] = { ...item, url: finalUrl, children: [] };
    });

    // Build hierarchy
    menus.forEach(item => {
        const node = menuMap[item.id];
        if (item.parent_id && menuMap[item.parent_id]) {
            menuMap[item.parent_id].children.push(node);
        } else {
            roots.push(node);
        }
    });

    // Recursive sort and cleanup
    const processNodes = (nodes: any[]): MenuItem[] => {
        return nodes
            .sort((a, b) => (a.order || 0) - (b.order || 0))
            .map(node => ({
                label: node.label,
                url: node.url,
                children: node.children && node.children.length > 0
                    ? processNodes(node.children)
                    : undefined
            }));
    };

    return processNodes(roots);
}
