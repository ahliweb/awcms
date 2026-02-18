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
    console.log('Connecting to Supabase...');

    // Get Tenants
    const { data: tenants, error: tenantError } = await supabase.from('tenants').select('id, name, slug').limit(5);
    if (tenantError) {
        console.error('Error fetching tenants:', tenantError);
    } else {
        console.log('Tenants:', JSON.stringify(tenants, null, 2));
    }

    // Get Pages Schema inspection
    const { data: pages, error: pageError } = await supabase.from('pages').select('*').limit(1);
    if (pageError) {
        console.error('Error fetching pages:', pageError);
    } else {
        console.log('First Page Row:', JSON.stringify(pages, null, 2));
    }
}

run();
