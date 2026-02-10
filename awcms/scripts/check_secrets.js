import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const SECRETS_META_PATH = path.join(rootDir, '.secrets_meta.json');
const ROTATION_INTERVAL_DAYS = 7;

function checkSecrets() {
  if (!fs.existsSync(SECRETS_META_PATH)) {
    console.warn('\x1b[33m%s\x1b[0m', 'WARN: Secret rotation metadata not found. Consider running "npm run secrets:rotate" to initialize secure rotation.');
    return;
  }

  try {
    const meta = JSON.parse(fs.readFileSync(SECRETS_META_PATH, 'utf8'));
    if (meta.lastRotation) {
      const lastRotation = new Date(meta.lastRotation);
      const now = new Date();
      const diffDays = (now - lastRotation) / (1000 * 60 * 60 * 24);

      if (diffDays > ROTATION_INTERVAL_DAYS) {
        console.warn('\x1b[31m%s\x1b[0m', `CRITICAL: Database password is older than ${ROTATION_INTERVAL_DAYS} days (${diffDays.toFixed(1)} days).`);
        console.warn('\x1b[31m%s\x1b[0m', 'Please run "npm run secrets:rotate" immediately to secure your environment.');
      }
    }
  } catch (e) {
    console.warn('Could not read secrets metadata.');
  }
}

checkSecrets();
