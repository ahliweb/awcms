/**
 * Mailketing webhook switches (Issue #1161). Pure.
 *
 * `EMAIL_WEBHOOK_ENABLED` is OFF by default: the callback route answers `404`
 * without reading anything (ADR-0151 section 5, "the endpoint exists only
 * behind a flag"). The mode is fixed at `strict`; there is no variable for it,
 * because `restrictive-only` and `authenticated` each need an ADR decision
 * first (Q1, Q6), not an operator's environment edit.
 */
export function isEmailWebhookEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.EMAIL_WEBHOOK_ENABLED === "true";
}

export const EMAIL_WEBHOOK_MODE = "strict" as const;

export const DEFAULT_EMAIL_WEBHOOK_RATE_PER_MINUTE = 120;

/**
 * Accepted requests per minute per callback credential (after proof).
 * `EMAIL_WEBHOOK_RATE_PER_MINUTE`: 10..6000, default 120; malformed = default.
 */
export function resolveEmailWebhookRatePerMinute(
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = env.EMAIL_WEBHOOK_RATE_PER_MINUTE;

  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_EMAIL_WEBHOOK_RATE_PER_MINUTE;
  }

  const parsed = Number(raw);

  return Number.isInteger(parsed) && parsed >= 10 && parsed <= 6000
    ? parsed
    : DEFAULT_EMAIL_WEBHOOK_RATE_PER_MINUTE;
}

/**
 * FAILED proofs per minute per client address before `429` (audit M-1 of PR
 * #1272). Every request is charged to this bucket BEFORE any database work and
 * the charge is refunded once the request verifies, so legitimate traffic from
 * Mailketing's shared addresses never fills it (one tenant cannot drown
 * another), while an address that keeps guessing is refused without a query.
 * The key is the resolved client address only, never a value the caller chose.
 */
export const EMAIL_WEBHOOK_DENIED_RATE_PER_MINUTE = 30;

export const DEFAULT_EMAIL_WEBHOOK_MAX_PENDING = 5000;

/**
 * At most this many PENDING (unreviewed) events per tenant (audit M-2 of PR
 * #1272). When the review queue is full, further bounces and unsubscribes are
 * NOT recorded (counted as `quota_exceeded`, logged at warning): the queue is a
 * human workload, and a flood must not bury the reports already waiting.
 * Nothing is lost that this mode would have acted on by itself, because strict
 * mode acts on nothing; operators clear the queue and the provider's own
 * dashboard still shows the events. `EMAIL_WEBHOOK_MAX_PENDING`: 100..100000.
 */
export function resolveEmailWebhookMaxPending(
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = env.EMAIL_WEBHOOK_MAX_PENDING;

  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_EMAIL_WEBHOOK_MAX_PENDING;
  }

  const parsed = Number(raw);

  return Number.isInteger(parsed) && parsed >= 100 && parsed <= 100_000
    ? parsed
    : DEFAULT_EMAIL_WEBHOOK_MAX_PENDING;
}
