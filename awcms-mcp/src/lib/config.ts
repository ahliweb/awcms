import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

// Helper to get directory names
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Project Root is 3 levels up from src/lib (awcms-mcp/src/lib -> awcms-mcp/src -> awcms-mcp -> awcms-dev)
export const PROJECT_ROOT = path.resolve(__dirname, "../../../");

// Load environment variables by precedence (later entries override earlier ones):
// 1. awcms/.env
// 2. awcms/.env.local
// 3. awcms-mcp/.env
// 4. awcms-mcp/.env.local
// 5. process.env (highest precedence)
export function loadConfig() {
  const pathsToTry = [
    "awcms/.env",
    "awcms/.env.local",
    "awcms-mcp/.env",
    "awcms-mcp/.env.local"
  ];

  let envVars: NodeJS.ProcessEnv = {};
  let loadedFiles = 0;

  for (const relativePath of pathsToTry) {
    const fullPath = path.resolve(PROJECT_ROOT, relativePath);
    if (fs.existsSync(fullPath)) {
      loadedFiles += 1;
      console.error(`[Config] Loading environment from: ${fullPath}`);
      const parsed = dotenv.parse(fs.readFileSync(fullPath));
      envVars = { ...envVars, ...parsed };
    }
  }

  // Runtime environment must win over file-based values for CI/secrets safety.
  envVars = { ...envVars, ...process.env };

  if (loadedFiles === 0) {
    console.error("[Config] Warning: No .env files found.");
  }

  return envVars;
}

export const env = loadConfig();
