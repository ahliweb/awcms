
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load env vars
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);
const _supabaseAdmin = supabaseServiceRoleKey ? createClient(supabaseUrl, supabaseServiceRoleKey) : null;

async function verifyGuestOrder() {
    console.log('--- Verifying Guest Order Creation (RLS Check) ---');

    const orderData = {
        user_id: null, // Guest
        tenant_id: '00000000-0000-0000-0000-000000000000',
        subtotal: 1000,
        total_amount: 1000,
        status: 'pending',
        payment_status: 'unpaid',
        shipping_address: 'Test Address',
        order_number: `TEST-${Date.now()}`
    };

    const { data, error } = await supabase
        .from('orders')
        .insert(orderData)
        .select()
        .single();

    if (error) {
        console.log('Guest Order Insert Result: FAILED (Confirmed RLS restriction)');
        console.log('Error:', error.message);
    } else {
        console.log('Guest Order Insert Result: SUCCESS');
        await supabase.from('orders').delete().eq('id', data.id);
    }
}

async function verifyLatestBlogs() {
    console.log('\n--- Verifying LatestBlogsBlock Data Resolution (Anon/Public) ---');

    // 1. Test generic syntax
    console.log(`Testing query: .select('*, categories(title, slug)')`);
    const { data, error } = await supabase
        .from('blogs')
        .select('*, categories(title, slug)')
        .eq('status', 'published')
        .order('published_at', { ascending: false })
        .limit(3);

    if (error) {
        console.error('Anon Query FAILED:', error.message);
    } else {
        console.log('Anon Query SUCCEEDED');
        console.log(`Fetched ${data.length} blogs.`);
        if (data.length > 0) {
            console.log('Sample Blog:', data[0].title);
            console.log('Category:', data[0].categories?.title);
        } else {
            console.log('No blogs found (but query worked).');
        }
    }
}

async function main() {
    await verifyGuestOrder();
    await verifyLatestBlogs();
}

main();
