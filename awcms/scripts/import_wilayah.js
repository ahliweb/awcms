
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Load env vars from ../.env
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Error: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in .env');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

// Test connection
async function testConnection() {
    console.log('Testing connection to Supabase...');
    const { error } = await supabase.from('region_levels').select('count', { count: 'exact', head: true });
    if (error) {
        console.error('❌ Connection failed:', error.message);
        if (error.code === 'PGRST301') console.error('Hint: Check if Service Key has bypass privileges.');
        process.exit(1);
    }
    console.log('✅ Connection successful. Supabase is reachable and write-ready.');
}

const SOURCE_URL = 'https://raw.githubusercontent.com/cahyadsn/wilayah/master/db/wilayah.sql';

// UUID cache: code -> uuid
const regionCache = new Map();
const levelCache = new Map();

async function main() {
    await testConnection();
    console.log('🚀 Starting Wilayah Import...');

    // 1. Fetch SQL
    console.log(`📥 Fetching data from ${SOURCE_URL}...`);
    const response = await fetch(SOURCE_URL);
    if (!response.ok) throw new Error(`Failed to fetch SQL: ${response.statusText}`);
    const sqlText = await response.text();

    // 2. Parse Data
    console.log('Parsing SQL...');
    const lines = sqlText.split('\n');
    const regions = [];

    // Regex to match: ('code','name')
    // Note: Name might contain single quotes escaped, but usually in this dataset it's clean.
    // The dataset format is: ('11','Aceh'),
    const regex = /\('([\d.]+)','([^']+)'\)/;

    for (const line of lines) {
        const match = line.match(regex);
        if (match) {
            regions.push({
                code: match[1],
                name: match[2]
            });
        }
    }

    console.log(`✅ Parsed ${regions.length} regions.`);

    // 3. Seed Levels
    console.log('🌱 Seeding region levels...');
    const levels = [
        { key: 'provinsi', name: 'Provinsi', level_order: 1 },
        { key: 'kabupaten_kota', name: 'Kabupaten/Kota', level_order: 2 },
        { key: 'kecamatan', name: 'Kecamatan', level_order: 3 },
        { key: 'desa_kelurahan', name: 'Desa/Kelurahan', level_order: 4 },
    ];

    for (const lvl of levels) {
        // Upsert level
        const { data, error } = await supabase
            .from('region_levels')
            .upsert(lvl, { onConflict: 'key' })
            .select('id, key')
            .single();

        if (error) {
            console.error('Error upserting level:', error);
            process.exit(1);
        }
        levelCache.set(lvl.level_order, data.id);
    }

    // 4. Process Regions by Level
    // Sort regions by code length/structure to ensure parents come first
    // Level 1: length 2 (11)
    // Level 2: length 5 (11.01)
    // Level 3: length 8 (11.01.01)
    // Level 4: length 13 (11.01.01.2001)

    const getLevelOrder = (code) => {
        const parts = code.split('.');
        return parts.length;
    };

    // Group by level
    const regionsByLevel = [[], [], [], [], []]; // Index 1 to 4

    regions.forEach(r => {
        const lvl = getLevelOrder(r.code);
        if (lvl >= 1 && lvl <= 4) {
            regionsByLevel[lvl].push(r);
        }
    });

    // 5. Insert Loop
    for (let lvl = 1; lvl <= 4; lvl++) {
        const currentRegions = regionsByLevel[lvl];
        const levelId = levelCache.get(lvl);

        console.log(`Processing Level ${lvl} (${currentRegions.length} items)...`);

        // Chunking
        const CHUNK_SIZE = 1000;
        for (let i = 0; i < currentRegions.length; i += CHUNK_SIZE) {
            const chunk = currentRegions.slice(i, i + CHUNK_SIZE);
            const rowsToInsert = chunk.map(r => {
                let parentId = null;
                if (lvl > 1) {
                    // Find parent code (remove last segment)
                    const parts = r.code.split('.');
                    parts.pop();
                    const parentCode = parts.join('.');
                    parentId = regionCache.get(parentCode);
                }

                return {
                    code: r.code,
                    name: r.name,
                    level_id: levelId,
                    parent_id: parentId,
                    full_path: r.name // Init, can be updated later or ignored for now
                };
            });

            // Upsert
            const { data, error } = await supabase
                .from('regions')
                .upsert(rowsToInsert, { onConflict: 'code', ignoreDuplicates: false })
                .select('id, code');

            if (error) {
                console.error(`Error inserting chunk ${i} at level ${lvl}:`, error);
            } else {
                // Cache UUIDs for mapped children
                data.forEach(row => {
                    regionCache.set(row.code, row.id);
                });
            }

            process.stdout.write(`\rInserted ${Math.min(i + CHUNK_SIZE, currentRegions.length)} / ${currentRegions.length}`);
        }
        console.log('\nLevel completed.');
    }

    console.log('🎉 Import finished successfully!');
}

main().catch(err => {
    console.error('Unhandled error:', err);
    process.exit(1);
});
