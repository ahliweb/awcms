/**
 * WhatsApp delivery configuration boundary (Issue #963, ADR-0133 section 5).
 * Pure: no `process.env` read at module scope, every resolver takes the `env`
 * it is given (the split `push-delivery/domain/push-config.ts` uses).
 *
 * ## Credentials of the DEPLOYMENT sender are per-deployment
 *
 * A WhatsApp token in this file's environment authenticates the deployment's
 * own sender (`senderAccountId = null`), not a tenant. A request-supplied token
 * would let one tenant's admin make the deployment speak as someone else
 * (ADR-0074 section 5), so there is no per-request override and no input that
 * could carry one. Values arrive from the environment only.
 *
 * A TENANT-OWNED sender (Issue #1141, ADR-0148 section 5) is a different thing:
 * its adapter and credential are resolved from that tenant's own
 * `channel_accounts` record, in the dispatcher, never from the environment and
 * never from a request. Nothing in this file selects a provider for it.
 */

/**
 * `log` is the safe default and the only provider that needs no credentials: it
 * records "would have sent" and always succeeds. A missing or unknown
 * `WHATSAPP_PROVIDER` does NOT silently become `log` — it resolves to a
 * misconfigured provider that fails non-retryably, so a typo cannot masquerade
 * as healthy delivery. Only an EXPLICIT `log` (or `WHATSAPP_PROVIDER` unset
 * while the module is disabled, where no provider is touched at all) records.
 */
export const KNOWN_WHATSAPP_PROVIDERS = ["log", "fonnte", "meta"] as const;

export type WhatsappProviderKind = (typeof KNOWN_WHATSAPP_PROVIDERS)[number];

export function isKnownWhatsappProvider(
  value: string | undefined
): value is WhatsappProviderKind {
  return (KNOWN_WHATSAPP_PROVIDERS as readonly string[]).includes(value ?? "");
}

/**
 * The key the adapters FEED (`recordSuccess`/`recordFailure`) and the
 * dispatcher READS (`canAttempt`). One constant so the two cannot drift apart
 * silently: a dispatcher consulting a breaker nothing trips reports
 * `breakerOpen: false` forever while hammering a provider that is down.
 */
export const WHATSAPP_CIRCUIT_BREAKER_KEY = "whatsapp-delivery";

/**
 * The Meta Graph API version used when `WHATSAPP_META_API_VERSION` is unset.
 * One constant, read by every path that builds a Graph URL: the provider
 * changelog register pins THIS declaration, so a bump here is one edit and one
 * register update, not three call sites that can drift apart.
 */
export const WHATSAPP_META_DEFAULT_API_VERSION = "v21.0";

/**
 * The breaker of ONE tenant-owned sender. Each sender has its own, so a failing
 * number cannot stop another sender (or the deployment sender, which keeps
 * {@link WHATSAPP_CIRCUIT_BREAKER_KEY}). Keyed by the account id (a uuid), never
 * by a number or a token, so the key is safe in a log line and a metric label.
 */
export function whatsappSenderBreakerKey(senderAccountId: string): string {
  return `${WHATSAPP_CIRCUIT_BREAKER_KEY}:sender:${senderAccountId}`;
}

export const DEFAULT_WHATSAPP_SEND_MAX_RETRIES = 3;
/** Per-sender caps, counted from what the sender really sent (trailing hour and day). Provider limits are lower for some numbers and unofficial devices; these are the deployment-wide ceiling, not a promise. */
export const DEFAULT_WHATSAPP_SENDER_RATE_PER_HOUR = 1000;
export const DEFAULT_WHATSAPP_SENDER_RATE_PER_DAY = 10_000;
/** How many rows of one claimed lane are sent before the sender's verdict and credential are resolved afresh (Issue #1231 L1). */
export const DEFAULT_WHATSAPP_SENDER_REVALIDATE_EVERY_ROWS = 10;
export const DEFAULT_WHATSAPP_SEND_TIMEOUT_MS = 10_000;
export const DEFAULT_WHATSAPP_RATE_PER_RECIPIENT_PER_HOUR = 10;
export const DEFAULT_WHATSAPP_RATE_PER_TENANT_PER_HOUR = 2000;
/** `security` messages (OTP) have their OWN, tighter per-recipient bucket, so marketing and notices can never exhaust it and an OTP flood cannot be used to spam one number. */
export const DEFAULT_WHATSAPP_RATE_SECURITY_PER_RECIPIENT_PER_HOUR = 5;

/** Off by default. `WHATSAPP_ENABLED=true` turns the whole capability on. */
export function isWhatsappEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.WHATSAPP_ENABLED === "true";
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

export function resolveWhatsappSendTimeoutMs(
  env: NodeJS.ProcessEnv = process.env
): number {
  return positiveNumber(
    env.WHATSAPP_SEND_TIMEOUT_MS,
    DEFAULT_WHATSAPP_SEND_TIMEOUT_MS
  );
}

/** Zero is legitimate ("never retry") and survives. */
export function resolveWhatsappSendMaxRetries(
  env: NodeJS.ProcessEnv = process.env
): number {
  return positiveNumber(
    env.WHATSAPP_SEND_MAX_RETRIES,
    DEFAULT_WHATSAPP_SEND_MAX_RETRIES,
    true
  );
}

export function resolveWhatsappRatePerRecipientPerHour(
  env: NodeJS.ProcessEnv = process.env
): number {
  return Math.floor(
    positiveNumber(
      env.WHATSAPP_RATE_PER_RECIPIENT_PER_HOUR,
      DEFAULT_WHATSAPP_RATE_PER_RECIPIENT_PER_HOUR
    )
  );
}

export function resolveWhatsappRateSecurityPerRecipientPerHour(
  env: NodeJS.ProcessEnv = process.env
): number {
  return Math.floor(
    positiveNumber(
      env.WHATSAPP_RATE_SECURITY_PER_RECIPIENT_PER_HOUR,
      DEFAULT_WHATSAPP_RATE_SECURITY_PER_RECIPIENT_PER_HOUR
    )
  );
}

/** Messages one SENDER may have sent in the trailing hour before the dispatcher stops claiming its rows (they wait; nothing is rerouted). */
export function resolveWhatsappSenderRatePerHour(
  env: NodeJS.ProcessEnv = process.env
): number {
  return Math.floor(
    positiveNumber(
      env.WHATSAPP_SENDER_RATE_PER_HOUR,
      DEFAULT_WHATSAPP_SENDER_RATE_PER_HOUR
    )
  );
}

/**
 * Rows of one claimed sender lane a pass sends before it re-asks whether the
 * sender may still send and re-reads its credential (Issue #1231 L1). A
 * revocation lands within this many rows (at most N x the send timeout) rather
 * than after the whole claimed batch. `1` re-checks before every row.
 */
export function resolveWhatsappSenderRevalidateEveryRows(
  env: NodeJS.ProcessEnv = process.env
): number {
  return Math.max(
    1,
    Math.floor(
      positiveNumber(
        env.WHATSAPP_SENDER_REVALIDATE_EVERY_ROWS,
        DEFAULT_WHATSAPP_SENDER_REVALIDATE_EVERY_ROWS
      )
    )
  );
}

/** The same, for the trailing day. */
export function resolveWhatsappSenderRatePerDay(
  env: NodeJS.ProcessEnv = process.env
): number {
  return Math.floor(
    positiveNumber(
      env.WHATSAPP_SENDER_RATE_PER_DAY,
      DEFAULT_WHATSAPP_SENDER_RATE_PER_DAY
    )
  );
}

export function resolveWhatsappRatePerTenantPerHour(
  env: NodeJS.ProcessEnv = process.env
): number {
  return Math.floor(
    positiveNumber(
      env.WHATSAPP_RATE_PER_TENANT_PER_HOUR,
      DEFAULT_WHATSAPP_RATE_PER_TENANT_PER_HOUR
    )
  );
}

/**
 * Digits only, no leading plus or zero (e.g. `62`). When set, a national number
 * written with a leading `0` (`0812...`) is read as that country's. Unset means
 * NO guessing: a number must then carry its own `+` or `00` prefix, because a
 * wrong guess delivers a message to a stranger.
 */
export function resolveWhatsappDefaultCountryCode(
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  const configured = env.WHATSAPP_DEFAULT_COUNTRY_CODE?.trim();

  return configured && /^[1-9]\d{0,3}$/.test(configured)
    ? configured
    : undefined;
}
