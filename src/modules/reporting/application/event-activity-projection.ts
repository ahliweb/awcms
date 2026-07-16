/**
 * Event-driven incremental projection apply function (Issue #753) — the
 * ONLY reporting-owned write path invoked from
 * `domain-event-runtime/infrastructure/consumer-registry.ts`'s registered
 * `reporting.event_activity_projector` consumer (that file is the ONE
 * place a cross-module edge exists: `domain_event_runtime` -> `reporting/
 * application`; this file itself imports nothing from `domain_event_runtime`,
 * so no import cycle is introduced — see `tests/unit/module-boundary-
 * cycles.test.ts`).
 *
 * Called from INSIDE the dispatcher's own transaction
 * (`dispatch-domain-events.ts`'s claim-check + handler + finalize, all one
 * transaction) — this function neither opens nor commits a transaction of
 * its own; a thrown error here rolls the WHOLE delivery back exactly like
 * any other consumer handler (the delivery stays `pending` and is retried
 * with backoff), which is why this file's own bookkeeping does not need a
 * separate try/catch for the "silently failed" case `projection-state-
 * store.ts`'s `recordProjectionFailure` exists for — a domain-event
 * delivery failure is already tracked by `domain_event_runtime`'s own
 * delivery/retry/dead-letter state; `projection_state.last_success_at`
 * for THIS projection simply stops advancing until a delivery next
 * succeeds, which is exactly what the freshness read path needs (see
 * `reporting/domain/freshness.ts`'s header comment).
 *
 * MUTUAL EXCLUSION WITH REBUILD — MUST THROW, NEVER SILENTLY NO-OP
 * (security-auditor finding, PR #781): while a rebuild owns this
 * projection, this function used to just `return` early. That was a real
 * permanent-data-loss bug: this function runs as the `sideEffect` inside
 * `consumer-registry.ts`'s `applyConsumerEffectOnce(tx, ...)` call, and
 * `applyConsumerEffectOnce` writes its event-ID-keyed idempotency MARKER
 * (`INSERT ... ON CONFLICT DO NOTHING`) BEFORE invoking `sideEffect` — so
 * a silent `return` here left the marker committed with NO corresponding
 * metric increment. If the in-progress rebuild was later CANCELLED before
 * its own bounded re-scan reached that event's row, the event became
 * PERMANENTLY uncounted: a redelivery would find the marker already
 * present and skip re-invoking this function entirely, and the cancelled
 * rebuild never counted it either — with freshness still falsely
 * reporting `"current"` throughout, since `recordProjectionSuccess` kept
 * firing for every OTHER (successfully applied) event.
 *
 * THROWING instead fixes the marker-write half of the bug, using a
 * mechanism this file already relies on: `dispatch-domain-events.ts`'s
 * `processOneDelivery` runs claim-check + handler + finalize in ONE
 * transaction (`withTenant`), so an uncaught exception anywhere inside —
 * including from this function, called deep inside
 * `applyConsumerEffectOnce` — rolls back the ENTIRE transaction, which
 * undoes the marker INSERT too (it was never actually committed). The
 * delivery then goes through the normal retry/backoff path
 * (`recordDeliveryFailure`, a separate transaction) exactly like any
 * other transient failure — eligible for retry (a plain `Error`
 * classifies as `"unknown"`, not `"not_retryable"`, per `src/lib/jobs/
 * retry-classification.ts`, so it is NOT excluded from retry
 * eligibility) and, if the rebuild genuinely outlives the consumer's
 * `maxAttempts` retry budget, dead-lettered — VISIBLE in the dead-letter
 * queue and recoverable via the existing permission-gated, audited
 * replay mechanism, instead of silently vanishing.
 *
 * BUT throw-then-retry-blindly on its own trades permanent UNDER-counting
 * for a new OVER-counting (double-count) bug: if the rebuild that was
 * blocking a deferred delivery goes on to COMPLETE normally, its own
 * bounded re-scan of `awcms_domain_events` already counts that exact
 * event from the authoritative source table — a later blind retry of the
 * SAME event would count it AGAIN. The fix needs to tell apart "the
 * rebuild that blocked me has since covered this event" (skip — already
 * counted) from "no rebuild ever covered this event" (apply the
 * increment) — a plain "is a rebuild running right now" boolean cannot
 * distinguish these once the blocking rebuild is no longer running
 * (completed, cancelled, OR failed all look the same from that check
 * alone).
 *
 * WATERMARK COMPARISON closes this: `EVENT_ACTIVITY_REBUILD_STREAM_KEY`'s
 * cursor (`awcms_reporting_projection_cursors`) is advanced ONLY by
 * a rebuild pass (`projection-rebuild.ts`'s `runRebuildStreamPass`),
 * never by this live path — so it is exactly "how far did the most
 * recent rebuild's own re-scan of the source table actually reach",
 * regardless of whether that rebuild is still running, completed,
 * cancelled, or failed. Comparing the event's own `occurredAt` against
 * this cursor tells the retry which of the two cases applies:
 * - `occurredAt <= cursor` — already covered by a rebuild's re-scan from
 *   the authoritative source table; applying the increment again would
 *   double-count it. Record success (freshness advances) without
 *   touching the metric.
 * - `occurredAt > cursor` (or the cursor was never set, i.e. no rebuild
 *   ever ran) — never counted by anything; apply the increment normally.
 *
 * See `tests/integration/reporting-projections.integration.test.ts`'s
 * "a live event delivery during an in-progress rebuild is RETRIED" test
 * (rebuild completes normally — must NOT double-count) and its
 * "ADVERSARIAL: cancelling a rebuild does not permanently lose an event"
 * test (rebuild cancelled before reaching the event — must still count
 * it exactly once) for both halves of this fix.
 */
import { findRunningRebuild } from "./rebuild-run-store";
import { applyMetricDeltas } from "./projection-metric-store";
import { getStreamCursor } from "./projection-cursor-store";
import { recordProjectionSuccess } from "./projection-state-store";
import {
  EVENT_ACTIVITY_METRIC_KEYS,
  EVENT_ACTIVITY_REBUILD_STREAM_KEY,
  EVENT_ACTIVITY_SUMMARY_PROJECTION_KEY
} from "../domain/projection-keys";

export class ProjectionRebuildInProgressError extends Error {
  readonly projectionKey: string;

  constructor(projectionKey: string) {
    super(
      `Projection "${projectionKey}" is currently rebuilding; deferring this event-driven update until the rebuild completes or is cancelled.`
    );
    this.name = "ProjectionRebuildInProgressError";
    this.projectionKey = projectionKey;
  }
}

export async function applyEventActivityProjectionIncrement(
  tx: Bun.SQL,
  tenantId: string,
  eventOccurredAt: Date
): Promise<void> {
  const runningRebuild = await findRunningRebuild(
    tx,
    tenantId,
    EVENT_ACTIVITY_SUMMARY_PROJECTION_KEY
  );
  if (runningRebuild) {
    throw new ProjectionRebuildInProgressError(
      EVENT_ACTIVITY_SUMMARY_PROJECTION_KEY
    );
  }

  const rebuildCursor = await getStreamCursor(
    tx,
    tenantId,
    EVENT_ACTIVITY_SUMMARY_PROJECTION_KEY,
    EVENT_ACTIVITY_REBUILD_STREAM_KEY
  );
  const alreadyCoveredByRebuild =
    rebuildCursor !== null &&
    eventOccurredAt.getTime() <= rebuildCursor.getTime();

  if (alreadyCoveredByRebuild) {
    // Freshness still advances (this delivery genuinely succeeded, it
    // just has nothing further to apply) — never touch the metric here.
    await recordProjectionSuccess(
      tx,
      tenantId,
      EVENT_ACTIVITY_SUMMARY_PROJECTION_KEY
    );
    return;
  }

  await applyMetricDeltas(tx, tenantId, EVENT_ACTIVITY_SUMMARY_PROJECTION_KEY, [
    { metricKey: EVENT_ACTIVITY_METRIC_KEYS.sampleRecordedCount, delta: 1 }
  ]);

  await recordProjectionSuccess(
    tx,
    tenantId,
    EVENT_ACTIVITY_SUMMARY_PROJECTION_KEY
  );
}
