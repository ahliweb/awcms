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
 * Requests per minute per client address BEFORE the credential is checked:
 * every request counts, so guessing tokens and flooding the verification query
 * are both bounded. The key is the resolved client address only, never a value
 * the caller chose (a token, a path segment).
 */
export const EMAIL_WEBHOOK_PRE_VERIFY_RATE_PER_MINUTE = 300;

/** Failed proofs per minute per client address before `429`. */
export const EMAIL_WEBHOOK_DENIED_RATE_PER_MINUTE = 30;
