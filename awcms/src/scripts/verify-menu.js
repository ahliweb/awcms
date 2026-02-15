import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Load .env
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local', override: true });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !supabaseSecretKey) {
    console.error('Missing VITE_SUPABASE_URL or SUPABASE_SECRET_KEY');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseSecretKey);

async function verifyMenu() {
    console.log('--- VERIFYING ADMIN MENU ---');

    const { data: adminMenus, error: menuError } = await supabase
        .from('admin_menus')
        .select('*')
        .eq('is_visible', true);

    if (menuError) {
        console.error('Error fetching admin_menus:', menuError);
        return;
    }

    const { data: extMenus, error: extError } = await supabase
        .from('extension_menu_items')
        .select('*, extension:extensions(slug, is_active)')
        .eq('is_active', true); // Assuming active extensions only

    if (extError) {
        console.error('Error fetching extension_menu_items:', extError);
        return;
    }

    // Filter active extension menus
    const activeExtMenus = extMenus.filter(m => m.extension?.is_active);

    console.log(`Core Admin Menus: ${adminMenus.length}`);
    console.log(`Extension Menus: ${activeExtMenus.length}`);
    console.log(`Total Visible Items: ${adminMenus.length + activeExtMenus.length}`);

    // Group Analysis
    const groups = {};
    adminMenus.forEach(item => {
        const g = item.group_label || 'SYSTEM';
        groups[g] = (groups[g] || 0) + 1;
    });

    console.log('\n--- GROUP COUNTS (Core) ---');
    Object.keys(groups).forEach(g => {
        console.log(`${g}: ${groups[g]}`);
    });
    console.log(`Total Groups: ${Object.keys(groups).length}`);

    console.log('\n--- LIST OF ITEMS ---');
    adminMenus.forEach(i => console.log(`[${i.group_label}] ${i.label} (${i.key})`));
    activeExtMenus.forEach(i => console.log(`[EXTENSION] ${i.label} (${i.path})`));

}

verifyMenu();
