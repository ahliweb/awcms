import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Error: Supabase URL or Secret Key not found.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function listTenants() {
    console.log('Listing tenants...');
    const { data, error } = await supabase.from('tenants').select('*');

    if (error) {
        console.error('Error fetching tenants:', error);
    } else {
        console.log('Tenants found:', data);
    }
}

listTenants();
