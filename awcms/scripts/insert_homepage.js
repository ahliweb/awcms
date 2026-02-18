import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load env vars
const envLocalPath = path.resolve(process.cwd(), '.env.local');
const envPath = path.resolve(process.cwd(), '.env');

if (fs.existsSync(envLocalPath)) {
    dotenv.config({ path: envLocalPath });
}
dotenv.config({ path: envPath });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    const tenantId = '2d5164df-52fa-4f0b-9268-0ca2b55112b8'; // Primary Tenant
    const puckJsonPath = '/home/unggul/.gemini/antigravity/brain/8b1f2452-7cf8-43c5-b298-0f4914f2abfc/homepage_puck.json';

    const puckJson = JSON.parse(fs.readFileSync(puckJsonPath, 'utf8'));

    console.log('Checking for existing Home Page for tenant:', tenantId);

    const { data: requestPage, error: reqError } = await supabase
        .from('pages')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('slug', 'home')
        .single();

    if (reqError && reqError.code !== 'PGRST116') { // PGRST116 is "not found"
        console.error('Error checking page:', reqError);
        return;
    }

    const payload = {
        tenant_id: tenantId,
        slug: 'home',
        title: 'Home',
        meta_description: 'Homepage of AWCMS',
        editor_type: 'visual',
        puck_layout_jsonb: puckJson,
        content_published: puckJson,
        status: 'published',
        is_public: true,
        is_active: true,
        published_at: new Date().toISOString()
    };

    let result;
    if (requestPage) {
        console.log('Updating existing page ID:', requestPage.id);
        result = await supabase.from('pages').update(payload).eq('id', requestPage.id).select();
    } else {
        console.log('Inserting new page...');
        result = await supabase.from('pages').insert(payload).select();
    }

    if (result.error) {
        console.error('Error upserting page:', result.error);
    } else {
        console.log('Page upserted successfully:', result.data);
    }
}

run();
