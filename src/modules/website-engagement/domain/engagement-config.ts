/**
 * Deployment configuration for `website_engagement` (Issue #1153, ADR-0155).
 *
 * `WEBSITE_ENGAGEMENT_KEYS` is the key ring that encrypts a submission's
 * contact details and keys every token and identifier hash: `keyId:base64`
 * pairs separated by commas, the FIRST key writes, ALL keys read, each exactly
 * 32 random bytes. It lives outside the database and its backups and has no
 * default and no plaintext fallback: without it the public endpoint answers a
 * generic refusal and no source can be created (fail closed). It is spelled out
 * in full in `resolveKeyRing`'s argument because the env-coverage scanner finds
 * variables by that spelling.
 */
import {
  resolveKeyRing,
  STRICT_KEY_RING_OPTIONS,
  type KeyRingResult
} from "../../../lib/security/field-encryption";
import { parsePositiveIntSetting } from "../../../lib/security/env-thresholds";

export function resolveWebsiteEngagementRing(
  env: NodeJS.ProcessEnv = process.env
): KeyRingResult {
  return resolveKeyRing(
    "WEBSITE_ENGAGEMENT_KEYS",
    { WEBSITE_ENGAGEMENT_KEYS: env.WEBSITE_ENGAGEMENT_KEYS },
    STRICT_KEY_RING_OPTIONS
  );
}

export type IntakeLimits = {
  perIpMax: number;
  perIpWindowSec: number;
  perSourceMax: number;
  perSourceWindowSec: number;
  /** Interactions have their own, lower, ceiling (audit M1). */
  perSourceInteractionMax: number;
};

/** Parsed, never coerced: `Number("x")` is NaN and `count > NaN` is false, which switches a limiter OFF. */
export function resolveIntakeLimits(
  env: NodeJS.ProcessEnv = process.env
): IntakeLimits {
  return {
    perIpMax: parsePositiveIntSetting(
      env.WEBSITE_ENGAGEMENT_RATE_LIMIT_MAX,
      10,
      "WEBSITE_ENGAGEMENT_RATE_LIMIT_MAX"
    ),
    perIpWindowSec: parsePositiveIntSetting(
      env.WEBSITE_ENGAGEMENT_RATE_LIMIT_WINDOW_SEC,
      300,
      "WEBSITE_ENGAGEMENT_RATE_LIMIT_WINDOW_SEC"
    ),
    perSourceMax: parsePositiveIntSetting(
      env.WEBSITE_ENGAGEMENT_SOURCE_RATE_LIMIT_MAX,
      300,
      "WEBSITE_ENGAGEMENT_SOURCE_RATE_LIMIT_MAX"
    ),
    perSourceWindowSec: parsePositiveIntSetting(
      env.WEBSITE_ENGAGEMENT_SOURCE_RATE_LIMIT_WINDOW_SEC,
      300,
      "WEBSITE_ENGAGEMENT_SOURCE_RATE_LIMIT_WINDOW_SEC"
    ),
    perSourceInteractionMax: parsePositiveIntSetting(
      env.WEBSITE_ENGAGEMENT_INTERACTION_RATE_LIMIT_MAX,
      120,
      "WEBSITE_ENGAGEMENT_INTERACTION_RATE_LIMIT_MAX"
    )
  };
}
