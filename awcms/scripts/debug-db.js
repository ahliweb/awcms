import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env.remote
dotenv.config({ path: path.resolve(__dirname, '../.env.remote') });

const sbUrl = process.env.VITE_SUPABASE_URL;
const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!sbUrl || !sbKey) {
    console.error('Missing Supabase credentials in .env.remote');
    process.exit(1);
}

const supabase = createClient(sbUrl, sbKey);

async function run() {
    console.log('--- Checking Pages Data ---');
    const { data: pages, error: pagesError } = await supabase
        .from('pages')
        .select('slug, title, layout_data, tenant_id, editor_type')
        .in('slug', ['about', 'services', 'pricing', 'contact', 'home']);

    if (pagesError) console.error('Pages Error:', pagesError);
    else {
        console.table(pages.map(p => ({
            ...p,
            layout_data_len: p.layout_data ? JSON.stringify(p.layout_data).length : 0,
            layout_data: undefined // Don't verify log huge json
        })));
    }

    console.log('\n--- Checking All Admin Menus ---');
    const { data: menus, error: menusError } = await supabase
        .from('admin_menus')
        .select('*')

    console.log('\n--- Checking Pages Locale ---');
    const { data: pagesLocale, error: pagesLocaleError } = await supabase
        .from('pages')
        .select('slug, locale')
        .limit(5);

    if (pagesLocaleError) console.error('Pages Error:', pagesLocaleError);
    else console.table(pagesLocale);

    if (menusError) console.error('Menus Error:', menusError);
    else {
        const typo = menus.filter(m => m.label && m.label.includes('Visual Pagess'));
        console.log('Typo candidates:', typo);
        console.log('Typo search result length:', typo.length);
    }

    console.log('\n--- Checking Tenants ---');
    const { data: tenants, error: tenantsError } = await supabase
        .from('tenants')
        .select('id, name, subdomain');

    if (tenantsError) console.error('Tenants Error:', tenantsError);
    else console.table(tenants);
}

run();
