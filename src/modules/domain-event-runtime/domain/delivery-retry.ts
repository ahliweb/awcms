import {
  classifyError,
  type RetryClassification
} from "../../../lib/jobs/retry-classification";

/**
 * Retry/backoff evaluation for `awcms_domain_event_deliveries`. Reuses,
 * rather than re-derives, `classifyError` from the shared worker runner
 * (`src/lib/jobs/retry-classification.ts`) to decide WHETHER an error is
 * even worth retrying (`not_retryable` — e.g. a Postgres constraint
 * violation from a consumer's own buggy handler — goes straight to
 * dead-letter regardless of remaining attempt budget, since it will fail
 * identically every time).
 *
 * Same `Math.min(base * 2**attempt, cap)` exponential-backoff SHAPE as
 * every other outbox precedent, but with a SMALLER base unit (seconds, not
 * minutes) — this runtime's reference consumers are same-process, DB-only
 * handlers with no external network call, so a transient failure (e.g. a
 * serialization conflict) is expected to clear far faster than an external
 * provider's rate limit/outage.
 */
export const DOMAIN_EVENT_DELIVERY_BASE_DELAY_SECONDS = 30;
export const DOMAIN_EVENT_DELIVERY_MAX_DELAY_SECONDS = 3600;

export type DomainEventDeliveryRetryEvaluation =
  | { eligible: true; nextAttemptAt: Date; classification: RetryClassification }
  | { eligible: false; classification: RetryClassification };

/**
 * `attemptCount` is the count AFTER the attempt that just failed (caller
 * increments before calling this).
 */
export function evaluateDomainEventDeliveryRetry(
  error: unknown,
  attemptCount: number,
  maxAttempts: number,
  now: Date
): DomainEventDeliveryRetryEvaluation {
  const classification = classifyError(error);

  if (classification === "not_retryable") {
    return { eligible: false, classification };
  }

  if (attemptCount >= maxAttempts) {
    return { eligible: false, classification };
  }

  const delaySeconds = Math.min(
    DOMAIN_EVENT_DELIVERY_BASE_DELAY_SECONDS * 2 ** (attemptCount - 1),
    DOMAIN_EVENT_DELIVERY_MAX_DELAY_SECONDS
  );

  return {
    eligible: true,
    nextAttemptAt: new Date(now.getTime() + delaySeconds * 1000),
    classification
  };
}
