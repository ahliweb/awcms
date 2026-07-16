import { withTenant } from "../../../lib/database/tenant-context";
import { sanitizeErrorForLog } from "../../../lib/logging/error-sanitizer";
import { log } from "../../../lib/logging/logger";
import {
  recordCounter,
  recordGauge
} from "../../../lib/observability/metrics-port";
import { recordAuditEvent } from "../../logging/application/audit-log";
import type {
  DomainEventConsumerDefinition,
  DomainEventForHandler
} from "../domain/consumer-types";
import { evaluateDomainEventDeliveryRetry } from "../domain/delivery-retry";
import { DOMAIN_EVENT_CONSUMERS } from "../infrastructure/consumer-registry";

/**
 * The dispatcher ("claim/dispatch/finalize using the shared worker runner,
 * locks, batching, timeouts, cancellation, metrics, and safe logging"). The
 * shared-worker-runner wiring itself (advisory lock, timeout,
 * SIGTERM/SIGINT cancellation, JSON telemetry, `--dry-run`) lives in
 * `scripts/domain-events-dispatch.ts`, which calls
 * `dispatchDomainEventsForTenant` per active tenant via
 * `iterateTenantsInBatches` — this file is the pure claim/execute/finalize
 * logic, independently callable (and independently tested) without
 * `runJob`.
 *
 * Execution model — deliberately DIFFERENT from the lease-based 3-phase
 * CLAIM (short tx, flip to a transient status) / CALL (outside any
 * transaction) / FINALIZE (short tx) shape a provider-backed outbox uses:
 * those three exist BECAUSE their CALL phase makes a real external network
 * call, which ADR-0006 forbids running inside a DB transaction. This
 * module's reference consumers (`infrastructure/consumer-registry.ts`) are
 * same-process, DB-only handlers with NO external I/O — so the safer,
 * simpler, and MORE atomic design here runs claim-check + handler +
 * finalize-on-success in ONE transaction (`processOneDelivery` below): a
 * crash mid-handler rolls the WHOLE transaction back automatically
 * (Postgres tears down the connection's uncommitted work on disconnect),
 * which returns the delivery row to `pending` with NO explicit
 * lease/stale-claim state ever durably observed — this is what makes
 * crash/restart recovery correct-by-construction rather than
 * lease-timeout-based, and is exactly why
 * `awcms_domain_event_deliveries.status` (migration 009) has no transient
 * "claimed" value. A future out-of-transaction/broker-backed consumer
 * (`infrastructure/broker-adapter-port.ts`) would need the lease-based
 * shape back — not built speculatively here.
 *
 * Ordering ("ordering per declared aggregate/order key is tested; unrelated
 * keys can progress independently"): `selectHeadOfLineDeliveries` picks,
 * PER order_key, only the single oldest (`event_sequence` — the strictly
 * monotonic outbox insertion counter, migration 009) pending delivery for a
 * given consumer — computed via `DISTINCT ON (order_key) ... ORDER BY
 * order_key, event_sequence`, BEFORE filtering by `next_attempt_at`
 * (backoff). This ordering matters: if the head-of-line row is still
 * backing off, it is excluded from THIS pass's results, and — because
 * DISTINCT ON already collapsed each order_key to only its head — no LATER
 * event for that SAME order_key can be selected either, correctly stalling
 * that one order_key without blocking any other (unrelated) order_key's
 * progress.
 */

export type ProcessDeliveryOutcome =
  "delivered" | "retried" | "dead_letter" | "skipped" | "not_claimed";

type HeadOfLineCandidate = {
  id: string;
  attemptCount: number;
};

async function isConsumerPaused(
  sql: Bun.SQL,
  tenantId: string,
  consumerName: string
): Promise<boolean> {
  return withTenant(
    sql,
    tenantId,
    async (tx) => {
      const rows = (await tx`
        SELECT is_paused FROM awcms_domain_event_consumer_state
        WHERE tenant_id = ${tenantId} AND consumer_name = ${consumerName}
      `) as { is_paused: boolean }[];

      return rows[0]?.is_paused ?? false;
    },
    { workClass: "background_sync" }
  );
}

async function selectHeadOfLineDeliveries(
  sql: Bun.SQL,
  tenantId: string,
  consumerName: string,
  now: Date,
  limit: number
): Promise<HeadOfLineCandidate[]> {
  return withTenant(
    sql,
    tenantId,
    async (tx) => {
      const rows = (await tx`
        WITH head AS (
          SELECT DISTINCT ON (order_key) id, next_attempt_at, attempt_count
          FROM awcms_domain_event_deliveries
          WHERE tenant_id = ${tenantId} AND consumer_name = ${consumerName} AND status = 'pending'
          ORDER BY order_key, event_sequence ASC
        )
        SELECT id, attempt_count FROM head
        WHERE next_attempt_at IS NULL OR next_attempt_at <= ${now}
        ORDER BY next_attempt_at NULLS FIRST, id
        LIMIT ${limit}
      `) as { id: string; attempt_count: string | number }[];

      return rows.map((row) => ({
        id: row.id,
        attemptCount: Number(row.attempt_count)
      }));
    },
    { workClass: "background_sync" }
  );
}

type ClaimedDeliveryRow = {
  id: string;
  event_id: string;
  event_type: string;
  event_version: string;
  order_key: string;
  attempt_count: string | number;
  max_attempts: string | number;
  correlation_id: string | null;
  aggregate_type: string;
  aggregate_id: string;
  event_correlation_id: string | null;
  causation_id: string | null;
  producer_module: string;
  payload: Record<string, unknown>;
  occurred_at: Date;
  recorded_at: Date;
};

async function recordDeliveryFailure(
  sql: Bun.SQL,
  tenantId: string,
  consumerDef: DomainEventConsumerDefinition,
  candidate: HeadOfLineCandidate,
  error: unknown,
  now: Date,
  correlationId: string
): Promise<"retried" | "dead_letter" | "superseded"> {
  return withTenant(
    sql,
    tenantId,
    async (tx) => {
      const rows = (await tx`
        SELECT id, attempt_count, max_attempts
        FROM awcms_domain_event_deliveries
        WHERE tenant_id = ${tenantId} AND id = ${candidate.id} AND status = 'pending'
        FOR UPDATE
      `) as {
        id: string;
        attempt_count: string | number;
        max_attempts: string | number;
      }[];

      const row = rows[0];

      if (!row) {
        // A concurrent dispatcher already resolved this delivery (claimed,
        // succeeded or failed differently) between our own transaction's
        // rollback and this call — nothing to record, not a bug.
        return "superseded" as const;
      }

      const newAttemptCount = Number(row.attempt_count) + 1;
      const maxAttempts = Number(row.max_attempts);
      const safeError = sanitizeErrorForLog(error);
      const evaluation = evaluateDomainEventDeliveryRetry(
        error,
        newAttemptCount,
        maxAttempts,
        now
      );

      if (evaluation.eligible) {
        await tx`
          UPDATE awcms_domain_event_deliveries
          SET attempt_count = ${newAttemptCount}, next_attempt_at = ${evaluation.nextAttemptAt},
              last_error_code = ${safeError.name}, last_error_message = ${safeError.message},
              last_retry_classification = ${evaluation.classification}, updated_at = now()
          WHERE tenant_id = ${tenantId} AND id = ${candidate.id}
        `;

        return "retried" as const;
      }

      await tx`
        UPDATE awcms_domain_event_deliveries
        SET status = 'dead_letter', attempt_count = ${newAttemptCount}, dead_letter_at = now(),
            dead_letter_reason = ${safeError.message}, last_error_code = ${safeError.name},
            last_error_message = ${safeError.message}, last_retry_classification = ${evaluation.classification},
            updated_at = now()
        WHERE tenant_id = ${tenantId} AND id = ${candidate.id}
      `;

      await recordAuditEvent(tx, {
        tenantId,
        moduleKey: "domain_event_runtime",
        action: "domain_event_runtime.delivery.dead_lettered",
        resourceType: "domain_event_delivery",
        resourceId: candidate.id,
        severity: "critical",
        message: `Domain event delivery dead-lettered for consumer "${consumerDef.name}" after ${newAttemptCount} attempt(s).`,
        attributes: {
          consumerName: consumerDef.name,
          errorCode: safeError.name,
          attemptCount: newAttemptCount
        },
        correlationId
      });

      return "dead_letter" as const;
    },
    { workClass: "background_sync" }
  );
}

async function processOneDelivery(
  sql: Bun.SQL,
  tenantId: string,
  consumerDef: DomainEventConsumerDefinition,
  candidate: HeadOfLineCandidate,
  now: Date,
  fallbackCorrelationId: string
): Promise<ProcessDeliveryOutcome> {
  try {
    const outcome = await withTenant(
      sql,
      tenantId,
      async (tx) => {
        const rows = (await tx`
          SELECT d.id, d.event_id, d.event_type, d.event_version, d.order_key,
                 d.attempt_count, d.max_attempts, d.correlation_id,
                 e.aggregate_type, e.aggregate_id, e.correlation_id AS event_correlation_id,
                 e.causation_id, e.producer_module, e.payload, e.occurred_at, e.recorded_at
          FROM awcms_domain_event_deliveries d
          JOIN awcms_domain_events e ON e.id = d.event_id
          WHERE d.tenant_id = ${tenantId} AND d.id = ${candidate.id}
            AND d.status = 'pending' AND d.attempt_count = ${candidate.attemptCount}
          FOR UPDATE OF d
        `) as ClaimedDeliveryRow[];

        const row = rows[0];

        if (!row) {
          return "not_claimed" as const;
        }

        if (!consumerDef.eventVersions.includes(row.event_version)) {
          await tx`
            UPDATE awcms_domain_event_deliveries
            SET status = 'skipped', updated_at = now(),
                last_error_code = 'unsupported_event_version',
                last_error_message = ${`Consumer "${consumerDef.name}" does not support event version "${row.event_version}".`}
            WHERE tenant_id = ${tenantId} AND id = ${candidate.id}
          `;

          return "skipped" as const;
        }

        const event: DomainEventForHandler = {
          id: row.event_id,
          eventType: row.event_type,
          eventVersion: row.event_version,
          aggregateType: row.aggregate_type,
          aggregateId: row.aggregate_id,
          orderKey: row.order_key,
          correlationId: row.event_correlation_id,
          causationId: row.causation_id,
          producerModule: row.producer_module,
          payload: row.payload,
          occurredAt: row.occurred_at,
          recordedAt: row.recorded_at
        };

        await consumerDef.handler(tx, event, {
          tenantId,
          correlationId: row.correlation_id ?? fallbackCorrelationId
        });

        await tx`
          UPDATE awcms_domain_event_deliveries
          SET status = 'delivered', delivered_at = now(), updated_at = now(),
              last_error_code = NULL, last_error_message = NULL, last_retry_classification = NULL
          WHERE tenant_id = ${tenantId} AND id = ${candidate.id}
        `;

        return "delivered" as const;
      },
      { workClass: "background_sync" }
    );

    return outcome;
  } catch (error) {
    const failureOutcome = await recordDeliveryFailure(
      sql,
      tenantId,
      consumerDef,
      candidate,
      error,
      now,
      fallbackCorrelationId
    );

    return failureOutcome === "superseded" ? "not_claimed" : failureOutcome;
  }
}

export type DispatchDomainEventsOptions = {
  limit?: number;
  now?: Date;
  correlationId?: string;
};

export type DispatchDomainEventsResult = {
  consumersProcessed: number;
  claimed: number;
  delivered: number;
  retried: number;
  deadLettered: number;
  skipped: number;
};

/** `runPassForTenant`-compatible: returns `{ count }` for `iterateTenantsInBatches` (`src/lib/jobs/batching.ts`) — `count` is the total number of deliveries this pass claimed, i.e. "did work happen" for the bounded-pass-loop's stopping condition. */
export type DispatchDomainEventsPassResult = DispatchDomainEventsResult & {
  count: number;
};

/**
 * Dispatches at most `limit` (default 25) DUE deliveries PER registered
 * consumer for one tenant. Safe to call repeatedly/concurrently — every
 * claim is an atomic, optimistically-guarded transaction (see this file's
 * doc comment). Call in a loop (the CLI script does, via
 * `runBoundedBatches`) to drain a larger backlog.
 */
export async function dispatchDomainEventsForTenant(
  sql: Bun.SQL,
  tenantId: string,
  options: DispatchDomainEventsOptions = {}
): Promise<DispatchDomainEventsPassResult> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 25;
  const correlationId = options.correlationId ?? crypto.randomUUID();

  const result: DispatchDomainEventsResult = {
    consumersProcessed: 0,
    claimed: 0,
    delivered: 0,
    retried: 0,
    deadLettered: 0,
    skipped: 0
  };

  for (const consumer of DOMAIN_EVENT_CONSUMERS) {
    if (await isConsumerPaused(sql, tenantId, consumer.name)) {
      continue;
    }

    result.consumersProcessed += 1;

    const candidates = await selectHeadOfLineDeliveries(
      sql,
      tenantId,
      consumer.name,
      now,
      limit
    );

    for (const candidate of candidates) {
      const outcome = await processOneDelivery(
        sql,
        tenantId,
        consumer,
        candidate,
        now,
        correlationId
      );

      if (outcome === "not_claimed") {
        continue;
      }

      result.claimed += 1;

      if (outcome === "delivered") result.delivered += 1;
      else if (outcome === "retried") result.retried += 1;
      else if (outcome === "dead_letter") result.deadLettered += 1;
      else if (outcome === "skipped") result.skipped += 1;

      recordCounter("domain_event_dispatch_total", {
        consumerName: consumer.name,
        outcome
      });
    }
  }

  log("info", "domain_event_runtime.dispatch.pass_completed", {
    correlationId,
    tenantId,
    moduleKey: "domain_event_runtime",
    ...result
  });

  return { ...result, count: result.claimed };
}

/**
 * Backlog/lag gauges ("observability for outbox lag, oldest pending age,
 * dispatch outcome, retry rate, consumer lag/checkpoint, and DLQ count with
 * low-cardinality labels"). `consumerName` is safe as a label — it is
 * always one of the small, fixed, code-defined `DOMAIN_EVENT_CONSUMERS`
 * entries, never tenant/request input. Called by
 * `scripts/domain-events-dispatch.ts` once per tenant per run, independent
 * of whether any deliveries were claimed THIS pass, so the gauge reflects
 * current STATE (lag), not just this run's activity — "dispatch
 * outcome"/"retry rate" are covered separately by the
 * `domain_event_dispatch_total` counter recorded in
 * `dispatchDomainEventsForTenant` above.
 */
export async function recordDomainEventBacklogGauges(
  sql: Bun.SQL,
  tenantId: string
): Promise<void> {
  const rows = await withTenant(
    sql,
    tenantId,
    (tx) => tx`
      SELECT consumer_name, status, count(*)::int AS row_count,
        COALESCE(EXTRACT(EPOCH FROM (now() - min(created_at))), 0)::int AS oldest_age_seconds
      FROM awcms_domain_event_deliveries
      WHERE tenant_id = ${tenantId} AND status IN ('pending', 'dead_letter')
      GROUP BY consumer_name, status
    `,
    { workClass: "background_sync" }
  );

  for (const row of rows as {
    consumer_name: string;
    status: string;
    row_count: number;
    oldest_age_seconds: number;
  }[]) {
    recordGauge("domain_event_delivery_backlog", row.row_count, {
      consumerName: row.consumer_name,
      status: row.status
    });

    if (row.status === "pending") {
      recordGauge(
        "domain_event_delivery_oldest_pending_seconds",
        row.oldest_age_seconds,
        { consumerName: row.consumer_name }
      );
    }
  }
}
