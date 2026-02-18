import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env.remote
dotenv.config({ path: path.resolve(__dirname, '../.env.remote') });

// Pooler Connection
const poolerHost = 'aws-0-ap-southeast-1.pooler.supabase.com';
const poolerPort = 6543;
const projectRef = 'imveukxxtdwjgwsafwfl';
const dbPassword = process.env.SUPABASE_DB_PASSWORD || 'iIdl6IAQdrmo3V03'; // Fallback for dev

const connectionString = `postgresql://postgres.${projectRef}:${dbPassword}@${poolerHost}:${poolerPort}/postgres`;

const { Client } = pg;
const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
});

async function runCallback() {
    try {
        console.log('Connecting to database via Pooler...');
        console.log(`Host: ${poolerHost}, User: postgres.${projectRef}`);

        await client.connect();
        console.log('Connected to database.');

        const migrationPath = path.resolve(__dirname, '../supabase/migrations/20260217160000_add_locale_to_pages_posts.sql');
        const sql = fs.readFileSync(migrationPath, 'utf8');

        console.log('--- Executing Migration ---');
        console.log(migrationPath);

        await client.query(sql);

        console.log('Migration committed successfully.');
    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        await client.end();
    }
}

runCallback();
