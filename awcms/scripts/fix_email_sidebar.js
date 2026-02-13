import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import _path from '_path';

// Load .env from current directory
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    console.error('URL:', supabaseUrl);
    console.error('KEY:', supabaseKey ? 'Found' : 'Missing');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    console.log('Inserting email sidebar menu items...');

    // Check if table exists (simple select)
    const { error: checkError } = await supabase.from('admin_menus').select('key').limit(1);
    if (checkError) {
        console.error('Error accessing admin_menus table:', checkError);
        process.exit(1);
    }

    const items = [
        {
            key: 'email_settings',
            label: 'Email Settings',
            path: 'email-settings',
            icon: 'Mail',
            permission: 'tenant.setting.update',
            group_label: 'CONFIGURATION',
            group_order: 70,
            order: 30,
            is_visible: true
        },
        {
            key: 'email_logs',
            label: 'Email Logs',
            path: 'email-logs',
            icon: 'MailOpen',
            permission: 'tenant.setting.read',
            group_label: 'CONFIGURATION',
            group_order: 70,
            order: 40,
            is_visible: true
        }
    ];

    const { data, error } = await supabase
        .from('admin_menus')
        .upsert(items, { onConflict: 'key' })
        .select();

    if (error) {
        console.error('Error inserting items:', error);
        process.exit(1);
    }

    console.log('Successfully inserted/updated items:', data);
}

run();
