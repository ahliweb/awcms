import { createClientFromEnv } from '../lib/supabase';
import type { MenuItemDTO } from '../types/MenuDTO';

const DEFAULT_HEADER_MENU: MenuItemDTO[] = [
    { label: 'Home', url: '/' },
    { label: 'About', url: '/about' },
    { label: 'Contact', url: '/contact' }
];

const DEFAULT_FOOTER_MENU: MenuItemDTO[] = [
    { label: 'Privacy', url: '/privacy' },
    { label: 'Terms', url: '/terms' }
];

export async function getMenu(tenantId: string, position: 'header' | 'footer', env: any = {}): Promise<MenuItemDTO[]> {
    const supabase = createClientFromEnv(env);
    if (!supabase) return position === 'header' ? DEFAULT_HEADER_MENU : DEFAULT_FOOTER_MENU;

    const { data, error } = await supabase
        .from('menus')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('position', position)
        .maybeSingle();

    if (error || !data) {
        return position === 'header' ? DEFAULT_HEADER_MENU : DEFAULT_FOOTER_MENU;
    }

    // Assuming data.items is the JSON array of items
    return (data.items as unknown as MenuItemDTO[]) || [];
}
