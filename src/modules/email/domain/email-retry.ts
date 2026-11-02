/**
 * Email send retry policy (Issue #495). Same shape as
 * `sync-storage/domain/object-queue.ts`'s `evaluateObjectRetry` — exponential
 * backoff (`2^retryCount` minutes), capped delay — but `maxRetries` is a
 * parameter here rather than a hardcoded constant, since Issue #493 already
 * made the retry ceiling operator-configurable (`EMAIL_SEND_MAX_RETRIES`,
 * `../domain/email-config.ts`), unlike the object queue's fixed
 * `OBJECT_SYNC_MAX_RETRIES`.
 */
export const EMAIL_MAX_RETRY_DELAY_MINUTES = 60;

/**
 * Total time a message may be held back for a provider that reports no credit
 * (Issue #1159). Past this the message fails with a named reason instead of
 * being delivered hours late (OTP / password reset).
 */
export const EMAIL_CREDIT_HOLD_BUDGET_MS = 60 * 60_000;

/** How long a configuration error defers a claimed message (no retry spent, no attempt written, never terminal). */
export const EMAIL_CONFIG_ERROR_HOLD_MS = 5 * 60_000;

export type EmailRetryEvaluation = {
  eligible: boolean;
  nextAttemptAt?: Date;
};

export function evaluateEmailRetry(
  retryCount: number,
  maxRetries: number,
  now: Date,
  /** A provider-requested minimum delay (429 `Retry-After`, Issue #1159). Never shortens the backoff. */
  minDelayMs = 0
): EmailRetryEvaluation {
  if (retryCount >= maxRetries) {
    return { eligible: false };
  }

  const delayMinutes = Math.min(2 ** retryCount, EMAIL_MAX_RETRY_DELAY_MINUTES);

  const delayMs = Math.max(
    delayMinutes * 60_000,
    Math.min(Math.max(minDelayMs, 0), EMAIL_MAX_RETRY_DELAY_MINUTES * 60_000)
  );

  return {
    eligible: true,
    nextAttemptAt: new Date(now.getTime() + delayMs)
  };
}
