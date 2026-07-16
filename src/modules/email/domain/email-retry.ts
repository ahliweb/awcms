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

export type EmailRetryEvaluation = {
  eligible: boolean;
  nextAttemptAt?: Date;
};

export function evaluateEmailRetry(
  retryCount: number,
  maxRetries: number,
  now: Date
): EmailRetryEvaluation {
  if (retryCount >= maxRetries) {
    return { eligible: false };
  }

  const delayMinutes = Math.min(2 ** retryCount, EMAIL_MAX_RETRY_DELAY_MINUTES);

  return {
    eligible: true,
    nextAttemptAt: new Date(now.getTime() + delayMinutes * 60_000)
  };
}
