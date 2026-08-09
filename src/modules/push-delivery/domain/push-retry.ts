/**
 * Push send retry policy (Issue #465). Same exponential shape as
 * `email/domain/email-retry.ts` — `2^retryCount` minutes, capped — and
 * `maxRetries` is a parameter for the same reason: the ceiling is
 * operator-configurable (`PUSH_SEND_MAX_RETRIES`, `./push-config.ts`).
 *
 * The cap is lower than email's 60 minutes on purpose. A push notification is
 * a "look at this now" signal; one delivered an hour after the thing it is
 * about is worse than one not delivered at all, because it costs the reader
 * attention and returns nothing. Retries exist here to survive a provider
 * blip, not to guarantee eventual arrival.
 */
export const PUSH_MAX_RETRY_DELAY_MINUTES = 15;

export type PushRetryEvaluation = {
  eligible: boolean;
  nextAttemptAt?: Date;
};

export function evaluatePushRetry(
  retryCount: number,
  maxRetries: number,
  now: Date
): PushRetryEvaluation {
  if (retryCount >= maxRetries) {
    return { eligible: false };
  }

  const delayMinutes = Math.min(2 ** retryCount, PUSH_MAX_RETRY_DELAY_MINUTES);

  return {
    eligible: true,
    nextAttemptAt: new Date(now.getTime() + delayMinutes * 60_000)
  };
}
