/**
 * Idempotent rebuild engine (Issue #753 — "idempotent rebuild is a
 * concurrency/correctness hazard, not just a nice-to-have").
 *
 * SAFETY MODEL (read before touching this file):
 * 1. `triggerOrResumeRebuild` is the ONLY place a rebuild's cursors/metrics
 *    are ever reset to zero. It runs the "does a running rebuild already
 *    exist? -> if not, INSERT the new run row AND reset every rebuildSource
 *    stream's cursor/metric rows" sequence entirely within the CALLER's own
 *    already-open transaction (`tx`, always the API route's `withTenant`
 *    callback in practice — see `src/pages/api/v1/reports/projections/
 *    [key]/rebuild/index.ts`), so a crash between "insert the run row" and
 *    "reset cursors/metrics" is IMPOSSIBLE — either the whole reset commits
 *    together with the new run row AND the caller's own audit-log write and
 *    idempotency-record save, or (on any failure) NONE of it does and the
 *    OLD projection state (from before this rebuild was even requested) is
 *    untouched. Migration 069's partial unique index
 *    (`awcms_reporting_rebuild_runs_running_unique`, `WHERE status =
 *    'running'`) additionally makes "two concurrent triggers both try to
 *    reset at once" impossible at the database level: `createRebuildRun`'s
 *    `INSERT ... ON CONFLICT ... DO NOTHING` inserts zero rows for the
 *    loser (a normal, non-poisoning outcome, not a thrown exception), which
 *    this function detects and re-reads `findRunningRebuild` to return the
 *    WINNER's run instead (never a silent double-reset).
 * 2. `continueRebuildPasses` NEVER resets anything — it only ever advances
 *    an ALREADY-RUNNING run's cursors forward via the exact same bounded,
 *    single-transaction "select batch -> apply deltas -> advance cursor"
 *    shape `projection-incremental-worker.ts`'s `runCursorStreamPass` uses
 *    for steady-state updates (this file's own `runRebuildStreamPass` is a
 *    near-identical sibling, differing only in ALSO checking
 *    `cancel_requested` and incrementing `rows_processed` in the same
 *    transaction). Because each pass's cursor only advances after that
 *    SAME transaction commits, a crash/kill between two passes leaves the
 *    cursor and the metric counters it produced in matching, consistent
 *    state at exactly the last COMPLETED pass — resuming (calling
 *    `continueRebuildPasses` again, whether from a retried API call, the
 *    next scheduled worker tick, or an operator re-triggering rebuild
 *    while one is already `'running'`, which `triggerOrResumeRebuild`
 *    turns into "return the existing running run" rather than a reset)
 *    picks up EXACTLY where the last committed pass left off — never
 *    re-counting an already-counted row (the cursor already moved past
 *    it) and never skipping a row (the cursor never advances past a row
 *    it has not yet counted).
 * 3. While a run is `'running'` for a (tenant, projection), the STEADY-
 *    STATE incremental path (both the `cursor_table` worker and the
 *    `domain_event` live consumer) skips that (tenant, projection)
 *    entirely (see `projection-incremental-worker.ts`'s
 *    `isRebuildRunning` guard and `event-activity-projection.ts`'s own
 *    check) — this is what prevents the rebuild's full re-scan and a
 *    concurrent live update from BOTH counting the same newly-arrived
 *    row.
 */
import { withTenant } from "../../../lib/database/tenant-context";
import {
  fetchActiveTenants,
  runBoundedBatches
} from "../../../lib/jobs/batching";
import type {
  ProjectionCursorStream,
  ProjectionDescriptor
} from "../../_shared/module-contract";
import { applyCursorBoundarySafetyMargin } from "../domain/cursor-boundary";
import {
  getStreamCursor,
  resetProjectionCursors,
  upsertStreamCursor
} from "./projection-cursor-store";
import {
  applyMetricDeltas,
  resetProjectionMetrics,
  type MetricDelta
} from "./projection-metric-store";
import {
  addRebuildRowsProcessed,
  completeRebuildRun,
  createRebuildRun,
  failRebuildRun,
  findRunningRebuild,
  getRebuildRunById,
  markRebuildCancelled,
  type RebuildRunRow
} from "./rebuild-run-store";

const TABLE_NAME_PATTERN = /^awcms_[a-z][a-z0-9_]*$/;
const COLUMN_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

function assertSafeIdentifier(name: string, kind: "table" | "column"): string {
  const pattern = kind === "table" ? TABLE_NAME_PATTERN : COLUMN_NAME_PATTERN;
  if (!pattern.test(name)) {
    throw new Error(
      `reporting rebuild engine: refusing to build SQL from an unsafe ${kind} identifier: ${JSON.stringify(name)}.`
    );
  }
  return name;
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(value as string);
}

function collectRebuildStreamKeys(descriptor: ProjectionDescriptor): string[] {
  return descriptor.rebuildSource.streams.map((stream) => stream.streamKey);
}

function collectRebuildMetricKeys(descriptor: ProjectionDescriptor): string[] {
  const keys = new Set<string>();
  for (const stream of descriptor.rebuildSource.streams) {
    for (const metric of stream.metrics) {
      keys.add(metric.metricKey);
    }
  }
  return Array.from(keys);
}

export type TriggerRebuildResult = {
  run: RebuildRunRow;
  /** `true` when an already-`'running'` rebuild was found and returned as-is (no reset happened) rather than a new one created. */
  resumed: boolean;
};

/**
 * Runs entirely within the CALLER's own already-open transaction (`tx`) —
 * same convention every other route-invoked mutation in this repo follows
 * (e.g. `data-lifecycle/application/legal-hold-service.ts`'s
 * `createLegalHold`), so the reset (cursors/metrics) + new run row +
 * caller's own audit-log write + idempotency-record save all commit or
 * roll back TOGETHER as one atomic unit. Safe against a concurrent-race
 * double-reset because `createRebuildRun` uses `INSERT ... ON CONFLICT ...
 * DO NOTHING` (see that function's own doc comment) rather than a raw
 * unique-violation exception — an `ON CONFLICT DO NOTHING` that inserts
 * zero rows does NOT poison the surrounding transaction, so the
 * "someone else already started one" branch below can keep using the
 * SAME `tx` to re-read `findRunningRebuild`.
 */
export async function triggerOrResumeRebuild(
  tx: Bun.SQL,
  tenantId: string,
  descriptor: ProjectionDescriptor,
  input: {
    requestedBy: string | null;
    reason: string | null;
    correlationId?: string | null;
  }
): Promise<TriggerRebuildResult> {
  const existing = await findRunningRebuild(tx, tenantId, descriptor.key);
  if (existing) {
    return { run: existing, resumed: true };
  }

  const created = await createRebuildRun(tx, tenantId, descriptor.key, input);

  if (!created) {
    // Lost a genuine concurrent race — another request's INSERT won
    // (visible to us now under READ COMMITTED since it already
    // committed; `ON CONFLICT DO NOTHING` never blocks). Hand back that
    // run instead of a silent double-reset.
    const winner = await findRunningRebuild(tx, tenantId, descriptor.key);
    if (!winner) {
      // Extremely narrow window: the other run already completed between
      // our failed INSERT and this re-read — safe to just try once more.
      return triggerOrResumeRebuild(tx, tenantId, descriptor, input);
    }
    return { run: winner, resumed: true };
  }

  await resetProjectionCursors(
    tx,
    tenantId,
    descriptor.key,
    collectRebuildStreamKeys(descriptor)
  );
  await resetProjectionMetrics(
    tx,
    tenantId,
    descriptor.key,
    collectRebuildMetricKeys(descriptor)
  );

  return { run: created, resumed: false };
}

/**
 * One bounded rebuild pass over a single rebuildSource stream — same shape
 * as `projection-incremental-worker.ts`'s `runCursorStreamPass`, plus (a)
 * a fresh `cancel_requested` check at the START of the transaction (a
 * cancellation requested between two passes takes effect on the very next
 * pass, not just the next invocation — same TOCTOU-safe re-fetch pattern
 * `data_lifecycle`'s legal-hold re-check established) and (b) incrementing
 * the run's `rows_processed` in the SAME transaction as the cursor
 * advance.
 */
async function runRebuildStreamPass(
  sql: Bun.SQL,
  tenantId: string,
  descriptor: ProjectionDescriptor,
  runId: string,
  stream: ProjectionCursorStream
): Promise<{ count: number; cancelled: boolean }> {
  const tableName = assertSafeIdentifier(stream.tableName, "table");
  const tenantColumn = assertSafeIdentifier(
    stream.tenantColumn ?? "tenant_id",
    "column"
  );
  const cursorColumn = assertSafeIdentifier(stream.cursorColumn, "column");
  const matchColumns = Array.from(
    new Set(
      stream.metrics
        .map((rule) => rule.matchColumn)
        .filter((column): column is string => column !== undefined)
        .map((column) => assertSafeIdentifier(column, "column"))
    )
  );
  const selectColumns = Array.from(new Set([cursorColumn, ...matchColumns]));

  return withTenant(
    sql,
    tenantId,
    async (tx) => {
      const run = await getRebuildRunById(tx, tenantId, runId);
      if (!run || run.status !== "running") {
        return { count: 0, cancelled: false };
      }
      if (run.cancelRequested) {
        await markRebuildCancelled(tx, tenantId, runId);
        return { count: 0, cancelled: true };
      }

      const cursor = await getStreamCursor(
        tx,
        tenantId,
        descriptor.key,
        stream.streamKey
      );
      const resumeAfterBound = cursor
        ? applyCursorBoundarySafetyMargin(cursor)
        : null;

      const rows = (
        resumeAfterBound
          ? await tx.unsafe(
              `SELECT ${selectColumns.join(", ")} FROM ${tableName}
               WHERE ${tenantColumn} = $1 AND ${cursorColumn} >= $2
               ORDER BY ${cursorColumn} ASC LIMIT $3`,
              [tenantId, resumeAfterBound, descriptor.batchLimit]
            )
          : await tx.unsafe(
              `SELECT ${selectColumns.join(", ")} FROM ${tableName}
               WHERE ${tenantColumn} = $1
               ORDER BY ${cursorColumn} ASC LIMIT $2`,
              [tenantId, descriptor.batchLimit]
            )
      ) as Record<string, unknown>[];

      if (rows.length === 0) {
        return { count: 0, cancelled: false };
      }

      const deltas: MetricDelta[] = stream.metrics.map((rule) => {
        const matchingCount =
          rule.matchColumn === undefined
            ? rows.length
            : rows.filter(
                (row) => String(row[rule.matchColumn!]) === rule.matchValue
              ).length;
        return {
          metricKey: rule.metricKey,
          delta: rule.effect === "increment" ? matchingCount : -matchingCount
        };
      });

      await applyMetricDeltas(tx, tenantId, descriptor.key, deltas);

      const newCursorValue = toDate(rows[rows.length - 1]![cursorColumn]);
      await upsertStreamCursor(
        tx,
        tenantId,
        descriptor.key,
        stream.streamKey,
        newCursorValue
      );
      await addRebuildRowsProcessed(tx, tenantId, runId, rows.length);

      return { count: rows.length, cancelled: false };
    },
    { workClass: "maintenance" }
  );
}

export type ContinueRebuildResult = {
  status: "completed" | "cancelled" | "in_progress" | "failed" | "not_found";
  rowsProcessedThisInvocation: number;
};

/**
 * Continues an already-`'running'` rebuild's bounded passes across every
 * `rebuildSource` stream, up to `maxPasses` PER STREAM (bounded — a huge
 * backlog never runs unbounded in one invocation; a follow-up invocation,
 * whether the next scheduled worker tick or a repeated API call, resumes
 * exactly where this one left off, per this file's own header comment).
 * Marks the run `'completed'` once every stream reports zero remaining
 * rows, `'cancelled'` if a cancellation was observed mid-pass, or
 * `'failed'` if a stream pass throws.
 */
export async function continueRebuildPasses(
  sql: Bun.SQL,
  tenantId: string,
  descriptor: ProjectionDescriptor,
  runId: string,
  maxPasses?: number
): Promise<ContinueRebuildResult> {
  const run = await withTenant(
    sql,
    tenantId,
    (tx) => getRebuildRunById(tx, tenantId, runId),
    { workClass: "maintenance" }
  );
  if (!run) {
    return { status: "not_found", rowsProcessedThisInvocation: 0 };
  }
  if (run.status !== "running") {
    return { status: run.status, rowsProcessedThisInvocation: 0 };
  }

  let rowsProcessedThisInvocation = 0;
  let hitPassLimit = false;

  try {
    for (const stream of descriptor.rebuildSource.streams) {
      const outcome = await runBoundedBatches(
        () => runRebuildStreamPass(sql, tenantId, descriptor, runId, stream),
        { maxPasses }
      );
      rowsProcessedThisInvocation += outcome.totalCount;

      const cancelledThisStream = outcome.passes.some((pass) => pass.cancelled);
      if (cancelledThisStream) {
        return { status: "cancelled", rowsProcessedThisInvocation };
      }

      // CRITICAL: `hitPassLimit` means `maxPasses` was reached WITHOUT a
      // pass reporting `count: 0` — i.e. this stream's backlog is NOT
      // fully drained. Marking the run `'completed'` here anyway (the
      // bug this comment guards against, caught by this issue's own
      // crash-mid-rebuild adversarial test) would silently under-report
      // the projection's true total forever — a rebuild is only ever
      // "done" when every stream itself reports zero remaining rows.
      if (outcome.hitPassLimit) {
        hitPassLimit = true;
      }
    }

    if (hitPassLimit) {
      return { status: "in_progress", rowsProcessedThisInvocation };
    }

    const stillRunning = await withTenant(
      sql,
      tenantId,
      (tx) => getRebuildRunById(tx, tenantId, runId),
      { workClass: "maintenance" }
    );
    if (stillRunning?.status !== "running") {
      // Cancelled by a concurrent request during this invocation.
      return {
        status: stillRunning?.status ?? "not_found",
        rowsProcessedThisInvocation
      };
    }

    await withTenant(
      sql,
      tenantId,
      (tx) => completeRebuildRun(tx, tenantId, runId),
      { workClass: "maintenance" }
    );
    return { status: "completed", rowsProcessedThisInvocation };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await withTenant(
      sql,
      tenantId,
      (tx) => failRebuildRun(tx, tenantId, runId, message),
      { workClass: "maintenance" }
    );
    return { status: "failed", rowsProcessedThisInvocation };
  }
}

/**
 * Continues every currently-`'running'` rebuild, across every active
 * tenant and every registered projection descriptor — the rebuild-
 * continuation half of `bun run reporting:projections:refresh`. A rebuild
 * that was never started (no `'running'` row) is simply skipped for that
 * (tenant, descriptor) — this function never creates a new rebuild run
 * itself (only `triggerOrResumeRebuild`, an explicit permission-gated API
 * action, does that).
 */
export async function continueAllRunningRebuilds(
  sql: Bun.SQL,
  descriptors: readonly ProjectionDescriptor[],
  maxPasses?: number
): Promise<ContinueRebuildResult[]> {
  const tenants = await fetchActiveTenants(sql);
  const results: ContinueRebuildResult[] = [];

  for (const tenant of tenants) {
    for (const descriptor of descriptors) {
      const running = await withTenant(
        sql,
        tenant.id,
        (tx) => findRunningRebuild(tx, tenant.id, descriptor.key),
        { workClass: "maintenance" }
      );
      if (!running) {
        continue;
      }
      results.push(
        await continueRebuildPasses(
          sql,
          tenant.id,
          descriptor,
          running.id,
          maxPasses
        )
      );
    }
  }

  return results;
}
