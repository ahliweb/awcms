/**
 * WhatsApp retry policy (Issue #963). `2^retryCount` minutes, capped at 30 —
 * between push's 15 (a "look now" signal) and email's 60. A reminder or a
 * receipt is still useful half an hour late; an OTP is not, but an OTP carries
 * `expires_at`, which the dispatcher checks before every attempt.
 */
export const WHATSAPP_MAX_RETRY_DELAY_MINUTES = 30;

export type WhatsappRetryEvaluation = {
  eligible: boolean;
  nextAttemptAt?: Date;
};

export function evaluateWhatsappRetry(
  retryCount: number,
  maxRetries: number,
  now: Date
): WhatsappRetryEvaluation {
  if (retryCount >= maxRetries) {
    return { eligible: false };
  }

  const delayMinutes = Math.min(
    2 ** retryCount,
    WHATSAPP_MAX_RETRY_DELAY_MINUTES
  );

  return {
    eligible: true,
    nextAttemptAt: new Date(now.getTime() + delayMinutes * 60_000)
  };
}
