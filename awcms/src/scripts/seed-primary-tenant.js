import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

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

const { Pool } = pg;
const pool = new Pool({ connectionString });

const devControlPlaneSeedPath = path.resolve(__dirname, '../../supabase/seeds/dev_control_plane.sql');

async function applyDevControlPlaneSeed() {
    const sql = await fs.readFile(devControlPlaneSeedPath, 'utf8');
    const client = await pool.connect();

    try {
        await client.query(sql);
        console.log('Dev control-plane seed applied successfully.');
    } finally {
        client.release();
    }
}

async function ensurePrimaryTenant() {
    const { data: existing, error: existingError } = await supabase
        .from('tenants')
        .select('id')
        .eq('slug', 'primary')
        .single();

    if (existingError && existingError.code !== 'PGRST116') {
        throw existingError;
    }

    if (existing) {
        console.log('Primary tenant already exists:', existing.id);
        return existing.id;
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
        throw error;
    }

    console.log('Primary tenant seeded successfully:', data);
    return data?.id ?? null;
}

async function seedPrimaryTenant() {
    console.log('Seeding primary tenant...');

    try {
        await ensurePrimaryTenant();
        await applyDevControlPlaneSeed();
    } catch (error) {
        console.error('Error seeding primary tenant:', error);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

seedPrimaryTenant();
