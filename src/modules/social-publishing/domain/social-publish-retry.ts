/**
 * Retry, hold and failure classification for a publish job (Issue #1145,
 * ADR-0157 section 6). Pure and timer-free: every function takes `now`.
 */
import type { PublisherUnavailableReason } from "../../_shared/ports/channel-account-port";
import { HOLD_DELAY_MINUTES, MAX_HOLDS } from "./social-publishing-constants";

export const MAX_RETRY_DELAY_MINUTES = 240;

export type RetryDecision =
  { retry: true; nextAttemptAt: Date } | { retry: false };

/**
 * `attemptCount` is the count INCLUDING the attempt that just failed (the claim
 * increments it). Exponential: 2, 4, 8 ... minutes, capped.
 */
export function decideRetry(
  attemptCount: number,
  maxAttempts: number,
  now: Date,
  retryAfterSeconds?: number
): RetryDecision {
  if (attemptCount >= maxAttempts) return { retry: false };

  const exponential = Math.min(2 ** attemptCount, MAX_RETRY_DELAY_MINUTES);
  const floor = now.getTime() + exponential * 60_000;
  const hinted =
    retryAfterSeconds !== undefined && retryAfterSeconds > 0
      ? now.getTime() +
        Math.min(retryAfterSeconds, MAX_RETRY_DELAY_MINUTES * 60) * 1000
      : 0;

  // A provider hint can only LENGTHEN the wait: an implausibly short
  // `retryAfterSeconds` must not become a tight retry loop.
  return { retry: true, nextAttemptAt: new Date(Math.max(floor, hinted)) };
}

/**
 * What an account that cannot publish does to a job (ADR-0148 I5, no reroute):
 * a RECOVERABLE problem (degraded, a grant that expired or is still pending)
 * HOLDS the job, which consumes no attempt; anything else is terminal.
 */
export type AccountVerdict = { kind: "hold" } | { kind: "fail"; code: string };

const HOLD_REASONS: ReadonlySet<PublisherUnavailableReason> = new Set([
  "ACCOUNT_DEGRADED",
  "ACCOUNT_PENDING",
  "CONNECTION_EXPIRED",
  "SECRET_STORE_UNAVAILABLE"
]);

export function classifyAccountReason(
  reason: PublisherUnavailableReason
): AccountVerdict {
  return HOLD_REASONS.has(reason)
    ? { kind: "hold" }
    : { kind: "fail", code: `ACCOUNT_${reason}`.slice(0, 64) };
}

export function holdDelayUntil(now: Date): Date {
  return new Date(now.getTime() + HOLD_DELAY_MINUTES * 60_000);
}

export function holdsExhausted(holdCount: number): boolean {
  return holdCount >= MAX_HOLDS;
}

/** Aggregate status of a publication, from its state and the statuses of its jobs. Never stored. */
export function deriveAggregateStatus(
  state: string,
  jobStatuses: readonly string[]
):
  | "refused"
  | "pending_approval"
  | "queued"
  | "in_progress"
  | "partially_published"
  | "published"
  | "failed"
  | "cancelled" {
  if (state === "refused") return "refused";
  if (state === "pending_approval") return "pending_approval";

  const count = (status: string) =>
    jobStatuses.filter((s) => s === status).length;
  const published = count("published");
  const failed = count("failed");
  const cancelled = count("cancelled");
  const open = jobStatuses.length - published - failed - cancelled;

  if (state === "cancelled" && open === 0 && published === 0)
    return "cancelled";
  if (jobStatuses.length === 0)
    return state === "cancelled" ? "cancelled" : "queued";

  if (open > 0) {
    if (published > 0) return "partially_published";

    return jobStatuses.some((s) => s === "publishing" || s === "retry_wait")
      ? "in_progress"
      : "queued";
  }

  if (published === jobStatuses.length) return "published";
  if (published > 0) return "partially_published";
  if (failed > 0) return "failed";

  return "cancelled";
}
