/**
 * Generic bounded cursor-scan engine (Issue #753). This is the ONLY
 * mechanism that ever reads a `cursor_table`-strategy projection's (or ANY
 * projection's rebuild) source table(s) — same "SELECT (bounded) -> apply
 * -> advance cursor, all in ONE transaction" shape `data_lifecycle`'s
 * `archive-purge-job.ts` already proved correct (crash-safe, resumable,
 * never double-applies a row on retry because the cursor only advances
 * AFTER the same transaction that applied the batch commits).
 *
 * Table/column identifiers come from CODE-DECLARED descriptors
 * (`ProjectionCursorStream`, never tenant/request input) but are still
 * validated against a strict allow-list pattern here — same defense-in-
 * depth `assertSafeIdentifier` already establishes in `data-lifecycle/
 * application/archive-purge-job.ts` — before being interpolated into a
 * dynamic `tx.unsafe(...)` query (the ONLY way to parameterize a table
 * name at all; every VALUE, including `matchValue`, is still a real bound
 * parameter, never string-concatenated).
 *
 * MUTUAL EXCLUSION WITH REBUILD (Issue #753 critical requirement —
 * idempotent rebuild must never double-count): before touching a (tenant,
 * projection)'s cursor/metric rows, `runIncrementalUpdateForTenant` checks
 * `findRunningRebuild` and SKIPS entirely if a rebuild currently owns this
 * projection. This is deliberately simple (skip, don't try to interleave)
 * — a rebuild re-derives the projection's ENTIRE state from a full re-scan
 * of the authoritative source table, so any row written to that table
 * during the rebuild window is guaranteed to already be included in the
 * rebuild's own scan by the time it reaches that row; letting the
 * steady-state path ALSO apply the same row concurrently would double-
 * count it. The same guard is applied by the event-driven consumer
 * handler (`event-activity-projection.ts`) for the one `domain_event`
 *
 * KNOWN LIMITATION (cursor ties, inherited from `data_lifecycle`'s own
 * documented limitation — see `archive-purge-job.ts`'s header): resume is
 * `cursorColumn >= cursor + 1ms`. If more rows share the EXACT SAME
 * cursor value (or land within that same 1ms window) than fit in one
 * `batchLimit`-sized page, the ones past the page cutoff are excluded
 * from the NEXT pass too (the `+1ms` pad that correctly stops a
 * boundary row from being re-counted also — unavoidably, with a plain
 * timestamp cursor and no `(cursorValue, id)` tie-breaking — excludes a
 * genuinely different row sharing that same narrow window). Real
 * `awcms_abac_decision_logs`/`identities`/`sync_nodes` writes are
 * ordinary, separately-committed statements spread over real wall-clock
 * time, so this is a narrow edge case in production; it is NOT narrow
 * for a test that seeds many rows inside one transaction (`now()` is
 * STABLE for the whole transaction in Postgres) — such a test MUST
 * assign each row a distinct, explicit `created_at` rather than relying
 * on the column's own `DEFAULT now()` (see `tests/integration/
 * reporting-projections.integration.test.ts`'s `seedDecisionLogs`).
 * strategy projection, for the identical reason.
 */
import {
  applyCursorBoundarySafetyMargin,
  CURSOR_BOUNDARY_SAFETY_MARGIN_MS
} from "../domain/cursor-boundary";
import type {
  ProjectionCursorMetricRule,
  ProjectionCursorStream,
  ProjectionDescriptor
} from "../../_shared/module-contract";
import { withTenant } from "../../../lib/database/tenant-context";
import {
  fetchActiveTenants,
  runBoundedBatches
} from "../../../lib/jobs/batching";
import { getStreamCursor, upsertStreamCursor } from "./projection-cursor-store";
import { applyMetricDeltas, type MetricDelta } from "./projection-metric-store";
import {
  recordProjectionFailure,
  recordProjectionSuccess
} from "./projection-state-store";
import { findRunningRebuild } from "./rebuild-run-store";

const TABLE_NAME_PATTERN = /^awcms_[a-z][a-z0-9_]*$/;
const COLUMN_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

function assertSafeIdentifier(name: string, kind: "table" | "column"): string {
  const pattern = kind === "table" ? TABLE_NAME_PATTERN : COLUMN_NAME_PATTERN;

  if (!pattern.test(name)) {
    throw new Error(
      `reporting projection engine: refusing to build SQL from an unsafe ${kind} identifier: ${JSON.stringify(name)}.`
    );
  }

  return name;
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(value as string);
}

function computeMetricDeltas(
  batchRows: readonly Record<string, unknown>[],
  metrics: readonly ProjectionCursorMetricRule[]
): MetricDelta[] {
  return metrics.map((rule) => {
    const matchingCount =
      rule.matchColumn === undefined
        ? batchRows.length
        : batchRows.filter(
            (row) => String(row[rule.matchColumn!]) === rule.matchValue
          ).length;

    return {
      metricKey: rule.metricKey,
      delta: rule.effect === "increment" ? matchingCount : -matchingCount
    };
  });
}

/**
 * One bounded pass over a single stream: SELECT the next `batchLimit` rows
 * strictly after the stored cursor, compute per-metric deltas, apply them,
 * and advance the cursor — all in ONE transaction (pure DB operation, no
 * external I/O, ADR-0006-compliant single-transaction shape). Returns
 * `{ count: 0 }` once the stream has caught up to the current backlog.
 */
export async function runCursorStreamPass(
  sql: Bun.SQL,
  tenantId: string,
  projectionKey: string,
  stream: ProjectionCursorStream,
  batchLimit: number
): Promise<{ count: number }> {
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
      const cursor = await getStreamCursor(
        tx,
        tenantId,
        projectionKey,
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
              [tenantId, resumeAfterBound, batchLimit]
            )
          : await tx.unsafe(
              `SELECT ${selectColumns.join(", ")} FROM ${tableName}
               WHERE ${tenantColumn} = $1
               ORDER BY ${cursorColumn} ASC LIMIT $2`,
              [tenantId, batchLimit]
            )
      ) as Record<string, unknown>[];

      if (rows.length === 0) {
        return { count: 0 };
      }

      const deltas = computeMetricDeltas(rows, stream.metrics);
      await applyMetricDeltas(tx, tenantId, projectionKey, deltas);

      const newCursorValue = toDate(rows[rows.length - 1]![cursorColumn]);
      await upsertStreamCursor(
        tx,
        tenantId,
        projectionKey,
        stream.streamKey,
        newCursorValue
      );

      return { count: rows.length };
    },
    { workClass: "maintenance" }
  );
}

async function isRebuildRunning(
  sql: Bun.SQL,
  tenantId: string,
  projectionKey: string
): Promise<boolean> {
  const running = await withTenant(
    sql,
    tenantId,
    (tx) => findRunningRebuild(tx, tenantId, projectionKey),
    { workClass: "maintenance" }
  );
  return running !== null;
}

export type IncrementalUpdateOutcome = {
  projectionKey: string;
  tenantId: string;
  skippedRebuildInProgress: boolean;
  rowsProcessed: number;
  failed: boolean;
};

/**
 * Runs every stream of a `cursor_table`-strategy descriptor's steady-state
 * `source` to completion (or `maxPasses`) for ONE tenant, then records
 * success/failure to `projection-state-store.ts` exactly once for this
 * (tenant, descriptor) — the granularity the freshness signal needs to
 * correctly reflect "this tenant's update silently failed" without
 * affecting any other tenant's status (Issue #753 critical requirement).
 */
export async function runIncrementalUpdateForTenant(
  sql: Bun.SQL,
  descriptor: ProjectionDescriptor,
  tenantId: string,
  maxPasses?: number
): Promise<IncrementalUpdateOutcome> {
  if (descriptor.source.strategy !== "cursor_table") {
    throw new Error(
      `runIncrementalUpdateForTenant: descriptor "${descriptor.key}" is not a "cursor_table" strategy projection.`
    );
  }

  if (await isRebuildRunning(sql, tenantId, descriptor.key)) {
    return {
      projectionKey: descriptor.key,
      tenantId,
      skippedRebuildInProgress: true,
      rowsProcessed: 0,
      failed: false
    };
  }

  let rowsProcessed = 0;

  try {
    for (const stream of descriptor.source.streams) {
      const outcome = await runBoundedBatches(
        () =>
          runCursorStreamPass(
            sql,
            tenantId,
            descriptor.key,
            stream,
            descriptor.batchLimit
          ),
        { maxPasses }
      );
      rowsProcessed += outcome.totalCount;
    }

    await withTenant(
      sql,
      tenantId,
      (tx) => recordProjectionSuccess(tx, tenantId, descriptor.key),
      { workClass: "maintenance" }
    );

    return {
      projectionKey: descriptor.key,
      tenantId,
      skippedRebuildInProgress: false,
      rowsProcessed,
      failed: false
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await withTenant(
      sql,
      tenantId,
      (tx) => recordProjectionFailure(tx, tenantId, descriptor.key, message),
      { workClass: "maintenance" }
    );

    return {
      projectionKey: descriptor.key,
      tenantId,
      skippedRebuildInProgress: false,
      rowsProcessed,
      failed: true
    };
  }
}

/** Runs `runIncrementalUpdateForTenant` for every `active` tenant, for every registered `cursor_table`-strategy descriptor — the body of `bun run reporting:projections:refresh` (`scripts/reporting-projections-refresh.ts`). One tenant's thrown error is caught and recorded per-tenant (above); it never stops the loop for other tenants or other descriptors. */
export async function runIncrementalUpdateForAllTenants(
  sql: Bun.SQL,
  descriptors: readonly ProjectionDescriptor[]
): Promise<IncrementalUpdateOutcome[]> {
  const cursorTableDescriptors = descriptors.filter(
    (descriptor) => descriptor.source.strategy === "cursor_table"
  );
  const tenants = await fetchActiveTenants(sql);
  const outcomes: IncrementalUpdateOutcome[] = [];

  for (const tenant of tenants) {
    for (const descriptor of cursorTableDescriptors) {
      outcomes.push(
        await runIncrementalUpdateForTenant(sql, descriptor, tenant.id)
      );
    }
  }

  return outcomes;
}

export { CURSOR_BOUNDARY_SAFETY_MARGIN_MS };
