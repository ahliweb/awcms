import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const [, , ...command] = process.argv;

if (command.length === 0) {
  console.error("[AWCMS Public] Missing command to execute.");
  process.exit(1);
}

const parseEnvFile = (filePath) => {
  const content = readFileSync(filePath, "utf8");
  const values = {};

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
};

const applyIfMissing = (targetEnv, key, value) => {
  if (!value) return;
  if (!targetEnv[key]) {
    targetEnv[key] = value;
  }
};

const normalizeDeploymentEnv = (targetEnv) => {
  applyIfMissing(
    targetEnv,
    "VITE_SUPABASE_PUBLISHABLE_KEY",
    targetEnv.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
      targetEnv.VITE_SUPABASE_ANON_KEY,
  );
  applyIfMissing(targetEnv, "PUBLIC_SUPABASE_URL", targetEnv.VITE_SUPABASE_URL);
  applyIfMissing(
    targetEnv,
    "PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    targetEnv.PUBLIC_SUPABASE_ANON_KEY ||
      targetEnv.PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
      targetEnv.VITE_SUPABASE_PUBLISHABLE_KEY ||
      targetEnv.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
      targetEnv.VITE_SUPABASE_ANON_KEY,
  );
  applyIfMissing(
    targetEnv,
    "VITE_PUBLIC_TENANT_ID",
    targetEnv.PUBLIC_TENANT_ID,
  );
};

const candidateFiles = [
  ".env.production",
  ".env.remote",
  ".env.linked",
  "../../awcms/.env.production",
  "../../awcms/.env.remote",
  "../../.env.production",
  "../../.env.remote",
];
const cwd = process.cwd();
const wranglerConfigPath = resolve(cwd, "wrangler.json");
const loadedFiles = [];
const mergedEnv = { ...process.env };

const previewEnvHelp = [
  "Cloudflare Pages preview deployments use their own environment variable set.",
  "Open Cloudflare Dashboard -> Workers & Pages -> awcms-public -> Settings -> Variables and Secrets.",
  "Add the missing values for the Preview environment, then retry the deployment.",
];

for (const relativeFile of candidateFiles) {
  const absoluteFile = resolve(cwd, relativeFile);
  if (!existsSync(absoluteFile)) continue;

  const parsed = parseEnvFile(absoluteFile);
  for (const [key, value] of Object.entries(parsed)) {
    if (!mergedEnv[key]) {
      mergedEnv[key] = value;
    }
  }
  loadedFiles.push(relativeFile);
}

normalizeDeploymentEnv(mergedEnv);

const isAstroBuild = command[0] === "astro" && command.includes("build");
let restoreWranglerConfig = null;

if (isAstroBuild && existsSync(wranglerConfigPath)) {
  const original = readFileSync(wranglerConfigPath, "utf8");
  const parsed = JSON.parse(original);

  if (parsed.pages_build_output_dir) {
    const sanitized = { ...parsed };
    delete sanitized.pages_build_output_dir;
    writeFileSync(
      wranglerConfigPath,
      `${JSON.stringify(sanitized, null, 2)}\n`,
    );
    console.log(
      "[AWCMS Public] Temporarily removed pages_build_output_dir from wrangler.json for Astro build compatibility.",
    );
    restoreWranglerConfig = () => {
      writeFileSync(wranglerConfigPath, original);
    };
  }
}

const isCloudflarePagesBuild =
  mergedEnv.CF_PAGES === "1" ||
  mergedEnv.CF_PAGES === "true" ||
  mergedEnv.ENVIRONMENT === "production";

if (loadedFiles.length > 0) {
  console.log(
    `[AWCMS Public] Loaded deployment env from ${loadedFiles.join(", ")}.`,
  );
}

if (isCloudflarePagesBuild) {
  const required = {
    supabaseUrl:
      mergedEnv.PUBLIC_SUPABASE_URL || mergedEnv.VITE_SUPABASE_URL || "",
    publishableKey:
      mergedEnv.PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      mergedEnv.VITE_SUPABASE_PUBLISHABLE_KEY ||
      "",
    tenantId:
      mergedEnv.PUBLIC_TENANT_ID ||
      mergedEnv.VITE_PUBLIC_TENANT_ID ||
      mergedEnv.VITE_TENANT_ID ||
      "",
  };

  const missingKeys = [];
  if (!required.supabaseUrl)
    missingKeys.push("PUBLIC_SUPABASE_URL/VITE_SUPABASE_URL");
  if (!required.publishableKey) {
    missingKeys.push(
      "PUBLIC_SUPABASE_PUBLISHABLE_KEY/VITE_SUPABASE_PUBLISHABLE_KEY",
    );
  }
  if (!required.tenantId) {
    missingKeys.push("PUBLIC_TENANT_ID/VITE_PUBLIC_TENANT_ID/VITE_TENANT_ID");
  }

  if (missingKeys.length > 0) {
    const loadedEnvText =
      loadedFiles.length > 0 ? loadedFiles.join(", ") : "no local env files";
    console.error(
      `[AWCMS Public] Missing deployment env: ${missingKeys.join(", ")}. ` +
        `Loaded sources: ${loadedEnvText}. ` +
        "Cloudflare Pages builds must use production, remote, linked, or Pages dashboard env configuration.",
    );
    console.error(`[AWCMS Public] ${previewEnvHelp.join(" ")}`);
    process.exit(1);
  }
}

const child = spawn(command[0], command.slice(1), {
  cwd,
  env: mergedEnv,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (restoreWranglerConfig) {
    restoreWranglerConfig();
  }

  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

child.on("error", (error) => {
  if (restoreWranglerConfig) {
    restoreWranglerConfig();
  }

  throw error;
});
