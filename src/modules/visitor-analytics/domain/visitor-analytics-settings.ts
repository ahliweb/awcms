/**
 * The NON-secret half of the `visitor_analytics` configuration (Issue #1132).
 *
 * `visitor-analytics-config.ts` resolves the whole block, including
 * `VISITOR_ANALYTICS_HASH_SALT`. `analytics:purge` only needs the retention
 * windows, but importing that file made `ops/run-job.sh` hand it the salt (Issue
 * #1120 grants a job every secret its import graph can reach), and whoever holds
 * the salt can link hashed visitors across days. Only the collector uses it.
 *
 * This file resolves everything else and NEVER reads the salt, nor imports a file
 * that does. `resolveVisitorAnalyticsConfig()` composes it with the salt, so
 * the two cannot drift: every non-secret field comes from here. A caller that
 * does not hash anything should call `resolveVisitorAnalyticsSettings()`.
 *
 * Do not add a secret to this file: `tests/jobs-env-scoped-reach.test.ts` holds
 * the job grants to the import graph and fails on the first edge that reaches one.
 */
export const VISITOR_ANALYTICS_MODES = ["basic", "detailed"] as const;

export type VisitorAnalyticsMode = (typeof VISITOR_ANALYTICS_MODES)[number];

export function isKnownVisitorAnalyticsMode(
  value: string | undefined
): value is VisitorAnalyticsMode {
  return (VISITOR_ANALYTICS_MODES as readonly string[]).includes(value ?? "");
}

export type VisitorAnalyticsSettings = {
  enabled: boolean;
  mode: VisitorAnalyticsMode;
  collectAdmin: boolean;
  collectPublic: boolean;
  collectApi: boolean;
  detailedEnabled: boolean;
  rawIpEnabled: boolean;
  rawUserAgentEnabled: boolean;
  geoEnabled: boolean;
  trustProxy: boolean;
  trustCloudflare: boolean;
  onlineWindowSeconds: number;
  eventRetentionDays: number;
  rawDetailRetentionDays: number;
  rollupRetentionDays: number;
  /**
   * Lifetime (days) of the anonymous `awcms_visitor_key` cookie.
   * Deliberately short — the cookie is a persistent anonymous identifier,
   * so its lifetime is bounded to the same order of magnitude as the
   * module's *shortest* sensitive-data retention window
   * (`rawDetailRetentionDays`, 30 days default) rather than a multi-year
   * constant.
   */
  visitorKeyCookieTtlDays: number;
};

/** Safe defaults matching the module's `.env.example` block exactly (the hash salt's default, empty, is in `visitor-analytics-config.ts`). */
export const VISITOR_ANALYTICS_SETTINGS_DEFAULTS: VisitorAnalyticsSettings = {
  enabled: false,
  mode: "basic",
  collectAdmin: true,
  collectPublic: true,
  collectApi: false,
  detailedEnabled: false,
  rawIpEnabled: false,
  rawUserAgentEnabled: false,
  geoEnabled: false,
  trustProxy: false,
  trustCloudflare: false,
  onlineWindowSeconds: 300,
  eventRetentionDays: 90,
  rawDetailRetentionDays: 30,
  rollupRetentionDays: 730,
  visitorKeyCookieTtlDays: 30
};

function isSet(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!isSet(value)) return fallback;
  return value === "true";
}

/** `undefined` when unset/blank/non-positive-integer — never throws, never NaN. */
export function parsePositiveInt(
  value: string | undefined
): number | undefined {
  if (!isSet(value)) return undefined;

  const trimmed = (value as string).trim();

  if (!/^\d+$/.test(trimmed)) return undefined;

  const parsed = Number.parseInt(trimmed, 10);

  return parsed > 0 ? parsed : undefined;
}

/**
 * Resolves every setting except the hash salt from `env`, falling back to
 * `VISITOR_ANALYTICS_SETTINGS_DEFAULTS` for anything unset or malformed. Never
 * throws — malformed numeric values are reported by `scripts/validate-env.ts`,
 * not here; this resolver always returns a usable config.
 */
export function resolveVisitorAnalyticsSettings(
  env: NodeJS.ProcessEnv = process.env
): VisitorAnalyticsSettings {
  const modeRaw = env.VISITOR_ANALYTICS_MODE;

  return {
    enabled: parseBoolean(
      env.VISITOR_ANALYTICS_ENABLED,
      VISITOR_ANALYTICS_SETTINGS_DEFAULTS.enabled
    ),
    mode: isKnownVisitorAnalyticsMode(modeRaw)
      ? modeRaw
      : VISITOR_ANALYTICS_SETTINGS_DEFAULTS.mode,
    collectAdmin: parseBoolean(
      env.VISITOR_ANALYTICS_COLLECT_ADMIN,
      VISITOR_ANALYTICS_SETTINGS_DEFAULTS.collectAdmin
    ),
    collectPublic: parseBoolean(
      env.VISITOR_ANALYTICS_COLLECT_PUBLIC,
      VISITOR_ANALYTICS_SETTINGS_DEFAULTS.collectPublic
    ),
    collectApi: parseBoolean(
      env.VISITOR_ANALYTICS_COLLECT_API,
      VISITOR_ANALYTICS_SETTINGS_DEFAULTS.collectApi
    ),
    detailedEnabled: parseBoolean(
      env.VISITOR_ANALYTICS_DETAILED_ENABLED,
      VISITOR_ANALYTICS_SETTINGS_DEFAULTS.detailedEnabled
    ),
    rawIpEnabled: parseBoolean(
      env.VISITOR_ANALYTICS_RAW_IP_ENABLED,
      VISITOR_ANALYTICS_SETTINGS_DEFAULTS.rawIpEnabled
    ),
    rawUserAgentEnabled: parseBoolean(
      env.VISITOR_ANALYTICS_RAW_USER_AGENT_ENABLED,
      VISITOR_ANALYTICS_SETTINGS_DEFAULTS.rawUserAgentEnabled
    ),
    geoEnabled: parseBoolean(
      env.VISITOR_ANALYTICS_GEO_ENABLED,
      VISITOR_ANALYTICS_SETTINGS_DEFAULTS.geoEnabled
    ),
    trustProxy: parseBoolean(
      env.VISITOR_ANALYTICS_TRUST_PROXY,
      VISITOR_ANALYTICS_SETTINGS_DEFAULTS.trustProxy
    ),
    trustCloudflare: parseBoolean(
      env.VISITOR_ANALYTICS_TRUST_CLOUDFLARE,
      VISITOR_ANALYTICS_SETTINGS_DEFAULTS.trustCloudflare
    ),
    onlineWindowSeconds:
      parsePositiveInt(env.VISITOR_ANALYTICS_ONLINE_WINDOW_SECONDS) ??
      VISITOR_ANALYTICS_SETTINGS_DEFAULTS.onlineWindowSeconds,
    eventRetentionDays:
      parsePositiveInt(env.VISITOR_ANALYTICS_EVENT_RETENTION_DAYS) ??
      VISITOR_ANALYTICS_SETTINGS_DEFAULTS.eventRetentionDays,
    rawDetailRetentionDays:
      parsePositiveInt(env.VISITOR_ANALYTICS_RAW_DETAIL_RETENTION_DAYS) ??
      VISITOR_ANALYTICS_SETTINGS_DEFAULTS.rawDetailRetentionDays,
    rollupRetentionDays:
      parsePositiveInt(env.VISITOR_ANALYTICS_ROLLUP_RETENTION_DAYS) ??
      VISITOR_ANALYTICS_SETTINGS_DEFAULTS.rollupRetentionDays,
    visitorKeyCookieTtlDays:
      parsePositiveInt(env.VISITOR_ANALYTICS_VISITOR_KEY_COOKIE_TTL_DAYS) ??
      VISITOR_ANALYTICS_SETTINGS_DEFAULTS.visitorKeyCookieTtlDays
  };
}
