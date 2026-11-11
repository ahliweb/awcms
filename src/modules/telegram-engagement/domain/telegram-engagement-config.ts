/**
 * Deployment configuration for `telegram_engagement` (Issue #1156, ADR-0152).
 *
 * Off by default at three levels (ADR-0152 TG13): this deployment switch, the
 * module registry, and the tenant's own module toggle. With nothing configured
 * every route answers as if it did not exist and the dispatcher claims nothing.
 *
 * `TELEGRAM_ENGAGEMENT_KEYS` is the module's own key ring (ADR-0152 section 6:
 * "its own key ring"): `keyId:base64` pairs, the FIRST key writes, ALL read,
 * 32 bytes each, no default and no plaintext fallback. It encrypts a contact's
 * chat id and a queued message's text, and keys the account-scoped contact
 * hash. It must differ from every other ring (`config:validate`). Bot tokens and
 * webhook secrets are NOT under it: they are `channel_secrets` under
 * `CHANNEL_SECRETS_ENCRYPTION_KEYS` (ADR-0148 section 5).
 */
import {
  resolveKeyRing,
  STRICT_KEY_RING_OPTIONS,
  type KeyRingResult
} from "../../../lib/security/field-encryption";
import { parsePositiveIntSetting } from "../../../lib/security/env-thresholds";
import { DEFAULT_DEPLOYMENT_DAILY_CAP } from "./telegram-engagement-constants";

export function isTelegramEngagementEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.TELEGRAM_ENGAGEMENT_ENABLED === "true";
}

export function resolveTelegramEngagementRing(
  env: NodeJS.ProcessEnv = process.env
): KeyRingResult {
  return resolveKeyRing(
    "TELEGRAM_ENGAGEMENT_KEYS",
    { TELEGRAM_ENGAGEMENT_KEYS: env.TELEGRAM_ENGAGEMENT_KEYS },
    STRICT_KEY_RING_OPTIONS
  );
}

/**
 * FAILED verifications per caller address per minute (audit M-3 of PR #1260):
 * a verified request is never counted, so one tenant's busy bot cannot throttle
 * another tenant's (Telegram calls from a handful of shared addresses).
 */
export function resolveWebhookRatePerMinute(
  env: NodeJS.ProcessEnv = process.env
): number {
  return parsePositiveIntSetting(
    env.TELEGRAM_ENGAGEMENT_WEBHOOK_RATE_PER_MINUTE,
    60,
    "TELEGRAM_ENGAGEMENT_WEBHOOK_RATE_PER_MINUTE"
  );
}

/** Per-endpoint ceiling on the webhook, per minute: one bot's flood cannot starve another's. */
export function resolveEndpointRatePerMinute(
  env: NodeJS.ProcessEnv = process.env
): number {
  return parsePositiveIntSetting(
    env.TELEGRAM_ENGAGEMENT_ENDPOINT_RATE_PER_MINUTE,
    300,
    "TELEGRAM_ENGAGEMENT_ENDPOINT_RATE_PER_MINUTE"
  );
}

/** The deployment cap a tenant's per-bot daily ceiling can never exceed (ADR-0152 O10). */
export function resolveDeploymentDailyCap(
  env: NodeJS.ProcessEnv = process.env
): number {
  return parsePositiveIntSetting(
    env.TELEGRAM_ENGAGEMENT_DAILY_CAP,
    DEFAULT_DEPLOYMENT_DAILY_CAP,
    "TELEGRAM_ENGAGEMENT_DAILY_CAP"
  );
}

/**
 * The deployment origin the webhook URL is built from. `APP_URL` ONLY, and only
 * an `https:` origin (the Bot API's webhook requirement, ADR-0152 section 4):
 * `null` means no webhook can be registered, never a built-in fallback host.
 */
export function resolveWebhookOrigin(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const raw = (env.APP_URL ?? "").trim();

  if (raw === "") return null;

  try {
    const url = new URL(raw);

    if (url.protocol !== "https:" || url.username || url.password) return null;

    return url.origin;
  } catch {
    return null;
  }
}
