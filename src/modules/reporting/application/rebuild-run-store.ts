/**
 * Rebuild run execution/progress store (Issue #753) —
 * `awcms_reporting_rebuild_runs`. Migration 069's partial unique
 * index (`... WHERE status = 'running'`) is the actual correctness
 * guarantee (at most one running rebuild per (tenant, projection) at a
 * time, enforced by Postgres, not application discipline) — this file
 * only wraps the SQL, it adds no additional locking of its own.
 */
export type RebuildRunStatus = "running" | "completed" | "failed" | "cancelled";

export type RebuildRunRow = {
  id: string;
  tenantId: string;
  projectionKey: string;
  status: RebuildRunStatus;
  startedAt: Date;
  completedAt: Date | null;
  rowsProcessed: number;
  cancelRequested: boolean;
  requestedBy: string | null;
  reason: string | null;
  errorMessage: string | null;
  correlationId: string | null;
  createdAt: Date;
};

type RebuildRunDbRow = {
  id: string;
  tenant_id: string;
  projection_key: string;
  status: RebuildRunStatus;
  started_at: Date;
  completed_at: Date | null;
  rows_processed: string | number;
  cancel_requested: boolean;
  requested_by: string | null;
  reason: string | null;
  error_message: string | null;
  correlation_id: string | null;
  created_at: Date;
};

function toRow(row: RebuildRunDbRow): RebuildRunRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    projectionKey: row.projection_key,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    rowsProcessed: Number(row.rows_processed),
    cancelRequested: row.cancel_requested,
    requestedBy: row.requested_by,
    reason: row.reason,
    errorMessage: row.error_message,
    correlationId: row.correlation_id,
    createdAt: row.created_at
  };
}

export async function findRunningRebuild(
  tx: Bun.SQL,
  tenantId: string,
  projectionKey: string
): Promise<RebuildRunRow | null> {
  const rows = (await tx`
    SELECT id, tenant_id, projection_key, status, started_at, completed_at,
      rows_processed, cancel_requested, requested_by, reason, error_message, correlation_id, created_at
    FROM awcms_reporting_rebuild_runs
    WHERE tenant_id = ${tenantId} AND projection_key = ${projectionKey} AND status = 'running'
  `) as RebuildRunDbRow[];

  return rows[0] ? toRow(rows[0]) : null;
}

export async function getRebuildRunById(
  tx: Bun.SQL,
  tenantId: string,
  runId: string
): Promise<RebuildRunRow | null> {
  const rows = (await tx`
    SELECT id, tenant_id, projection_key, status, started_at, completed_at,
      rows_processed, cancel_requested, requested_by, reason, error_message, correlation_id, created_at
    FROM awcms_reporting_rebuild_runs
    WHERE tenant_id = ${tenantId} AND id = ${runId}
  `) as RebuildRunDbRow[];

  return rows[0] ? toRow(rows[0]) : null;
}

/**
 * Creates a NEW rebuild run row with `status = 'running'` — `ON CONFLICT
 * (tenant_id, projection_key) WHERE status = 'running' DO NOTHING`
 * against migration 069's partial unique index, same idiom
 * `_shared/idempotency.ts`'s own `saveIdempotencyRecord` already
 * establishes for a "check-then-insert" race (an `ON CONFLICT DO NOTHING`
 * that inserts zero rows is a normal, successful statement — unlike a raw
 * unique-violation exception, it does NOT poison the surrounding
 * transaction, so this is safe to call from within the CALLER's own
 * already-open transaction rather than needing a separate one). Returns
 * `null` when another concurrent request already won the race — the
 * caller (`projection-rebuild.ts`'s `triggerOrResumeRebuild`) re-reads
 * `findRunningRebuild` in that case and returns the WINNER's run instead
 * of a silent double-reset.
 */
export async function createRebuildRun(
  tx: Bun.SQL,
  tenantId: string,
  projectionKey: string,
  input: {
    requestedBy: string | null;
    reason: string | null;
    correlationId?: string | null;
  }
): Promise<RebuildRunRow | null> {
  const rows = (await tx`
    INSERT INTO awcms_reporting_rebuild_runs
      (tenant_id, projection_key, status, requested_by, reason, correlation_id)
    VALUES (${tenantId}, ${projectionKey}, 'running', ${input.requestedBy}, ${input.reason}, ${input.correlationId ?? null})
    ON CONFLICT (tenant_id, projection_key) WHERE status = 'running' DO NOTHING
    RETURNING id, tenant_id, projection_key, status, started_at, completed_at,
      rows_processed, cancel_requested, requested_by, reason, error_message, correlation_id, created_at
  `) as RebuildRunDbRow[];

  return rows[0] ? toRow(rows[0]) : null;
}

export async function addRebuildRowsProcessed(
  tx: Bun.SQL,
  tenantId: string,
  runId: string,
  additionalRows: number
): Promise<void> {
  await tx`
    UPDATE awcms_reporting_rebuild_runs
    SET rows_processed = rows_processed + ${additionalRows}
    WHERE tenant_id = ${tenantId} AND id = ${runId}
  `;
}

export async function completeRebuildRun(
  tx: Bun.SQL,
  tenantId: string,
  runId: string
): Promise<void> {
  await tx`
    UPDATE awcms_reporting_rebuild_runs
    SET status = 'completed', completed_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${runId} AND status = 'running'
  `;
}

export async function failRebuildRun(
  tx: Bun.SQL,
  tenantId: string,
  runId: string,
  errorMessage: string
): Promise<void> {
  await tx`
    UPDATE awcms_reporting_rebuild_runs
    SET status = 'failed', completed_at = now(), error_message = ${errorMessage}
    WHERE tenant_id = ${tenantId} AND id = ${runId} AND status = 'running'
  `;
}

/** Sets the cooperative cancellation flag — checked by `projection-rebuild.ts`'s bounded-pass loop between passes (same "cooperative, not preemptive" cancellation model `runBoundedBatches`'s own `signal` already uses). */
export async function requestRebuildCancellation(
  tx: Bun.SQL,
  tenantId: string,
  runId: string
): Promise<void> {
  await tx`
    UPDATE awcms_reporting_rebuild_runs
    SET cancel_requested = true
    WHERE tenant_id = ${tenantId} AND id = ${runId} AND status = 'running'
  `;
}

export async function markRebuildCancelled(
  tx: Bun.SQL,
  tenantId: string,
  runId: string
): Promise<void> {
  await tx`
    UPDATE awcms_reporting_rebuild_runs
    SET status = 'cancelled', completed_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${runId} AND status = 'running'
  `;
}

/** `LIMIT 100`, newest first — operator history browsing, not a paginated feed (same convention `data_lifecycle`'s `listLifecycleRuns` established). */
export async function listRebuildRuns(
  tx: Bun.SQL,
  tenantId: string,
  projectionKey?: string
): Promise<RebuildRunRow[]> {
  const rows = (await tx`
    SELECT id, tenant_id, projection_key, status, started_at, completed_at,
      rows_processed, cancel_requested, requested_by, reason, error_message, correlation_id, created_at
    FROM awcms_reporting_rebuild_runs
    WHERE tenant_id = ${tenantId}
      AND (${projectionKey ?? null}::text IS NULL OR projection_key = ${projectionKey ?? null})
    ORDER BY created_at DESC
    LIMIT 100
  `) as RebuildRunDbRow[];

  return rows.map(toRow);
}
