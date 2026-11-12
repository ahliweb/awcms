/**
 * CDN purge configuration — Issue #1282 (revisit of C14).
 *
 * Everything is **off by default and fail-closed**. The CDN purge only runs when
 * `EDGE_CACHE_CDN_PURGE` is exactly `on`; with the flag on, a missing or
 * malformed credential makes the purge worker refuse to start a pass (the queue
 * keeps every row) instead of banning in Varnish and silently skipping the CDN.
 *
 * The values live in the environment only. No account or zone identifier and no
 * token is ever written to source, docs or logs; this module reads names, never
 * prints values.
 *
 * Kept apart from `config.ts` on purpose: `loadEdgeCacheConfig` runs inside the
 * publish path, and the API token must reach only the purge worker (the same
 * reason `EDGE_CACHE_PURGE_TOKEN` is job-scoped, Issue #1132).
 */
import type { EdgeCacheEnvironment } from "./config";

/** Public documented base of the Cloudflare v4 API. Overridable for a proxy or a test. */
export const DEFAULT_CDN_API_BASE = "https://api.cloudflare.com/client/v4";

export type CdnPurgeConfig = {
  /** The flag. Only the exact value `on` enables it. */
  enabled: boolean;
  /** API base without a trailing slash, or `null` when the override is unusable. */
  apiBase: string | null;
  zoneId: string | null;
  apiToken: string | null;
};

/** Zone ids are path segments: restrict them so a value cannot rewrite the request path. */
const SAFE_ZONE_ID = /^[A-Za-z0-9_-]{1,64}$/;

function readNonEmpty(raw: string | undefined): string | null {
  const trimmed = raw?.trim() ?? "";

  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Accept `https://` always and `http://` only on a loopback host (the local fake
 * CDN in tests). A bearer token must not travel in clear text to anywhere else.
 */
function readApiBase(raw: string | undefined): string | null {
  const value = readNonEmpty(raw);

  if (value === null) {
    return DEFAULT_CDN_API_BASE;
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const loopback =
    url.hostname === "127.0.0.1" ||
    url.hostname === "localhost" ||
    url.hostname === "[::1]";

  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    return null;
  }

  return value.replace(/\/+$/, "");
}

/** The flag alone: cheap, secret-free, safe to read in the request path. */
export function isCdnPurgeEnabled(
  env: EdgeCacheEnvironment = process.env
): boolean {
  return env.EDGE_CACHE_CDN_PURGE?.trim().toLowerCase() === "on";
}

export function loadCdnPurgeConfig(
  env: EdgeCacheEnvironment = process.env
): CdnPurgeConfig {
  const zoneId = readNonEmpty(env.EDGE_CACHE_CDN_ZONE_ID);

  return {
    enabled: isCdnPurgeEnabled(env),
    apiBase: readApiBase(env.EDGE_CACHE_CDN_API_BASE),
    zoneId: zoneId !== null && SAFE_ZONE_ID.test(zoneId) ? zoneId : null,
    apiToken: readNonEmpty(env.EDGE_CACHE_CDN_API_TOKEN)
  };
}

/**
 * Names (never values) of what is missing or unusable while the flag is on.
 * Empty when the flag is off or the configuration is complete.
 */
export function listMissingCdnPurgeSettings(config: CdnPurgeConfig): string[] {
  if (!config.enabled) {
    return [];
  }

  const missing: string[] = [];

  if (config.apiBase === null) missing.push("EDGE_CACHE_CDN_API_BASE");
  if (config.zoneId === null) missing.push("EDGE_CACHE_CDN_ZONE_ID");
  if (config.apiToken === null) missing.push("EDGE_CACHE_CDN_API_TOKEN");

  return missing;
}
