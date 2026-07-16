/**
 * On-demand reconciliation run store (Issue #753) —
 * `awcms_reporting_reconciliation_runs`. Each row is a snapshot
 * comparison of a projection's metric values against a freshly computed
 * control total from its own source table(s) at the moment reconciliation
 * ran — see `application/projection-reconciliation.ts` for how `details`
 * is computed. Re-running reconciliation is always safe (each call just
 * appends a fresh snapshot; no Idempotency-Key is required, same "zero
 * mutation of business state, safe to retry" reasoning `data_lifecycle`'s
 * `POST /dry-run` endpoint documents).
 */
export type ReconciliationMetricDetail = {
  metricKey: string;
  projectionTotal: number;
  sourceTotal: number;
  mismatch: boolean;
};

export type ReconciliationRunRow = {
  id: string;
  projectionKey: string;
  mismatch: boolean;
  details: ReconciliationMetricDetail[];
  requestedBy: string | null;
  correlationId: string | null;
  executedAt: Date;
};

type ReconciliationRunDbRow = {
  id: string;
  projection_key: string;
  mismatch: boolean;
  details: ReconciliationMetricDetail[];
  requested_by: string | null;
  correlation_id: string | null;
  executed_at: Date;
};

function toRow(row: ReconciliationRunDbRow): ReconciliationRunRow {
  return {
    id: row.id,
    projectionKey: row.projection_key,
    mismatch: row.mismatch,
    details: row.details,
    requestedBy: row.requested_by,
    correlationId: row.correlation_id,
    executedAt: row.executed_at
  };
}

export async function recordReconciliationRun(
  tx: Bun.SQL,
  tenantId: string,
  input: {
    projectionKey: string;
    mismatch: boolean;
    details: readonly ReconciliationMetricDetail[];
    requestedBy: string | null;
    correlationId?: string | null;
  }
): Promise<ReconciliationRunRow> {
  // NOTE (repo lesson, Issue #623/#753): bind the plain array directly
  // with a `::jsonb` cast, never `JSON.stringify(...)::jsonb` — the
  // stringified form stores identical bytes but every later SELECT then
  // returns a raw JSON-text STRING instead of a parsed object/array,
  // silently breaking every reader (`details` above is typed as a plain
  // JS object/array; only a plain-object bind round-trips as one).
  const rows = (await tx`
    INSERT INTO awcms_reporting_reconciliation_runs
      (tenant_id, projection_key, mismatch, details, requested_by, correlation_id)
    VALUES (
      ${tenantId}, ${input.projectionKey}, ${input.mismatch},
      ${input.details}::jsonb, ${input.requestedBy}, ${input.correlationId ?? null}
    )
    RETURNING id, projection_key, mismatch, details, requested_by, correlation_id, executed_at
  `) as ReconciliationRunDbRow[];

  return toRow(rows[0]!);
}

/** `LIMIT 50`, newest first — most recent reconciliation history for a projection. */
export async function listReconciliationRuns(
  tx: Bun.SQL,
  tenantId: string,
  projectionKey: string
): Promise<ReconciliationRunRow[]> {
  const rows = (await tx`
    SELECT id, projection_key, mismatch, details, requested_by, correlation_id, executed_at
    FROM awcms_reporting_reconciliation_runs
    WHERE tenant_id = ${tenantId} AND projection_key = ${projectionKey}
    ORDER BY executed_at DESC
    LIMIT 50
  `) as ReconciliationRunDbRow[];

  return rows.map(toRow);
}
