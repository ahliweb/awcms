/**
 * Delivery-queue health gauges (Issue #1412) — pending depth, longest-overdue
 * age, and expired claim leases for the lease-based delivery queues, recorded
 * through the EXISTING metrics port (no second telemetry path).
 *
 * Why these three numbers: a provider outage does not first show up as `failed`
 * rows — the dispatcher backs off, so rows sit in `queued`/`retry_wait` and
 * grow older. The oldest overdue row and the count of leases that expired
 * without a finalize (a dead or hung worker) are the early, provider-agnostic
 * signals. They are read, never decided on: nothing here is an authorization
 * source and nothing here changes dispatch behavior.
 *
 * Cost: ONE aggregate per (tenant, queue) per dispatch run, over the
 * non-terminal rows only, on the `(tenant_id, status, next_attempt_at)` index
 * every dispatcher already claims by. It runs inside the dispatch worker that
 * already iterates tenants, in the `background_sync` work class, never on a
 * request path. A probe failure is logged (sanitized) and swallowed: observing
 * a queue must never fail the dispatch that produced the observation.
 *
 * Scope honesty: the values are a per-process, per-run snapshot of the tenants
 * that run visited. They are aggregated across tenants IN PROCESS (sum / max)
 * before they are recorded — recording per tenant would let the last tenant
 * overwrite the gauge. They are not a global fleet view; see
 * `docs/awcms/provider-outage-runbook.md` section Visibility.
 */
import { safeErrorDetail } from "../logging/error-sanitizer";
import { log } from "../logging/logger";
import { withTenantOrThrow } from "../database/tenant-context";
import { recordGauge } from "./metrics-port";

/** Fixed, code-defined metric label values — never tenant-supplied. */
export const DELIVERY_QUEUES = [
  "email",
  "whatsapp",
  "telegram",
  "push",
  "object_sync"
] as const;

export type DeliveryQueue = (typeof DELIVERY_QUEUES)[number];

export type QueueHealthSnapshot = {
  pending: number;
  oldestDueAgeSeconds: number;
  expiredLeases: number;
};

type ProbeRow = {
  pending: number | string | null;
  oldest_due_age_seconds: number | string | null;
  expired_leases: number | string | null;
};

type ProbeTx = Bun.SQL | Bun.TransactionSQL;

function toSnapshot(rows: unknown): QueueHealthSnapshot {
  const row = (rows as ProbeRow[])[0];
  const toInt = (value: number | string | null | undefined) =>
    Math.max(0, Number(value ?? 0) || 0);

  return {
    pending: toInt(row?.pending),
    oldestDueAgeSeconds: toInt(row?.oldest_due_age_seconds),
    expiredLeases: toInt(row?.expired_leases)
  };
}

/**
 * One tagged-template probe per queue. The SQL is written out per table (no
 * dynamic identifiers), and every probe is tenant-scoped under RLS. `now()` is
 * the transaction start, which for a read-only snapshot is exactly the
 * reference instant wanted.
 */
const PROBES: Record<
  DeliveryQueue,
  (tx: ProbeTx, tenantId: string) => Promise<unknown>
> = {
  email: (tx, tenantId) => tx`
    SELECT
      count(*) FILTER (WHERE status IN ('queued', 'retry_wait'))::int AS pending,
      COALESCE(EXTRACT(EPOCH FROM (now() - min(COALESCE(next_attempt_at, created_at))
        FILTER (WHERE status IN ('queued', 'retry_wait')
          AND (next_attempt_at IS NULL OR next_attempt_at <= now())))), 0)::int AS oldest_due_age_seconds,
      count(*) FILTER (WHERE status = 'sending' AND next_attempt_at < now())::int AS expired_leases
    FROM awcms_email_messages
    WHERE tenant_id = ${tenantId} AND status IN ('queued', 'retry_wait', 'sending')
  `,
  whatsapp: (tx, tenantId) => tx`
    SELECT
      count(*) FILTER (WHERE status IN ('queued', 'retry_wait'))::int AS pending,
      COALESCE(EXTRACT(EPOCH FROM (now() - min(COALESCE(next_attempt_at, created_at))
        FILTER (WHERE status IN ('queued', 'retry_wait')
          AND (next_attempt_at IS NULL OR next_attempt_at <= now())))), 0)::int AS oldest_due_age_seconds,
      count(*) FILTER (WHERE status = 'sending' AND next_attempt_at < now())::int AS expired_leases
    FROM awcms_whatsapp_messages
    WHERE tenant_id = ${tenantId} AND status IN ('queued', 'retry_wait', 'sending')
  `,
  telegram: (tx, tenantId) => tx`
    SELECT
      count(*) FILTER (WHERE status IN ('queued', 'retry_wait'))::int AS pending,
      COALESCE(EXTRACT(EPOCH FROM (now() - min(COALESCE(next_attempt_at, created_at))
        FILTER (WHERE status IN ('queued', 'retry_wait')
          AND (next_attempt_at IS NULL OR next_attempt_at <= now())))), 0)::int AS oldest_due_age_seconds,
      count(*) FILTER (WHERE status = 'sending' AND next_attempt_at < now())::int AS expired_leases
    FROM awcms_telegram_messages
    WHERE tenant_id = ${tenantId} AND status IN ('queued', 'retry_wait', 'sending')
  `,
  push: (tx, tenantId) => tx`
    SELECT
      count(*) FILTER (WHERE status IN ('queued', 'retry_wait'))::int AS pending,
      COALESCE(EXTRACT(EPOCH FROM (now() - min(COALESCE(next_attempt_at, created_at))
        FILTER (WHERE status IN ('queued', 'retry_wait')
          AND (next_attempt_at IS NULL OR next_attempt_at <= now())))), 0)::int AS oldest_due_age_seconds,
      count(*) FILTER (WHERE status = 'sending' AND next_attempt_at < now())::int AS expired_leases
    FROM awcms_push_messages
    WHERE tenant_id = ${tenantId} AND status IN ('queued', 'retry_wait', 'sending')
  `,
  // The object-sync queue is the oldest of the family: `pending` (not
  // `queued`) and `next_retry_at` (not `next_attempt_at`), same lease reuse.
  object_sync: (tx, tenantId) => tx`
    SELECT
      count(*) FILTER (WHERE status = 'pending')::int AS pending,
      COALESCE(EXTRACT(EPOCH FROM (now() - min(COALESCE(next_retry_at, created_at))
        FILTER (WHERE status = 'pending'
          AND (next_retry_at IS NULL OR next_retry_at <= now())))), 0)::int AS oldest_due_age_seconds,
      count(*) FILTER (WHERE status = 'sending' AND next_retry_at < now())::int AS expired_leases
    FROM awcms_object_sync_queue
    WHERE tenant_id = ${tenantId} AND status IN ('pending', 'sending')
  `
};

/** Folds one tenant's snapshot into the running aggregate: depth and leases add up, age is the worst. */
export function mergeQueueHealth(
  total: QueueHealthSnapshot,
  next: QueueHealthSnapshot
): QueueHealthSnapshot {
  return {
    pending: total.pending + next.pending,
    oldestDueAgeSeconds: Math.max(
      total.oldestDueAgeSeconds,
      next.oldestDueAgeSeconds
    ),
    expiredLeases: total.expiredLeases + next.expiredLeases
  };
}

/**
 * The job-log line each dispatcher prints after a run. No process in this
 * repository registers a metrics adapter by default, and a cron-driven
 * dispatcher exits within seconds — so the gauges above are discarded unless a
 * deployment wires an exporter. This line is the signal that works with
 * nothing but the job log (`$AWCMS_JOB_LOG`), which is why its shape is fixed
 * by a test: `<job> queue — pending=N oldestDueAgeSeconds=N expiredLeases=N`.
 * It carries counts only: no tenant id, recipient, or provider text.
 */
export function formatQueueHealthLine(
  job: string,
  snapshot: QueueHealthSnapshot
): string {
  return (
    `${job} queue — pending=${snapshot.pending} ` +
    `oldestDueAgeSeconds=${snapshot.oldestDueAgeSeconds} ` +
    `expiredLeases=${snapshot.expiredLeases}`
  );
}

export type QueueHealthRecorder = {
  /** Probes one tenant's queue and folds it in. Never throws. */
  observeTenant(sql: Bun.SQL, tenantId: string): Promise<void>;
  /** Records the aggregate once. Records nothing if no tenant was observed, so a failed probe never reports a false "all clear" zero. */
  flush(): QueueHealthSnapshot | null;
};

export function createQueueHealthRecorder(
  queue: DeliveryQueue,
  probe: (tx: ProbeTx, tenantId: string) => Promise<unknown> = PROBES[queue]
): QueueHealthRecorder {
  let aggregate: QueueHealthSnapshot | null = null;

  return {
    async observeTenant(sql, tenantId) {
      try {
        const rows = await withTenantOrThrow(
          sql,
          tenantId,
          (tx) => probe(tx, tenantId),
          { workClass: "background_sync" }
        );
        const snapshot = toSnapshot(rows);

        aggregate = aggregate
          ? mergeQueueHealth(aggregate, snapshot)
          : snapshot;
      } catch (error) {
        // No tenant id in the line: the queue name and the sanitized error are
        // enough to find it, and a log line is not the place for tenant ids.
        log("warning", "queue_health.probe_failed", {
          queue,
          error: safeErrorDetail(error)
        });
      }
    },
    flush() {
      if (aggregate === null) return null;

      recordGauge("queue_pending_count", aggregate.pending, { queue });
      recordGauge(
        "queue_oldest_due_age_seconds",
        aggregate.oldestDueAgeSeconds,
        { queue }
      );
      recordGauge("queue_expired_lease_count", aggregate.expiredLeases, {
        queue
      });

      return aggregate;
    }
  };
}
