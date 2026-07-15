/**
 * Work-class concurrency gate (Issue 10.2, doc 16 §Connection pooling dan
 * backpressure). `Bun.SQL`'s own pool (`src/lib/database/client.ts`) knows
 * nothing about "work class" — it is a flat pool of connections. This module
 * is a pure, in-process application-level semaphore that sits in front of
 * that pool: every DB-bound request first acquires a slot for its work
 * class, then does its work, then releases the slot. When a class is at its
 * concurrency max, callers queue FIFO until a slot frees or a timeout
 * elapses.
 *
 * This is intentionally NOT env-tunable — the max-concurrency numbers below
 * are small, fixed constants that roughly track doc 16's priority table:
 *
 * | Work class             | Max | Why                                        |
 * | ----------------------- | --: | ------------------------------------------- |
 * | `critical_transaction`  |  10 | Highest priority (doc 16) gets the largest  |
 * |                         |     | share of the pool so it is least likely to  |
 * |                         |     | queue behind lower-priority work.           |
 * | `interactive`           |   8 | High priority; most existing endpoints      |
 * |                         |     | (CRUD/admin/search) default here.           |
 * | `reporting`             |   4 | Medium priority; reports/dashboards can     |
 * |                         |     | tolerate more queueing than interactive.    |
 * | `background_sync`       |   4 | Low priority; sync push/pull/outbox should   |
 * |                         |     | never starve interactive/reporting traffic.  |
 * | `maintenance`           |   1 | Scheduled, not an HTTP concern in this base — |
 * |                         |     | serialized to avoid overlapping runs.        |
 *
 * NOTE (corrected by Issue #743 — the original text here claimed these five
 * numbers "add up to well under `DATABASE_POOL_MAX` (default 20)", which is
 * false: 10+8+4+4+1 = 27 > 20. This is an intentional, DOCUMENTED
 * oversubscription, not a bug: a work-class "slot" is an application-level
 * concurrency permit, not a guaranteed physical connection — not every work
 * class peaks at its own max at the same instant, and when the underlying
 * `Bun.SQL` pool (`client.ts`) genuinely runs out of physical connections
 * before a work-class slot's caller reaches its query, `Bun.SQL`'s own pool
 * queues that acquisition internally, exactly as it would for any caller.
 * `database-capacity-check.ts`/`capacity-config.ts` (Issue #743) surface
 * this ratio as a non-blocking WARNING finding — not a hard failure, since
 * changing these five numbers is a runtime behavior change with its own
 * blast radius, out of THIS issue's scope — so operators can see and
 * consciously size around it instead of it being silently wrong in a
 * comment nobody re-derives.
 *
 * Issue #698 (epic #679, "operational proof" wave): `db_pool_work_class_active`/
 * `db_pool_work_class_queued` gauges are emitted from `emitWorkClassGauges`
 * below, called at every point `active`/`queue.length` change (acquire,
 * hand-off on release, decrement on release, timeout eviction) — the
 * `/database/pool/health` endpoint and `getWorkClassSaturation` themselves
 * need no changes; they already read the same `gates` state this now also
 * mirrors into metrics.
 *
 * Issue #743 (epic #738, platform-evolution): the FIFO queue below used to
 * be unbounded — under sustained saturation, every caller past `max` would
 * queue and wait the full `timeoutMs` before failing, which is exactly the
 * "cascading timeout chain" the issue's graceful-saturation requirement
 * asks to avoid, instead of a prompt, controlled rejection.
 * `acquireWorkClassSlot` now caps the queue at
 * `WORK_CLASS_MAX[workClass] * queueDepthMultiplier`
 * (`DATABASE_WORK_CLASS_QUEUE_MULTIPLIER`, default 4, clamped to [1, 20]) —
 * once the queue is at that cap, a new caller is rejected IMMEDIATELY with
 * `WorkClassQueueFullError` (not queued, not timed out) so `withTenant`
 * (`tenant-context.ts`) can fail fast with a `503` + `Retry-After` instead
 * of holding the caller open for the full queue timeout. Default multiplier
 * 4 keeps every existing deployment's behavior close to "generously bounded
 * rather than unbounded" without meaningfully changing observed behavior
 * under normal (non-saturated) load.
 */
import {
  recordCounter,
  recordGauge,
  recordHistogram
} from "../observability/metrics-port";

export type WorkClass =
  | "critical_transaction"
  | "interactive"
  | "reporting"
  | "background_sync"
  | "maintenance";

export type WorkClassSlot = {
  release: () => void;
};

export class WorkClassTimeoutError extends Error {
  readonly workClass: WorkClass;

  constructor(workClass: WorkClass, timeoutMs: number) {
    super(
      `Timed out after ${timeoutMs}ms waiting for a "${workClass}" work-class slot.`
    );
    this.name = "WorkClassTimeoutError";
    this.workClass = workClass;
  }
}

/**
 * Issue #743 — distinct from `WorkClassTimeoutError`: this rejects
 * IMMEDIATELY (the caller never waits at all) because the bounded FIFO
 * queue for `workClass` is already at capacity, not because a wait expired.
 * Kept as a separate class (rather than reusing `WorkClassTimeoutError` with
 * `timeoutMs: 0`) so callers/metrics/logs can tell "rejected outright" apart
 * from "waited and then gave up" — two different operational signals.
 */
export class WorkClassQueueFullError extends Error {
  readonly workClass: WorkClass;
  readonly queueDepth: number;

  constructor(workClass: WorkClass, queueDepth: number) {
    super(
      `The "${workClass}" work-class queue is already full (${queueDepth} waiting) — rejecting immediately instead of queueing further.`
    );
    this.name = "WorkClassQueueFullError";
    this.workClass = workClass;
    this.queueDepth = queueDepth;
  }
}

const WORK_CLASS_MAX: Record<WorkClass, number> = {
  critical_transaction: 10,
  interactive: 8,
  reporting: 4,
  background_sync: 4,
  maintenance: 1
};

const DEFAULT_QUEUE_DEPTH_MULTIPLIER = 4;
const MIN_QUEUE_DEPTH_MULTIPLIER = 1;
const MAX_QUEUE_DEPTH_MULTIPLIER = 20;

/**
 * `DATABASE_WORK_CLASS_QUEUE_MULTIPLIER` (Issue #743) — the one env-tunable
 * knob for work-class queue sizing, resolved once at module load (same
 * timing as `WORK_CLASS_MAX`'s hardcoded values, which stay fixed code
 * constants — see this file's header comment for why concurrency RATIOS
 * are not, while queue depth is, made deployment-tunable). Clamped to
 * [1, 20] and falls back to the default on any non-finite/non-integer/
 * out-of-range input — a malformed value must never crash the process at
 * import time.
 */
function resolveQueueDepthMultiplier(
  env: Record<string, string | undefined> = process.env
): number {
  const raw = Number(
    env.DATABASE_WORK_CLASS_QUEUE_MULTIPLIER ?? DEFAULT_QUEUE_DEPTH_MULTIPLIER
  );

  if (!Number.isFinite(raw) || !Number.isInteger(raw)) {
    return DEFAULT_QUEUE_DEPTH_MULTIPLIER;
  }

  return Math.min(
    MAX_QUEUE_DEPTH_MULTIPLIER,
    Math.max(MIN_QUEUE_DEPTH_MULTIPLIER, raw)
  );
}

const QUEUE_DEPTH_MULTIPLIER = resolveQueueDepthMultiplier();

/** Bounded queue cap for `workClass` — see this file's header comment on `acquireWorkClassSlot`'s bounded-queue behavior (Issue #743). */
function getMaxQueueDepth(workClass: WorkClass): number {
  return WORK_CLASS_MAX[workClass] * QUEUE_DEPTH_MULTIPLIER;
}

export type WorkClassLimits = {
  workClass: WorkClass;
  maxConcurrency: number;
  maxQueueDepth: number;
};

/**
 * Pure snapshot of the CONFIGURED (not current-usage) limits per work
 * class — the single source of truth `capacity-config.ts`'s calculator
 * reads to cross-check work-class concurrency against a process's pool
 * `max` (Issue #743), instead of re-declaring these numbers a second time.
 */
export function getWorkClassLimits(): WorkClassLimits[] {
  return (Object.keys(WORK_CLASS_MAX) as WorkClass[]).map((workClass) => ({
    workClass,
    maxConcurrency: WORK_CLASS_MAX[workClass],
    maxQueueDepth: getMaxQueueDepth(workClass)
  }));
}

type Waiter = {
  resolve: (slot: WorkClassSlot) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type GateState = {
  active: number;
  queue: Waiter[];
};

function createGateState(): Record<WorkClass, GateState> {
  return {
    critical_transaction: { active: 0, queue: [] },
    interactive: { active: 0, queue: [] },
    reporting: { active: 0, queue: [] },
    background_sync: { active: 0, queue: [] },
    maintenance: { active: 0, queue: [] }
  };
}

let gates = createGateState();

/** Mirrors `gates[workClass]`'s current active/queued counts into gauges — called at every point either number changes. `workClass` is a fixed 5-value enum, so this is always a safe, low-cardinality label. */
function emitWorkClassGauges(workClass: WorkClass): void {
  const gate = gates[workClass];

  recordGauge("db_pool_work_class_active", gate.active, { workClass });
  recordGauge("db_pool_work_class_queued", gate.queue.length, { workClass });
}

function makeSlot(workClass: WorkClass): WorkClassSlot {
  let released = false;

  return {
    release: () => {
      if (released) {
        return;
      }

      released = true;
      releaseSlot(workClass);
    }
  };
}

function releaseSlot(workClass: WorkClass): void {
  const gate = gates[workClass];
  const next = gate.queue.shift();

  if (next) {
    clearTimeout(next.timer);
    // Active count stays the same: the freed slot is handed directly to the
    // next queued waiter instead of being decremented then re-incremented.
    next.resolve(makeSlot(workClass));
    emitWorkClassGauges(workClass);
    return;
  }

  gate.active = Math.max(0, gate.active - 1);
  emitWorkClassGauges(workClass);
}

/**
 * Acquire a concurrency slot for `workClass`. Resolves immediately if under
 * the class's max; otherwise queues FIFO and resolves when a slot frees, or
 * rejects with `WorkClassTimeoutError` after `timeoutMs`.
 *
 * Issue #743: the queue itself is now bounded — if the queue is already at
 * `getMaxQueueDepth(workClass)` when this is called, it rejects IMMEDIATELY
 * with `WorkClassQueueFullError` (never joins the queue, never starts a
 * timeout timer). `db_pool_work_class_rejected_total` counts that outcome;
 * `db_pool_work_class_wait_ms` records how long a caller that DID queue
 * waited, for either outcome (eventually acquired, or timed out) — the
 * "saturation duration" operational signal the issue's scope asks for.
 * Immediate (non-queued) acquisitions deliberately do NOT emit a wait_ms
 * observation of 0 — that would dilute the histogram with the (large)
 * majority of calls that never experienced any backpressure at all.
 */
export function acquireWorkClassSlot(
  workClass: WorkClass,
  timeoutMs: number
): Promise<WorkClassSlot> {
  const gate = gates[workClass];
  const max = WORK_CLASS_MAX[workClass];

  if (gate.active < max) {
    gate.active += 1;
    emitWorkClassGauges(workClass);

    return Promise.resolve(makeSlot(workClass));
  }

  const maxQueueDepth = getMaxQueueDepth(workClass);

  if (gate.queue.length >= maxQueueDepth) {
    recordCounter("db_pool_work_class_rejected_total", { workClass });

    return Promise.reject(
      new WorkClassQueueFullError(workClass, maxQueueDepth)
    );
  }

  const enqueuedAtMs = performance.now();

  return new Promise<WorkClassSlot>((resolve, reject) => {
    const waiter: Waiter = {
      resolve: (slot) => {
        recordHistogram(
          "db_pool_work_class_wait_ms",
          performance.now() - enqueuedAtMs,
          { workClass, outcome: "acquired" }
        );
        resolve(slot);
      },
      reject,
      timer: setTimeout(() => {
        const index = gate.queue.indexOf(waiter);

        if (index >= 0) {
          gate.queue.splice(index, 1);
        }

        emitWorkClassGauges(workClass);
        recordHistogram(
          "db_pool_work_class_wait_ms",
          performance.now() - enqueuedAtMs,
          { workClass, outcome: "timeout" }
        );
        reject(new WorkClassTimeoutError(workClass, timeoutMs));
      }, timeoutMs)
    };

    gate.queue.push(waiter);
    emitWorkClassGauges(workClass);
  });
}

export type WorkClassSaturation = {
  workClass: WorkClass;
  active: number;
  max: number;
  queued: number;
  /** Bounded queue cap (Issue #743) — `queued` rejects immediately, via `WorkClassQueueFullError`, once it would reach this number. */
  maxQueueDepth: number;
};

/**
 * Snapshot of current active/max/queued counts per work class, used by the
 * `/database/pool/health` endpoint and by saturation logging.
 */
export function getWorkClassSaturation(): WorkClassSaturation[] {
  return (Object.keys(gates) as WorkClass[]).map((workClass) => ({
    workClass,
    active: gates[workClass].active,
    max: WORK_CLASS_MAX[workClass],
    queued: gates[workClass].queue.length,
    maxQueueDepth: getMaxQueueDepth(workClass)
  }));
}

/**
 * Test-only reset so `tests/database-pooling.test.ts` cases don't leak state
 * (queued timers, active counts) into each other.
 */
export function resetWorkClassGatesForTests(): void {
  for (const workClass of Object.keys(gates) as WorkClass[]) {
    for (const waiter of gates[workClass].queue) {
      clearTimeout(waiter.timer);
    }
  }

  gates = createGateState();
}
