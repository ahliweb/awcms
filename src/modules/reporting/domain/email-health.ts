/**
 * Pure shaping logic for the email queue health reporting view (Issue
 * #499). Same pattern as `sync-health.ts` — no I/O, unit-testable in
 * isolation.
 *
 * "Healthy" is defined narrowly: no failed messages and no retry backlog.
 * A tenant with zero queued messages (nothing to send) is still healthy —
 * unlike sync health's "at least one active node" requirement, an idle
 * email queue is not itself a problem.
 */
export type EmailHealthCounts = {
  queuedCount: number;
  retryWaitCount: number;
  failedCount: number;
  suppressedCount: number;
  sentLast24hCount: number;
};

export type EmailHealthView = EmailHealthCounts & {
  hasFailedMessages: boolean;
  hasRetryBacklog: boolean;
  isHealthy: boolean;
};

export function shapeEmailHealth(counts: EmailHealthCounts): EmailHealthView {
  const hasFailedMessages = counts.failedCount > 0;
  const hasRetryBacklog = counts.retryWaitCount > 0;
  const isHealthy = !hasFailedMessages && !hasRetryBacklog;

  return {
    ...counts,
    hasFailedMessages,
    hasRetryBacklog,
    isHealthy
  };
}
