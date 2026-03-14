import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const configPath = resolve(process.cwd(), "dist/server/wrangler.json");
const deployRedirectPath = resolve(
  process.cwd(),
  ".wrangler/deploy/config.json",
);

if (!existsSync(configPath)) {
  console.warn(
    `[AWCMS Public] Skipping Wrangler sanitize; file not found: ${configPath}`,
  );
  process.exit(0);
}

const config = JSON.parse(readFileSync(configPath, "utf8"));

if (config.triggers && Object.keys(config.triggers).length === 0) {
  delete config.triggers;
}

for (const key of [
  "definedEnvironments",
  "secrets_store_secrets",
  "unsafe_hello_world",
  "worker_loaders",
  "ratelimits",
  "vpc_services",
  "python_modules",
]) {
  delete config[key];
}

if (config.dev) {
  delete config.dev.enable_containers;
  delete config.dev.generate_types;
}

writeFileSync(configPath, `${JSON.stringify(config)}\n`);

console.log(
  `[AWCMS Public] Sanitized generated Wrangler config: ${configPath}`,
);

if (existsSync(deployRedirectPath)) {
  rmSync(deployRedirectPath, { force: true });
  console.log(
    `[AWCMS Public] Removed Pages deploy redirect config: ${deployRedirectPath}`,
  );
}
