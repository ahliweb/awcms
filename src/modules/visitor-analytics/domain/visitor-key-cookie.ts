/**
 * Anonymous visitor-key cookie lifecycle policy (ported from awcms-micro
 * epic #617-#624). Pure — no actual cookie/request I/O here; the public
 * visit-ingest endpoint (`src/pages/api/v1/analytics/collect.ts`) is the
 * sole caller and translates these decisions into real
 * `cookies.set`/`.delete` calls.
 *
 * In awcms-micro these two functions were driven from `src/middleware.ts`
 * (which observed every request). This base collects via an additive public
 * ingest endpoint instead (`src/middleware.ts` is intentionally untouched),
 * so the endpoint itself is the single caller:
 *
 * 1. `shouldRevokeVisitorKeyCookie` — true only when the module's master
 *    switch is off AND a (previously valid) cookie is still present. A
 *    browser that already carries the old persistent identifier (e.g. from
 *    before the module was disabled) has it actively cleared rather than
 *    left to linger.
 * 2. `planVisitorKeyCookie` — called after the enabled/collect gate has
 *    passed. Always resolves a usable visitor key (reusing a valid existing
 *    one, minting a fresh one otherwise) and reports whether a `Set-Cookie`
 *    is actually needed. The `maxAgeSeconds` is operator-configurable
 *    (`VISITOR_ANALYTICS_VISITOR_KEY_COOKIE_TTL_DAYS`, 30 days by default).
 *    Once the browser expires the cookie, the next request mints a fresh key
 *    — natural rotation without any additional server-side bookkeeping.
 */
import { resolveVisitorKey, isValidVisitorKey } from "./visitor-key";
import {
  resolveVisitorKeyCookieMaxAgeSeconds,
  type VisitorAnalyticsConfig
} from "./visitor-analytics-config";

export function shouldRevokeVisitorKeyCookie(input: {
  config: Pick<VisitorAnalyticsConfig, "enabled">;
  existingValue: string | undefined;
}): boolean {
  return !input.config.enabled && isValidVisitorKey(input.existingValue);
}

export type VisitorKeyCookiePlan = {
  value: string;
  shouldSetCookie: boolean;
  maxAgeSeconds: number;
};

/**
 * Only meaningful (and only ever called) when the module is enabled and this
 * request is being collected — callers must check
 * `shouldRevokeVisitorKeyCookie` and the collect gate first.
 */
export function planVisitorKeyCookie(input: {
  config: Pick<VisitorAnalyticsConfig, "visitorKeyCookieTtlDays">;
  existingValue: string | undefined;
}): VisitorKeyCookiePlan {
  const { config, existingValue } = input;
  const value = resolveVisitorKey(existingValue);

  return {
    value,
    shouldSetCookie: value !== existingValue,
    maxAgeSeconds: resolveVisitorKeyCookieMaxAgeSeconds(config)
  };
}
