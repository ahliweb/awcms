import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load environment variables
dotenv.config({ path: path.join(rootDir, '.env') });

const SECRETS_META_PATH = path.join(rootDir, '.secrets_meta.json');
const ROTATION_INTERVAL_DAYS = 7;

// Function to generate a strong password
function generatePassword(length = 32) {
    return crypto.randomBytes(length).toString('hex');
}

// Function to parse args
function getArg(flag) {
    const index = process.argv.indexOf(flag);
    return (index > -1 && index + 1 < process.argv.length) ? process.argv[index + 1] : null;
}

// Function to update .env file
function updateEnvFile(filePath, key, value) {
    if (!fs.existsSync(filePath)) return;

    let content = fs.readFileSync(filePath, 'utf8');
    // Regex to match key=value, handling quotes and lack thereof
    const regex = new RegExp(`^${key}=.*`, 'm');

    // Basic replacement - usually simple key=value in .env
    if (regex.test(content)) {
        content = content.replace(regex, `${key}=${value}`);
    } else {
        content += `\n${key}=${value}`;
    }

    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated ${key} in ${path.basename(filePath)}`);
}

async function rotatePassword() {
    console.log('Starting Supabase database password rotation...');

    const force = process.argv.includes('--force');
    const manualPassword = getArg('--password');

    let meta = {};
    if (fs.existsSync(SECRETS_META_PATH)) {
        try {
            meta = JSON.parse(fs.readFileSync(SECRETS_META_PATH, 'utf8'));
        } catch (e) {
            console.warn('Could not parse .secrets_meta.json, starting fresh.');
        }
    }

    // Check rotation interval unless forced or setting specific password
    if (!force && !manualPassword && meta.lastRotation) {
        const lastRotation = new Date(meta.lastRotation);
        const now = new Date();
        const diffDays = (now - lastRotation) / (1000 * 60 * 60 * 24);

        if (diffDays < ROTATION_INTERVAL_DAYS) {
            console.log(`Password is recent (${diffDays.toFixed(1)} days old). Use --force to rotate anyway.`);
            return;
        }
    }

    // Determine new password
    const newPassword = manualPassword || generatePassword();

    // Connect to DB using CURRENT credentials
    // Try loading from .env.local first as it overrides .env
    const localEnvPath = path.join(rootDir, '.env.local');
    if (fs.existsSync(localEnvPath)) {
        dotenv.config({ path: localEnvPath, override: true });
    }

    const currentDbUrl = process.env.DATABASE_URL;
    if (!currentDbUrl) {
        console.error('Error: DATABASE_URL not found in environment variables. Cannot connect to database.');
        process.exit(1);
    }

    const client = new pg.Client({
        connectionString: currentDbUrl,
    });

    try {
        await client.connect();
        console.log('Connected to database.');

        // Update the postgres user password
        await client.query(`ALTER USER postgres WITH PASSWORD '${newPassword}'`);
        console.log('Successfully updated database password for user postgres.');

    } catch (err) {
        console.error('Failed to update database password:', err);
        console.error('Ensure your current DATABASE_URL in .env/.env.local is correct and the database is running.');
        process.exit(1);
    } finally {
        await client.end();
    }

    // Update local .env files
    try {
        // Robustly replace password in connection string
        // URL format: postgres://user:password@host:port/db
        const url = new URL(currentDbUrl);
        url.password = newPassword;
        const newDbUrl = url.toString();

        updateEnvFile(path.join(rootDir, '.env'), 'DATABASE_URL', newDbUrl);
        if (fs.existsSync(localEnvPath)) {
            updateEnvFile(localEnvPath, 'DATABASE_URL', newDbUrl);
        }

    } catch (e) {
        console.error("Failed to construct new DATABASE_URL.", e);
        console.error(`CRITICAL: Database password changed to: ${newPassword}, but .env update failed.`);
        process.exit(1);
    }

    // Update metadata
    meta.lastRotation = new Date().toISOString();
    fs.writeFileSync(SECRETS_META_PATH, JSON.stringify(meta, null, 2));
    console.log(`Rotation complete. Metadata saved to ${path.basename(SECRETS_META_PATH)}`);
    console.log('NOTE: You may need to restart your dev server for changes to take effect.');
}

rotatePassword();
