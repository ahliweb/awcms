/**
 * Telegram delivery configuration boundary (Issue #965, ADR-0140 sections 2, 5
 * and 6). Pure: no `process.env` read at module scope, every resolver takes the
 * `env` it is given (the split `whatsapp-delivery/domain/whatsapp-config.ts` and
 * `push-delivery/domain/push-config.ts` use).
 *
 * ## Credentials are per-DEPLOYMENT, never per-tenant
 *
 * One bot per deployment. A tenant-supplied token would let one tenant's admin
 * make the deployment speak as someone else (ADR-0074 section 5), so there is no
 * per-tenant override and no column that could hold one. The token, the webhook
 * secret and both key rings arrive from the environment only.
 *
 * The literal `env.NAME` spelling is kept at every read: the job env allow-list
 * scanner finds variables by that spelling, and a dynamic lookup would drop it.
 */
import {
  resolveKeyRing,
  STRICT_KEY_RING_OPTIONS,
  type KeyRingResult
} from "../../../lib/security/field-encryption";

/** Off by default. `TELEGRAM_ENABLED=true` turns the deployment-level switch on (level 1 of 3). */
export function isTelegramEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.TELEGRAM_ENABLED === "true";
}

function positiveNumber(
  raw: string | undefined,
  fallback: number,
  allowZero = false
): number {
  const configured = raw?.trim();

  // `Number("")` is 0, finite and non-negative: an empty variable would read as
  // a deliberate "never retry" instead of as unset.
  if (!configured) {
    return fallback;
  }

  const value = Number(configured);

  if (!Number.isFinite(value)) {
    return fallback;
  }

  return (allowZero ? value >= 0 : value > 0) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const DEFAULT_TELEGRAM_SEND_TIMEOUT_MS = 10_000;
export const DEFAULT_TELEGRAM_SEND_MAX_RETRIES = 3;
/** ADR-0140 section 5.4: at least one second per chat. The floor, not just the default. */
export const MIN_TELEGRAM_PER_CHAT_INTERVAL_MS = 1000;
/** ADR-0140 section 5.4: a global ceiling BELOW 30 per second. The cap, not just the default. */
export const DEFAULT_TELEGRAM_GLOBAL_PER_SECOND = 20;
export const MAX_TELEGRAM_GLOBAL_PER_SECOND = 25;
export const DEFAULT_TELEGRAM_RETRY_AFTER_CAP_SECONDS = 300;
export const DEFAULT_TELEGRAM_DISPATCH_BATCH_SIZE = 25;
export const DEFAULT_TELEGRAM_RATE_PER_BINDING_PER_HOUR = 30;
export const DEFAULT_TELEGRAM_RATE_PER_TENANT_PER_HOUR = 1000;
export const DEFAULT_TELEGRAM_WEBHOOK_RATE_PER_MINUTE = 120;
/**
 * Updates per minute from ONE chat (Issue #1008, L3). A fixed ceiling and not a
 * setting: a person sends a handful of commands, so there is nothing to tune,
 * and a setting nobody needs is one more variable to document and validate.
 */
export const TELEGRAM_WEBHOOK_CHAT_RATE_PER_MINUTE = 10;

export const DEFAULT_TELEGRAM_MESSAGE_RETENTION_DAYS = 14;
export const DEFAULT_TELEGRAM_BINDING_RETENTION_DAYS = 90;
export const DEFAULT_TELEGRAM_LINK_CODE_RETENTION_DAYS = 1;

export function resolveTelegramSendTimeoutMs(
  env: NodeJS.ProcessEnv = process.env
): number {
  return positiveNumber(
    env.TELEGRAM_SEND_TIMEOUT_MS,
    DEFAULT_TELEGRAM_SEND_TIMEOUT_MS
  );
}

/** Zero is legitimate ("never retry") and survives. */
export function resolveTelegramSendMaxRetries(
  env: NodeJS.ProcessEnv = process.env
): number {
  return Math.floor(
    positiveNumber(
      env.TELEGRAM_SEND_MAX_RETRIES,
      DEFAULT_TELEGRAM_SEND_MAX_RETRIES,
      true
    )
  );
}

/** Never below one second: Telegram documents about one message per second per chat. */
export function resolveTelegramPerChatIntervalMs(
  env: NodeJS.ProcessEnv = process.env
): number {
  return Math.max(
    MIN_TELEGRAM_PER_CHAT_INTERVAL_MS,
    Math.floor(
      positiveNumber(
        env.TELEGRAM_RATE_PER_CHAT_INTERVAL_MS,
        MIN_TELEGRAM_PER_CHAT_INTERVAL_MS
      )
    )
  );
}

/** Never at or above 30 per second, however it is configured. */
export function resolveTelegramGlobalPerSecond(
  env: NodeJS.ProcessEnv = process.env
): number {
  return clamp(
    Math.floor(
      positiveNumber(
        env.TELEGRAM_RATE_GLOBAL_PER_SECOND,
        DEFAULT_TELEGRAM_GLOBAL_PER_SECOND
      )
    ),
    1,
    MAX_TELEGRAM_GLOBAL_PER_SECOND
  );
}

/** The bound on how far a `429`'s `retry_after` can push a row, so a hostile or buggy value cannot park the queue. */
export function resolveTelegramRetryAfterCapSeconds(
  env: NodeJS.ProcessEnv = process.env
): number {
  return Math.floor(
    positiveNumber(
      env.TELEGRAM_RETRY_AFTER_CAP_SECONDS,
      DEFAULT_TELEGRAM_RETRY_AFTER_CAP_SECONDS
    )
  );
}

export function resolveTelegramDispatchBatchSize(
  env: NodeJS.ProcessEnv = process.env
): number {
  return clamp(
    Math.floor(
      positiveNumber(
        env.TELEGRAM_DISPATCH_BATCH_SIZE,
        DEFAULT_TELEGRAM_DISPATCH_BATCH_SIZE
      )
    ),
    1,
    200
  );
}

export function resolveTelegramRatePerBindingPerHour(
  env: NodeJS.ProcessEnv = process.env
): number {
  return Math.floor(
    positiveNumber(
      env.TELEGRAM_RATE_PER_BINDING_PER_HOUR,
      DEFAULT_TELEGRAM_RATE_PER_BINDING_PER_HOUR
    )
  );
}

export function resolveTelegramRatePerTenantPerHour(
  env: NodeJS.ProcessEnv = process.env
): number {
  return Math.floor(
    positiveNumber(
      env.TELEGRAM_RATE_PER_TENANT_PER_HOUR,
      DEFAULT_TELEGRAM_RATE_PER_TENANT_PER_HOUR
    )
  );
}

export function resolveTelegramWebhookRatePerMinute(
  env: NodeJS.ProcessEnv = process.env
): number {
  return Math.floor(
    positiveNumber(
      env.TELEGRAM_WEBHOOK_RATE_PER_MINUTE,
      DEFAULT_TELEGRAM_WEBHOOK_RATE_PER_MINUTE
    )
  );
}

/**
 * Retention is a setting within the descriptor's own bounds (ADR-0140 section 9,
 * "the 14-day and 90-day retention values as settings"): `module.ts` declares
 * the same min/max, and the registry gate refuses a default outside them.
 */
export function resolveTelegramMessageRetentionDays(
  env: NodeJS.ProcessEnv = process.env
): number {
  return clamp(
    Math.floor(
      positiveNumber(
        env.TELEGRAM_MESSAGE_RETENTION_DAYS,
        DEFAULT_TELEGRAM_MESSAGE_RETENTION_DAYS
      )
    ),
    1,
    90
  );
}

export function resolveTelegramBindingRetentionDays(
  env: NodeJS.ProcessEnv = process.env
): number {
  return clamp(
    Math.floor(
      positiveNumber(
        env.TELEGRAM_BINDING_RETENTION_DAYS,
        DEFAULT_TELEGRAM_BINDING_RETENTION_DAYS
      )
    ),
    7,
    365
  );
}

export function resolveTelegramLinkCodeRetentionDays(
  env: NodeJS.ProcessEnv = process.env
): number {
  return clamp(
    Math.floor(
      positiveNumber(
        env.TELEGRAM_LINK_CODE_RETENTION_DAYS,
        DEFAULT_TELEGRAM_LINK_CODE_RETENTION_DAYS
      )
    ),
    1,
    30
  );
}

/** Telegram bot usernames: 5-32 characters, letters, digits and underscore, starting with a letter. */
const BOT_USERNAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;

export function resolveTelegramBotUsername(
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  const configured = env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "");

  return configured && BOT_USERNAME_PATTERN.test(configured)
    ? configured
    : undefined;
}

/**
 * Telegram's `secret_token` rule is 1-256 characters from `A-Za-z0-9_-`. This
 * module is stricter, because the header is the ONLY thing standing between the
 * public internet and the webhook: at least 43 characters (43 base64url
 * characters carry 256 bits; the floor is the 128-bit minimum with margin for a
 * hand-typed value), at least 12 DISTINCT characters (so `aaaa...` and a short
 * pattern repeated are refused), and none of the documented placeholder words
 * (this repo is public, so a placeholder is public knowledge).
 *
 * Applied by `config:validate` AND by the webhook at request time
 * (`verifyWebhookSecret`): a deployment started without running the validator
 * still refuses every request on a weak server secret.
 */
const WEBHOOK_SECRET_PATTERN = /^[A-Za-z0-9_-]{43,256}$/;
export const TELEGRAM_WEBHOOK_SECRET_MIN_LENGTH = 43;
const WEBHOOK_SECRET_MIN_DISTINCT_CHARACTERS = 12;

/**
 * Mirrors `PLACEHOLDER_SECRETS` in `scripts/validate-env.ts` and
 * `client-fingerprint.ts` (three copies already exist and none is exported), plus
 * the words that make a hand-typed secret guessable. Matched as a substring of
 * the lower-cased value, so `change-me-change-me-...` is refused too.
 */
export const TELEGRAM_PLACEHOLDER_SECRET_WORDS: readonly string[] = [
  "change-me",
  "changeme",
  "secret",
  "replace-me",
  "replaceme",
  "password",
  "example",
  "placeholder",
  "telegram",
  "webhook",
  "your-",
  "xxxx"
];

export function isValidTelegramWebhookSecret(
  value: string | undefined
): value is string {
  if (typeof value !== "string" || !WEBHOOK_SECRET_PATTERN.test(value)) {
    return false;
  }

  if (new Set(value).size < WEBHOOK_SECRET_MIN_DISTINCT_CHARACTERS) {
    return false;
  }

  const lower = value.toLowerCase();

  return !TELEGRAM_PLACEHOLDER_SECRET_WORDS.some((word) =>
    lower.includes(word)
  );
}

/** The bot token's shape: `<bot id>:<35 base64url-ish characters>`. Used to validate configuration and to redact. */
export const TELEGRAM_BOT_TOKEN_PATTERN = /^\d{5,15}:[A-Za-z0-9_-]{30,}$/;

export function isValidTelegramBotToken(
  value: string | undefined
): value is string {
  return typeof value === "string" && TELEGRAM_BOT_TOKEN_PATTERN.test(value);
}

/**
 * The two rings as the environment spells them, with no distinctness check. The
 * config validator uses these so it can word the problem itself; everything that
 * RUNS uses the checked resolvers below.
 */
export function resolveTelegramEncryptionRingUnchecked(
  env: NodeJS.ProcessEnv = process.env
): KeyRingResult {
  return resolveKeyRing(
    "TELEGRAM_CHAT_ENCRYPTION_KEYS",
    { TELEGRAM_CHAT_ENCRYPTION_KEYS: env.TELEGRAM_CHAT_ENCRYPTION_KEYS },
    STRICT_KEY_RING_OPTIONS
  );
}

export function resolveTelegramHashRingUnchecked(
  env: NodeJS.ProcessEnv = process.env
): KeyRingResult {
  return resolveKeyRing(
    "TELEGRAM_CHAT_HASH_KEYS",
    { TELEGRAM_CHAT_HASH_KEYS: env.TELEGRAM_CHAT_HASH_KEYS },
    STRICT_KEY_RING_OPTIONS
  );
}

/**
 * True when the two rings share a key. A hash key that is also an encryption key
 * would make the keyed hash a function of key material that protects the
 * ciphertext (ADR-0140 section 6), so the rings must be separate.
 */
export function telegramRingsShareAKey(
  encryption: KeyRingResult,
  hash: KeyRingResult
): boolean {
  return (
    encryption.ok &&
    hash.ok &&
    encryption.keys.some((encryptionKey) =>
      hash.keys.some((hashKey) => hashKey.key.equals(encryptionKey.key))
    )
  );
}

const RINGS_NOT_DISTINCT_REASON =
  "TELEGRAM_CHAT_ENCRYPTION_KEYS and TELEGRAM_CHAT_HASH_KEYS must not share a key.";

/**
 * The chat-id encryption ring (`TELEGRAM_CHAT_ENCRYPTION_KEYS`): its own ring,
 * separate from the payout one and every other (ADR-0140 section 6). Fail closed:
 * `{ ok: false }` means no binding is created and the dispatcher sends nothing.
 *
 * Distinctness from the hash ring is enforced HERE, at runtime, and not only by
 * `config:validate` (Issue #1008, L11): a deployment started without running the
 * validator, or one whose environment was edited afterwards, still refuses to
 * encrypt or decrypt under a ring that overlaps the hash ring.
 */
export function resolveTelegramEncryptionRing(
  env: NodeJS.ProcessEnv = process.env
): KeyRingResult {
  const encryption = resolveTelegramEncryptionRingUnchecked(env);

  return telegramRingsShareAKey(
    encryption,
    resolveTelegramHashRingUnchecked(env)
  )
    ? { ok: false, reason: RINGS_NOT_DISTINCT_REASON }
    : encryption;
}

/** The keyed-hash ring (`TELEGRAM_CHAT_HASH_KEYS`), ADR-0137 section 3. Fail closed, and distinct from the encryption ring at runtime (Issue #1008, L11). */
export function resolveTelegramHashRing(
  env: NodeJS.ProcessEnv = process.env
): KeyRingResult {
  const hash = resolveTelegramHashRingUnchecked(env);

  return telegramRingsShareAKey(
    resolveTelegramEncryptionRingUnchecked(env),
    hash
  )
    ? { ok: false, reason: RINGS_NOT_DISTINCT_REASON }
    : hash;
}
