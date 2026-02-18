import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'; // Standard local service role key

if (!supabaseUrl || !supabaseKey) {
    console.error('Error: Supabase URL or Secret Key not found.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

async function seedPrimaryTenant() {
    console.log('Seeding primary tenant...');

    // Check if it exists first
    const { data: existing } = await supabase.from('tenants').select('id').eq('slug', 'primary').single();
    if (existing) {
        console.log('Primary tenant already exists:', existing.id);
        return;
    }

    const { data, error } = await supabase.rpc('create_tenant_with_defaults', {
        p_name: 'Ahliweb CMS',
        p_slug: 'primary',
        p_domain: null,
        p_tier: 'enterprise',
        p_parent_tenant_id: null,
        p_role_inheritance_mode: 'auto'
    });

    if (error) {
        console.error('Error seeding primary tenant:', error);
    } else {
        console.log('Primary tenant seeded successfully:', data);
    }
}

seedPrimaryTenant();
