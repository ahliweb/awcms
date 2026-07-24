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
  { name: "SETUP_RATE_LIMIT_MAX", required: false, type: "int", min: 1 },
  { name: "SETUP_RATE_LIMIT_WINDOW_SEC", required: false, type: "int", min: 1 },
  { name: "TRUSTED_PROXY_ENABLED", required: false, type: "bool" },
  {
    name: "AUTH_IP_HASH_SECRET",
    required: false,
    type: "string",
    secret: true
  },

  { name: "AUTH_MFA_ENABLED", required: false, type: "bool" },
  {
    name: "AUTH_MFA_SECRET_ENCRYPTION_KEY",
    required: false,
    type: "string",
    secret: true
  },
  { name: "AUTH_MFA_TOTP_ISSUER", required: false, type: "string" },
  { name: "AUTH_MFA_TOTP_PERIOD_SEC", required: false, type: "int", min: 1 },
  {
    name: "AUTH_MFA_TOTP_DIGITS",
    required: false,
    type: "enum",
    values: ["6", "8"]
  },
  { name: "AUTH_MFA_TOTP_WINDOW_STEPS", required: false, type: "int", min: 0 },
  { name: "AUTH_MFA_CHALLENGE_TTL_SEC", required: false, type: "int", min: 1 },
  { name: "AUTH_MFA_STEPUP_TTL_SEC", required: false, type: "int", min: 1 },
  {
    name: "AUTH_MFA_MAX_VERIFY_ATTEMPTS",
    required: false,
    type: "int",
    min: 1
  },
  { name: "AUTH_MFA_LOCKOUT_MINUTES", required: false, type: "int", min: 1 },
  { name: "AUTH_MFA_RATE_LIMIT_MAX", required: false, type: "int", min: 1 },
  {
    name: "AUTH_MFA_RATE_LIMIT_WINDOW_SEC",
    required: false,
    type: "int",
    min: 1
  },

  { name: "AUTH_SSO_ENABLED", required: false, type: "bool" },
  {
    name: "AUTH_SSO_CREDENTIAL_ENCRYPTION_KEY",
    required: false,
    type: "string",
    secret: true
  },
  {
    name: "AUTH_SSO_DISCOVERY_TIMEOUT_MS",
    required: false,
    type: "int",
    min: 1
  },
  { name: "AUTH_SSO_MAX_RESPONSE_BYTES", required: false, type: "int", min: 1 },
  {
    name: "AUTH_SSO_MAX_PROVIDERS_PER_TENANT",
    required: false,
    type: "int",
    min: 1
  },
  {
    name: "AUTH_SSO_OAUTH_REQUEST_TTL_SEC",
    required: false,
    type: "int",
    min: 1
  },
  { name: "AUTH_SSO_ALLOW_INSECURE_HOSTS", required: false, type: "string" },

  // Full-online deployment-profile gate + Cloudflare Turnstile (Issue #186).
  // All optional/off by default so every LAN/offline deployment passes with
  // none of them set. `TURNSTILE_SITE_KEY` is public (embedded in the widget),
  // so it is NOT marked `secret`; only `TURNSTILE_SECRET_KEY` is.
  { name: "AUTH_ONLINE_SECURITY_ENABLED", required: false, type: "bool" },
  {
    name: "AUTH_ONLINE_SECURITY_PROFILE",
    required: false,
    type: "enum",
    values: ["disabled", "full_online"]
  },
  { name: "TURNSTILE_ENABLED", required: false, type: "bool" },
  { name: "TURNSTILE_SITE_KEY", required: false, type: "string" },
  {
    name: "TURNSTILE_SECRET_KEY",
    required: false,
    type: "string",
    secret: true
  },
  { name: "TURNSTILE_EXPECTED_HOSTNAME", required: false, type: "string" },
  {
    name: "TURNSTILE_VERIFY_TIMEOUT_MS",
    required: false,
    type: "int",
    min: 1
  },
  { name: "TURNSTILE_MAX_TOKEN_AGE_SEC", required: false, type: "int", min: 1 },
  {
    name: "TURNSTILE_MAX_RESPONSE_BYTES",
    required: false,
    type: "int",
    min: 1
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
  { name: "EMAIL_SEND_MAX_RETRIES", required: false, type: "int", min: 0 },

  // visitor_analytics (ported from awcms-micro epic #617-#624). All optional,
  // privacy-first off-by-default; see
  // src/modules/visitor-analytics/domain/visitor-analytics-config.ts. The
  // HASH_SALT cross-rule below requires a real salt whenever the module is
  // enabled (salted HMAC of visitor identifiers must not use an empty key).
  { name: "VISITOR_ANALYTICS_ENABLED", required: false, type: "bool" },
  {
    name: "VISITOR_ANALYTICS_MODE",
    required: false,
    type: "enum",
    values: ["basic", "detailed"]
  },
  { name: "VISITOR_ANALYTICS_COLLECT_ADMIN", required: false, type: "bool" },
  { name: "VISITOR_ANALYTICS_COLLECT_PUBLIC", required: false, type: "bool" },
  { name: "VISITOR_ANALYTICS_COLLECT_API", required: false, type: "bool" },
  { name: "VISITOR_ANALYTICS_DETAILED_ENABLED", required: false, type: "bool" },
  { name: "VISITOR_ANALYTICS_RAW_IP_ENABLED", required: false, type: "bool" },
  {
    name: "VISITOR_ANALYTICS_RAW_USER_AGENT_ENABLED",
    required: false,
    type: "bool"
  },
  { name: "VISITOR_ANALYTICS_GEO_ENABLED", required: false, type: "bool" },
  { name: "VISITOR_ANALYTICS_TRUST_PROXY", required: false, type: "bool" },
  { name: "VISITOR_ANALYTICS_TRUST_CLOUDFLARE", required: false, type: "bool" },
  {
    name: "VISITOR_ANALYTICS_ONLINE_WINDOW_SECONDS",
    required: false,
    type: "int",
    min: 1
  },
  {
    name: "VISITOR_ANALYTICS_EVENT_RETENTION_DAYS",
    required: false,
    type: "int",
    min: 1
  },
  {
    name: "VISITOR_ANALYTICS_RAW_DETAIL_RETENTION_DAYS",
    required: false,
    type: "int",
    min: 1
  },
  {
    name: "VISITOR_ANALYTICS_ROLLUP_RETENTION_DAYS",
    required: false,
    type: "int",
    min: 1
  },
  {
    name: "VISITOR_ANALYTICS_VISITOR_KEY_COOKIE_TTL_DAYS",
    required: false,
    type: "int",
    min: 1
  },
  {
    name: "VISITOR_ANALYTICS_HASH_SALT",
    required: false,
    type: "string",
    secret: true
  }
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

/** True when `value` base64-decodes to exactly 32 bytes (an AES-256 key). */
function isBase32ByteKey(value: string): boolean {
  try {
    return Buffer.from(value, "base64").length === 32;
  } catch {
    return false;
  }
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

  // visitor_analytics: enabling collection REQUIRES a real hash salt. Visitor
  // identifiers (visitor-key cookie, IP, user-agent) are stored only as salted
  // HMAC-SHA256; an empty/placeholder salt would make those hashes trivially
  // correlatable against a precomputed table. Enforced regardless of APP_ENV —
  // an empty salt with the module enabled is a privacy defect at any tier.
  if (env.VISITOR_ANALYTICS_ENABLED === "true") {
    const salt = env.VISITOR_ANALYTICS_HASH_SALT?.trim() ?? "";
    if (salt === "" || PLACEHOLDER_SECRETS.has(salt)) {
      problems.push(
        "VISITOR_ANALYTICS_HASH_SALT wajib berisi salt nyata saat VISITOR_ANALYTICS_ENABLED=true (hash identifier pengunjung tidak boleh memakai salt kosong)."
      );
    }
  }

  // MFA: enabling TOTP enrollment REQUIRES a real 32-byte AES-256 key (no
  // default key exists by design — a DB backup alone must not yield secrets).
  // Enforced regardless of APP_ENV: a missing/placeholder key would make every
  // enrollment fail closed at runtime, so surfacing it at config time is
  // strictly better than a confusing MFA_MISCONFIGURED in production.
  if (env.AUTH_MFA_ENABLED === "true") {
    const key = env.AUTH_MFA_SECRET_ENCRYPTION_KEY?.trim() ?? "";

    if (key === "" || PLACEHOLDER_SECRETS.has(key)) {
      problems.push(
        "AUTH_MFA_SECRET_ENCRYPTION_KEY wajib berisi key nyata saat AUTH_MFA_ENABLED=true (tidak ada default key)."
      );
    } else if (!isBase32ByteKey(key)) {
      problems.push(
        "AUTH_MFA_SECRET_ENCRYPTION_KEY harus 32 byte base64 (mis. `openssl rand -base64 32`)."
      );
    }
  }

  // OIDC/SSO (Issue #185): enabling SSO REQUIRES a real 32-byte AES-256 key to
  // encrypt tenant client secrets at rest (no default key by design). Enforced
  // regardless of APP_ENV — a missing/placeholder key makes every provider
  // create/token-exchange fail closed (SSO_MISCONFIGURED).
  if (env.AUTH_SSO_ENABLED === "true") {
    const key = env.AUTH_SSO_CREDENTIAL_ENCRYPTION_KEY?.trim() ?? "";

    if (key === "" || PLACEHOLDER_SECRETS.has(key)) {
      problems.push(
        "AUTH_SSO_CREDENTIAL_ENCRYPTION_KEY wajib berisi key nyata saat AUTH_SSO_ENABLED=true (tidak ada default key)."
      );
    } else if (!isBase32ByteKey(key)) {
      problems.push(
        "AUTH_SSO_CREDENTIAL_ENCRYPTION_KEY harus 32 byte base64 (mis. `openssl rand -base64 32`)."
      );
    }
  }

  // The SSRF-guard escape hatch that allows non-HTTPS/loopback OIDC endpoints
  // (`AUTH_SSO_ALLOW_INSECURE_HOSTS`) exists ONLY for a local fake IdP in tests.
  // It must never be set in production — doing so would re-open the exact SSRF
  // surface Issue #185 makes its top requirement to close.
  if (isProduction && (env.AUTH_SSO_ALLOW_INSECURE_HOSTS ?? "").trim() !== "") {
    problems.push(
      "AUTH_SSO_ALLOW_INSECURE_HOSTS harus kosong di produksi — hanya untuk fake IdP lokal saat test."
    );
  }

  // Full-online deployment-profile gate (Issue #186). This is what lets a
  // production preflight distinguish "disabled intentionally" (flag unset —
  // nothing required, LAN/offline is fine) from "misconfigured" (flag on but
  // the profile is anything other than full_online, including the explicitly
  // contradictory "disabled"). Enforced regardless of APP_ENV.
  if (env.AUTH_ONLINE_SECURITY_ENABLED === "true") {
    const profile = (env.AUTH_ONLINE_SECURITY_PROFILE ?? "").trim();

    if (profile !== "full_online") {
      problems.push(
        `AUTH_ONLINE_SECURITY_ENABLED=true membutuhkan AUTH_ONLINE_SECURITY_PROFILE=full_online; dapat ${
          profile ? `"${profile}"` : "kosong"
        }.`
      );
    }
  }

  // Cloudflare Turnstile (Issue #186): when enabled, the public site key, the
  // secret key, AND the expected hostname must all be present — the hostname is
  // required so the runtime hostname-confusion check fails closed rather than
  // being silently skipped. Independent of the deployment-profile gate above,
  // so an operator can stage the credentials before flipping the profile on.
  if (env.TURNSTILE_ENABLED === "true") {
    for (const name of [
      "TURNSTILE_SITE_KEY",
      "TURNSTILE_SECRET_KEY",
      "TURNSTILE_EXPECTED_HOSTNAME"
    ] as const) {
      if ((env[name] ?? "").trim() === "") {
        problems.push(
          `${name} wajib diisi saat TURNSTILE_ENABLED=true (Turnstile fail-closed).`
        );
      }
    }
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
