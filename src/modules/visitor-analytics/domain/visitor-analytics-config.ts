/**
 * Privacy-first configuration gate for the `visitor_analytics` module
 * (ported from awcms-micro epic #617-#624). Pure — no `process.env` reads
 * outside `resolveVisitorAnalyticsConfig`/`isVisitorAnalyticsEnabled`;
 * `scripts/validate-env.ts` validates the raw env-var shape separately.
 *
 * This file only resolves/validates the env-var shape. It does not
 * collect, store, or process any visitor data — that is the collector
 * (`application/collector.ts`), the analytics queries, and the
 * rollup/retention jobs.
 *
 * `VISITOR_ANALYTICS_MODE=basic` is the privacy-first default: raw IP, raw
 * user-agent, and geolocation collection are all disabled by default and
 * require an explicit opt-in env var, independent of
 * `VISITOR_ANALYTICS_MODE` itself (the mode only distinguishes
 * aggregate-only `basic` collection from a future `detailed` mode with
 * richer session/event granularity — it never implies the raw-detail flags
 * below turn on by itself).
 *
 * The module's master switch (`enabled`) defaults to `false` — a fresh
 * installation collects nothing until an operator explicitly sets
 * `VISITOR_ANALYTICS_ENABLED=true` after making their own lawful-
 * purpose/consent decision (this software setting is a technical switch,
 * never itself the legal basis required by UU PDP). An operator that sets
 * the flag explicitly is unaffected; explicit values always win over the
 * default here.
 */
import {
  VISITOR_ANALYTICS_SETTINGS_DEFAULTS,
  resolveVisitorAnalyticsSettings,
  type VisitorAnalyticsSettings
} from "./visitor-analytics-settings";

// Kept importable from here: every existing caller reaches these through this
// file, and none of them is the salt.
export {
  VISITOR_ANALYTICS_MODES,
  isKnownVisitorAnalyticsMode,
  parsePositiveInt,
  type VisitorAnalyticsMode
} from "./visitor-analytics-settings";

/**
 * `VisitorAnalyticsSettings` (everything a job that does not hash may read) plus
 * the hash salt. Callers that never hash should take the settings from
 * `resolveVisitorAnalyticsSettings` in `visitor-analytics-settings.ts` instead
 * (Issue #1132): this file reads `VISITOR_ANALYTICS_HASH_SALT`.
 */
export type VisitorAnalyticsConfig = VisitorAnalyticsSettings & {
  hashSalt: string;
};

/** Safe defaults matching the module's `.env.example` block exactly. */
export const VISITOR_ANALYTICS_DEFAULTS: VisitorAnalyticsConfig = {
  ...VISITOR_ANALYTICS_SETTINGS_DEFAULTS,
  hashSalt: ""
};

/**
 * The env var names whose value must parse as a positive integer when set —
 * checked by `validateEnv` in `scripts/validate-env.ts` and reused here so
 * both files agree on exactly which keys are "positive integer" shaped.
 */
export const VISITOR_ANALYTICS_POSITIVE_INT_VARS = [
  "VISITOR_ANALYTICS_ONLINE_WINDOW_SECONDS",
  "VISITOR_ANALYTICS_EVENT_RETENTION_DAYS",
  "VISITOR_ANALYTICS_RAW_DETAIL_RETENTION_DAYS",
  "VISITOR_ANALYTICS_ROLLUP_RETENTION_DAYS",
  "VISITOR_ANALYTICS_VISITOR_KEY_COOKIE_TTL_DAYS"
] as const;

/**
 * Resolves the full config from `env`: the settings from
 * `resolveVisitorAnalyticsSettings` plus the hash salt. Never throws — malformed
 * numeric values are reported by `scripts/validate-env.ts`, not here; this
 * resolver always returns a usable config.
 */
export function resolveVisitorAnalyticsConfig(
  env: NodeJS.ProcessEnv = process.env
): VisitorAnalyticsConfig {
  return {
    ...resolveVisitorAnalyticsSettings(env),
    hashSalt:
      env.VISITOR_ANALYTICS_HASH_SALT ?? VISITOR_ANALYTICS_DEFAULTS.hashSalt
  };
}

/**
 * The single boolean every real-work caller (collector, ingest endpoint)
 * should gate on.
 */
export function isVisitorAnalyticsEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return resolveVisitorAnalyticsConfig(env).enabled;
}

/**
 * Converts `visitorKeyCookieTtlDays` into the `maxAge` seconds value the
 * cookie API expects — the single place that does this conversion so no
 * caller ever hardcodes a TTL constant.
 */
export function resolveVisitorKeyCookieMaxAgeSeconds(
  config: Pick<VisitorAnalyticsConfig, "visitorKeyCookieTtlDays">
): number {
  return config.visitorKeyCookieTtlDays * 86_400;
}
