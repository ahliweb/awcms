/**
 * Telegram retry policy (Issue #965, ADR-0140 section 5.5). `2^retryCount`
 * minutes, capped at 15: an operational notice is perishable (every message has
 * an `expires_at`), so the backoff is shorter than WhatsApp's 30 minutes.
 *
 * A `429` does NOT come through here: its delay is Telegram's own
 * `retry_after`, not an exponential, and it does not consume the retry budget
 * (see `telegram-dispatch.ts`). Escalating the backoff on a rate limit would
 * punish the whole queue for one burst.
 */
export const TELEGRAM_MAX_RETRY_DELAY_MINUTES = 15;

export type TelegramRetryEvaluation = {
  eligible: boolean;
  nextAttemptAt?: Date;
};

export function evaluateTelegramRetry(
  retryCount: number,
  maxRetries: number,
  now: Date
): TelegramRetryEvaluation {
  if (retryCount >= maxRetries) {
    return { eligible: false };
  }

  const delayMinutes = Math.min(
    2 ** retryCount,
    TELEGRAM_MAX_RETRY_DELAY_MINUTES
  );

  return {
    eligible: true,
    nextAttemptAt: new Date(now.getTime() + delayMinutes * 60_000)
  };
}
