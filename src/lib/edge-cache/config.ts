/**
 * Edge-cache (Varnish) configuration — ADR-0042.
 *
 * Everything here is read from the environment and is **absent-safe**: with no
 * `EDGE_CACHE_*` variable set at all, `loadEdgeCacheConfig()` returns
 * `mode: "off"`, which makes the whole subsystem a no-op (no surrogate headers
 * emitted, no purge enqueued, no Varnish contacted). That default is deliberate:
 * an edge cache that switches itself on by accident in front of a multi-tenant
 * app is a cross-tenant disclosure bug, not a performance win.
 *
 * ## The three modes
 *
 * - `off` (default) — the app behaves exactly as it did before ADR-0042.
 * - `auto` — the app is Varnish-aware but only *asks* to be cached while the
 *   backend is actually under pressure (see `pressure.ts`). This is the
 *   "diaktifkan otomatis apabila diperlukan" mode: at rest the origin serves
 *   fresh data and the cache stays cold; under load the TTL ramps up and the
 *   database stops being asked the same public question repeatedly.
 * - `on` — always advertise the declared TTL for declared public surfaces.
 *   Use for a read-heavy public site where staleness within the TTL is fine.
 *
 * `auto` vs `on` only ever changes **how long** a response may be cached. It can
 * never widen **what** is cacheable — that is decided independently, and
 * fail-closed, by `cacheability.ts`.
 */

/** How aggressively the origin asks the edge to cache. */
export type EdgeCacheMode = "off" | "auto" | "on";

export type EdgeCacheEnvironment = Readonly<Record<string, string | undefined>>;

export type EdgeCacheConfig = {
  mode: EdgeCacheMode;
  /**
   * Hard ceiling on any advertised `Surrogate-Control: max-age`. Even a surface
   * that declares a longer TTL is clamped to this, so one careless surface
   * declaration cannot pin stale content at the edge for a day.
   */
  maxTtlSeconds: number;
  /**
   * How long the edge may keep serving a stale copy while it revalidates in the
   * background. Bounded separately from the TTL because a long grace window is
   * the single most effective protection against a thundering herd hitting the
   * database when a popular object expires.
   */
  staleWhileRevalidateSeconds: number;
  /** Base URL of the Varnish admin/purge listener, e.g. `http://varnish:80`. */
  purgeEndpoint: string | null;
  /**
   * Shared secret presented as `X-Edge-Purge-Token` on BAN requests. The bundled
   * VCL refuses a BAN without it, so an unauthenticated attacker cannot flush a
   * tenant's cache to force load onto the origin.
   */
  purgeToken: string | null;
  /** Per-run cap on how many queued purges one worker pass drains. */
  purgeBatchSize: number;
  /** Auto-mode: sustained requests/second at which the TTL ramp starts. */
  autoRequestRateThreshold: number;
  /** Auto-mode: rolling mean origin latency (ms) at which the TTL ramp starts. */
  autoLatencyThresholdMs: number;
  /** Auto-mode: width of the rolling observation window, in seconds. */
  autoWindowSeconds: number;
};

const DEFAULTS = {
  maxTtlSeconds: 300,
  staleWhileRevalidateSeconds: 600,
  purgeBatchSize: 200,
  autoRequestRateThreshold: 5,
  autoLatencyThresholdMs: 250,
  autoWindowSeconds: 60
} as const;

const MODES: readonly EdgeCacheMode[] = ["off", "auto", "on"];

/**
 * Parse a bounded positive integer. Anything unparseable, negative, or above
 * `max` falls back to the default rather than throwing — a malformed tuning
 * value must never take the site down, and every one of these knobs has a safe
 * default. (The security-relevant values are not tuned here: they are structural,
 * in `cacheability.ts`.)
 */
function readBoundedInt(
  raw: string | undefined,
  fallback: number,
  max: number
): number {
  if (raw === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(raw.trim(), 10);

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > max) {
    return fallback;
  }

  return parsed;
}

function readNonEmpty(raw: string | undefined): string | null {
  const trimmed = raw?.trim() ?? "";

  return trimmed.length > 0 ? trimmed : null;
}

export function loadEdgeCacheConfig(
  env: EdgeCacheEnvironment = process.env
): EdgeCacheConfig {
  const rawMode = env.EDGE_CACHE_MODE?.trim().toLowerCase();
  const mode: EdgeCacheMode = MODES.includes(rawMode as EdgeCacheMode)
    ? (rawMode as EdgeCacheMode)
    : "off";

  return {
    mode,
    maxTtlSeconds: readBoundedInt(
      env.EDGE_CACHE_MAX_TTL_SECONDS,
      DEFAULTS.maxTtlSeconds,
      86_400
    ),
    staleWhileRevalidateSeconds: readBoundedInt(
      env.EDGE_CACHE_STALE_WHILE_REVALIDATE_SECONDS,
      DEFAULTS.staleWhileRevalidateSeconds,
      86_400
    ),
    purgeEndpoint: readNonEmpty(env.EDGE_CACHE_PURGE_ENDPOINT),
    purgeToken: readNonEmpty(env.EDGE_CACHE_PURGE_TOKEN),
    purgeBatchSize: readBoundedInt(
      env.EDGE_CACHE_PURGE_BATCH_SIZE,
      DEFAULTS.purgeBatchSize,
      5_000
    ),
    autoRequestRateThreshold: readBoundedInt(
      env.EDGE_CACHE_AUTO_REQUEST_RATE_THRESHOLD,
      DEFAULTS.autoRequestRateThreshold,
      100_000
    ),
    autoLatencyThresholdMs: readBoundedInt(
      env.EDGE_CACHE_AUTO_LATENCY_THRESHOLD_MS,
      DEFAULTS.autoLatencyThresholdMs,
      60_000
    ),
    autoWindowSeconds: readBoundedInt(
      env.EDGE_CACHE_AUTO_WINDOW_SECONDS,
      DEFAULTS.autoWindowSeconds,
      3_600
    )
  };
}

/** True when the subsystem should emit surrogate headers at all. */
export function isEdgeCacheActive(config: EdgeCacheConfig): boolean {
  return config.mode !== "off";
}

export type EdgeCacheValidationFinding = {
  severity: "warning" | "fail";
  code: string;
  message: string;
};

/**
 * Validate a loaded config for `validate-env` / `security:readiness`.
 *
 * The one **fail** is a purge endpoint with no token: that combination means the
 * app would issue unauthenticated BANs, and the bundled VCL would reject them,
 * so invalidation silently never happens and the site serves stale content
 * indefinitely. Silent staleness is far worse than a loud startup error.
 */
export function validateEdgeCacheConfig(
  config: EdgeCacheConfig
): EdgeCacheValidationFinding[] {
  const findings: EdgeCacheValidationFinding[] = [];

  if (config.mode === "off") {
    return findings;
  }

  if (!config.purgeEndpoint) {
    findings.push({
      severity: "warning",
      code: "edge_cache_purge_endpoint_missing",
      message:
        "EDGE_CACHE_MODE is enabled but EDGE_CACHE_PURGE_ENDPOINT is unset — content edits will not be invalidated at the edge and will stay visible until the TTL expires."
    });
  }

  if (config.purgeEndpoint && !config.purgeToken) {
    findings.push({
      severity: "fail",
      code: "edge_cache_purge_token_missing",
      message:
        "EDGE_CACHE_PURGE_ENDPOINT is set without EDGE_CACHE_PURGE_TOKEN — the bundled VCL rejects unauthenticated BAN requests, so every invalidation would fail silently."
    });
  }

  if (config.staleWhileRevalidateSeconds > 0 && config.maxTtlSeconds === 0) {
    findings.push({
      severity: "warning",
      code: "edge_cache_ttl_zero",
      message:
        "EDGE_CACHE_MAX_TTL_SECONDS is 0, so nothing will ever be cached even though the edge cache is enabled."
    });
  }

  return findings;
}
