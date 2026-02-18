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
    console.log('--- Checking RPC exec_sql ---');
    // Try to select 1
    const { data: rpcData, error: rpcError } = await supabase.rpc('exec_sql', { query: 'SELECT 1' });

    if (rpcError) {
        console.error('RPC Error:', rpcError);
        console.log('exec_sql RPC does NOT exist or is not permitted.');
    } else {
        console.log('RPC Success:', rpcData);
        console.log('exec_sql RPC EXISTS!');
    }
}

run();
