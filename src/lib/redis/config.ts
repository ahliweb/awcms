export type RedisEnvironment = Readonly<Record<string, string | undefined>>;

export type RedisConfig = {
  enabled: boolean;
  url: string | null;
  keyPrefix: string;
  connectionTimeoutMs: number;
  commandTimeoutMs: number;
  maxRetries: number;
  cacheDefaultTtlSec: number;
};

export type RedisValidationFinding = {
  severity: "warning" | "fail";
  code: string;
  message: string;
};

const DEFAULTS = {
  keyPrefix: "awcms",
  connectionTimeoutMs: 2_000,
  commandTimeoutMs: 1_000,
  maxRetries: 3,
  cacheDefaultTtlSec: 300
} as const;

const SUPPORTED_SCHEMES = [
  "redis://",
  "rediss://",
  "redis+tls://",
  "redis+unix://",
  "redis+tls+unix://"
] as const;

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  return value.trim().toLowerCase() === "true";
}

function parseBoundedInteger(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return fallback;
  }

  return parsed;
}

export function loadRedisConfig(
  env: RedisEnvironment = process.env
): RedisConfig {
  const url = env.REDIS_URL?.trim() || null;

  return {
    enabled: parseBoolean(env.REDIS_ENABLED, false),
    url,
    keyPrefix: env.REDIS_KEY_PREFIX?.trim() || DEFAULTS.keyPrefix,
    connectionTimeoutMs: parseBoundedInteger(
      env.REDIS_CONNECTION_TIMEOUT_MS,
      DEFAULTS.connectionTimeoutMs,
      100,
      30_000
    ),
    commandTimeoutMs: parseBoundedInteger(
      env.REDIS_COMMAND_TIMEOUT_MS,
      DEFAULTS.commandTimeoutMs,
      50,
      30_000
    ),
    maxRetries: parseBoundedInteger(
      env.REDIS_MAX_RETRIES,
      DEFAULTS.maxRetries,
      0,
      20
    ),
    cacheDefaultTtlSec: parseBoundedInteger(
      env.REDIS_CACHE_DEFAULT_TTL_SEC,
      DEFAULTS.cacheDefaultTtlSec,
      1,
      86_400
    )
  };
}

export function validateRedisConfig(
  config: RedisConfig,
  env: RedisEnvironment = process.env
): RedisValidationFinding[] {
  const findings: RedisValidationFinding[] = [];

  if (!config.enabled) {
    return findings;
  }

  if (!config.url) {
    findings.push({
      severity: "fail",
      code: "redis_url_required",
      message: "REDIS_URL is required when REDIS_ENABLED=true."
    });
  } else if (
    !SUPPORTED_SCHEMES.some((scheme) => config.url?.startsWith(scheme))
  ) {
    findings.push({
      severity: "fail",
      code: "redis_url_scheme_unsupported",
      message:
        "REDIS_URL must use redis://, rediss://, redis+tls://, redis+unix://, or redis+tls+unix://."
    });
  }

  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,63}$/.test(config.keyPrefix)) {
    findings.push({
      severity: "fail",
      code: "redis_key_prefix_invalid",
      message:
        "REDIS_KEY_PREFIX must be 2-64 characters using letters, numbers, dot, underscore, or hyphen."
    });
  }

  const appEnv = env.APP_ENV?.trim().toLowerCase();
  const isOnlineEnvironment = appEnv === "staging" || appEnv === "production";

  if (
    isOnlineEnvironment &&
    config.url?.startsWith("redis://") &&
    !isPrivateRedisHost(config.url)
  ) {
    findings.push({
      severity: "warning",
      code: "redis_tls_recommended",
      message:
        "Use rediss:// or a private/internal network for Redis in staging and production."
    });
  }

  if (isOnlineEnvironment && config.url && !hasRedisCredentials(config.url)) {
    findings.push({
      severity: "warning",
      code: "redis_auth_recommended",
      message:
        "Use a dedicated Redis ACL username and secret in staging and production."
    });
  }

  return findings;
}

function isPrivateRedisHost(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "redis" ||
      hostname.endsWith(".internal") ||
      hostname.endsWith(".local") ||
      hostname.startsWith("10.") ||
      hostname.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
    );
  } catch {
    return false;
  }
}

function hasRedisCredentials(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.username.length > 0 && parsed.password.length > 0;
  } catch {
    return false;
  }
}

export function redactRedisUrl(url: string | null): string | null {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);

    if (parsed.username) {
      parsed.username = "***";
    }

    if (parsed.password) {
      parsed.password = "***";
    }

    return parsed.toString();
  } catch {
    return "[invalid-redis-url]";
  }
}

export type RedisKeyParts = {
  namespace: string;
  key: string;
  tenantId?: string | null;
  version?: string;
};

function encodeKeySegment(segment: string, label: string): string {
  const normalized = segment.trim();

  if (!normalized) {
    throw new Error(`Redis key ${label} must not be empty.`);
  }

  return encodeURIComponent(normalized);
}

/**
 * Builds a collision-resistant key with explicit tenant scope. Derived modules
 * must pass tenantId for tenant-scoped data; global is reserved for genuinely
 * cross-tenant, non-sensitive platform state.
 */
export function buildRedisKey(
  parts: RedisKeyParts,
  config: Pick<RedisConfig, "keyPrefix"> = loadRedisConfig()
): string {
  const prefix = encodeKeySegment(config.keyPrefix, "prefix");
  const version = encodeKeySegment(parts.version ?? "v1", "version");
  const namespace = encodeKeySegment(parts.namespace, "namespace");
  const scope = parts.tenantId
    ? `tenant:${encodeKeySegment(parts.tenantId, "tenantId")}`
    : "global";
  const key = encodeKeySegment(parts.key, "key");

  return `${prefix}:${version}:${namespace}:${scope}:${key}`;
}
