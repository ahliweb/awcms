/**
 * validate-env.ts — `bun run config:validate`.
 *
 * Validasi kontrak environment fondasi AWCMS sebelum boot/deploy. Membaca
 * `process.env` (default) atau file env eksplisit (`--file <path>`), lalu
 * memeriksa: variabel required hadir & tak kosong, variabel bertipe punya
 * format benar (int > 0, boolean `true`/`false`, URL postgres/http), dan
 * aturan khusus produksi (cookie secure, secret bukan placeholder, URL
 * https). Tanpa I/O database/network — murni memeriksa nilai env.
 *
 * Versi ramping yang disesuaikan untuk env fondasi repo ini; kontrak per
 * modul ERP ditambahkan seiring modulnya dibangun (bandingkan pola agregasi
 * per-modul di awcms-mini `scripts/validate-env.ts`).
 */
import { readFile } from "node:fs/promises";

type EnvBag = Record<string, string | undefined>;

type Rule = {
  name: string;
  required: boolean;
  type: "string" | "int" | "bool" | "url-postgres" | "url-http" | "enum";
  values?: readonly string[];
  min?: number;
  /** Rahasia yang tak boleh bernilai placeholder di produksi. */
  secret?: boolean;
};

const BOOL_VALUES = ["true", "false"] as const;

const RULES: readonly Rule[] = [
  {
    name: "APP_ENV",
    required: true,
    type: "enum",
    values: ["development", "test", "staging", "production"]
  },
  { name: "APP_URL", required: true, type: "url-http" },
  {
    name: "LOG_LEVEL",
    required: false,
    type: "enum",
    values: ["debug", "info", "warn", "error"]
  },
  { name: "AUDIT_LOG_RETENTION_DAYS", required: false, type: "int", min: 1 },

  { name: "DATABASE_URL", required: true, type: "url-postgres" },
  { name: "DATABASE_POOL_MAX", required: false, type: "int", min: 1 },
  {
    name: "DATABASE_STATEMENT_TIMEOUT_MS",
    required: false,
    type: "int",
    min: 0
  },
  { name: "DATABASE_PGBOUNCER", required: false, type: "bool" },
  { name: "WORKER_DATABASE_URL", required: false, type: "url-postgres" },
  { name: "SETUP_DATABASE_URL", required: false, type: "url-postgres" },

  { name: "AUTH_SESSION_TTL_MIN", required: false, type: "int", min: 1 },
  { name: "AUTH_COOKIE_SECURE", required: false, type: "bool" },
  { name: "AUTH_LOGIN_MAX_ATTEMPTS", required: false, type: "int", min: 1 },
  { name: "AUTH_LOGIN_RATE_LIMIT_MAX", required: false, type: "int", min: 1 },
  {
    name: "AUTH_LOGIN_RATE_LIMIT_WINDOW_SEC",
    required: false,
    type: "int",
    min: 1
  },
  { name: "TRUSTED_PROXY_ENABLED", required: false, type: "bool" },
  {
    name: "AUTH_IP_HASH_SECRET",
    required: false,
    type: "string",
    secret: true
  },

  { name: "AWCMS_SYNC_ENABLED", required: false, type: "bool" },
  {
    name: "AWCMS_SYNC_HMAC_SECRET",
    required: false,
    type: "string",
    secret: true
  },
  { name: "AWCMS_SYNC_MAX_SKEW_SEC", required: false, type: "int", min: 1 },
  { name: "SYNC_HMAC_ALLOW_LEGACY", required: false, type: "bool" },

  {
    name: "STORAGE_DRIVER",
    required: false,
    type: "enum",
    values: ["local", "r2", "s3"]
  },
  { name: "LOCAL_STORAGE_PATH", required: false, type: "string" },
  { name: "R2_ENABLED", required: false, type: "bool" },

  { name: "EMAIL_ENABLED", required: false, type: "bool" },
  { name: "EMAIL_FROM_NAME", required: false, type: "string" },
  { name: "EMAIL_SEND_TIMEOUT_MS", required: false, type: "int", min: 1 },
  { name: "EMAIL_SEND_MAX_RETRIES", required: false, type: "int", min: 0 }
];

/** Nilai placeholder yang aman di dev tapi dilarang di produksi. */
const PLACEHOLDER_SECRETS = new Set(["change-me", "changeme", "secret", ""]);

function parseEnvFile(source: string): EnvBag {
  const bag: EnvBag = {};
  for (const rawLine of source.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    bag[key] = value;
  }
  return bag;
}

function isValidUrl(value: string, protocols: readonly string[]): boolean {
  try {
    const url = new URL(value);
    return protocols.includes(url.protocol);
  } catch {
    return false;
  }
}

export function validateEnv(env: EnvBag): string[] {
  const problems: string[] = [];
  const isProduction = env.APP_ENV === "production";

  for (const rule of RULES) {
    const raw = env[rule.name];
    const present = raw !== undefined && raw.trim() !== "";

    if (!present) {
      if (rule.required) {
        problems.push(`${rule.name} wajib diisi tetapi kosong/tidak ada.`);
      }
      continue;
    }

    const value = raw!.trim();

    switch (rule.type) {
      case "int": {
        if (!/^-?\d+$/.test(value)) {
          problems.push(`${rule.name} harus bilangan bulat, dapat "${value}".`);
        } else if (rule.min !== undefined && Number(value) < rule.min) {
          problems.push(`${rule.name} harus >= ${rule.min}, dapat ${value}.`);
        }
        break;
      }
      case "bool": {
        if (!BOOL_VALUES.includes(value as (typeof BOOL_VALUES)[number])) {
          problems.push(`${rule.name} harus "true"/"false", dapat "${value}".`);
        }
        break;
      }
      case "enum": {
        if (!rule.values!.includes(value)) {
          problems.push(
            `${rule.name} harus salah satu [${rule.values!.join(", ")}], dapat "${value}".`
          );
        }
        break;
      }
      case "url-postgres": {
        if (!isValidUrl(value, ["postgres:", "postgresql:"])) {
          problems.push(`${rule.name} harus URL postgres yang valid.`);
        }
        break;
      }
      case "url-http": {
        if (!isValidUrl(value, ["http:", "https:"])) {
          problems.push(`${rule.name} harus URL http(s) yang valid.`);
        } else if (isProduction && new URL(value).protocol !== "https:") {
          problems.push(`${rule.name} harus https di produksi.`);
        }
        break;
      }
      case "string":
        break;
    }

    if (rule.secret && isProduction && PLACEHOLDER_SECRETS.has(value)) {
      problems.push(
        `${rule.name} masih bernilai placeholder ("${value}") — dilarang di produksi.`
      );
    }
  }

  // Aturan silang bergantung.
  if (env.AWCMS_SYNC_ENABLED === "true") {
    const secret = env.AWCMS_SYNC_HMAC_SECRET?.trim() ?? "";
    if (secret === "" || PLACEHOLDER_SECRETS.has(secret)) {
      problems.push(
        "AWCMS_SYNC_HMAC_SECRET wajib berisi secret nyata saat AWCMS_SYNC_ENABLED=true."
      );
    }
  }

  if (isProduction && env.AUTH_COOKIE_SECURE === "false") {
    problems.push("AUTH_COOKIE_SECURE harus true di produksi.");
  }

  // Tidak ada default yang aman untuk dua-duanya, jadi produksi wajib memilih
  // sadar. Profil production repo ini adalah nginx TLS-termination
  // (deployment-profiles.md), dan di sana `false` membuat setiap request
  // terlihat berasal dari IP nginx: bucket rate limit login runtuh jadi satu
  // per tenant, sehingga 20 login gagal/menit mengunci seluruh pengguna tenant
  // itu. Sebaliknya `true` pada app yang terekspos langsung membuat rate limit
  // bisa dilucuti dengan merotasi header X-Forwarded-For.
  if (isProduction && (env.TRUSTED_PROXY_ENABLED ?? "").trim() === "") {
    problems.push(
      "TRUSTED_PROXY_ENABLED wajib diset eksplisit di produksi: `true` bila ada proxy tepercaya yang MENIMPA X-Forwarded-For (mis. profil nginx), `false` bila app terekspos langsung."
    );
  }

  return problems;
}

if (import.meta.main) {
  const fileFlagIndex = process.argv.indexOf("--file");
  let env: EnvBag = process.env;
  let source = "process.env";

  if (fileFlagIndex !== -1) {
    const filePath = process.argv[fileFlagIndex + 1];
    if (!filePath) {
      console.error("config:validate — --file butuh path.");
      process.exit(1);
    }
    env = parseEnvFile(await readFile(filePath, "utf8"));
    source = filePath;
  }

  const problems = validateEnv(env);

  if (problems.length > 0) {
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error(
      `\nconfig:validate GAGAL — ${problems.length} masalah pada ${source}.`
    );
    process.exitCode = 1;
  } else {
    console.log(`config:validate OK — kontrak env terpenuhi (${source}).`);
  }
}
