/**
 * Materialized projection metric value store (Issue #753) —
 * `awcms_reporting_projection_metrics`. Every value is a
 * non-negative counter (DB `CHECK` backstop, migration 069); a
 * `"decrement"` rule is clamped at 0 in application code too (defense in
 * depth — a source-data bug should never surface as a negative count).
 */

export type ProjectionMetricValues = Record<string, number>;

export async function getProjectionMetrics(
  tx: Bun.SQL,
  tenantId: string,
  projectionKey: string
): Promise<ProjectionMetricValues> {
  const rows = (await tx`
    SELECT metric_key, metric_value
    FROM awcms_reporting_projection_metrics
    WHERE tenant_id = ${tenantId} AND projection_key = ${projectionKey}
  `) as { metric_key: string; metric_value: string | number }[];

  const values: ProjectionMetricValues = {};
  for (const row of rows) {
    values[row.metric_key] = Number(row.metric_value);
  }
  return values;
}

export type MetricDelta = {
  metricKey: string;
  /** Positive to increment, negative to decrement — the caller (`projection-incremental-worker.ts`) resolves `ProjectionCursorMetricRule.effect` into a signed delta before calling this. */
  delta: number;
};

/**
 * Applies every delta for a (tenant, projection) in one statement per
 * metric, within the caller's own transaction — the caller is responsible
 * for bounding the batch this delta was computed from (this store has no
 * concept of "how many source rows produced this delta", it only applies
 * the already-computed number). `GREATEST(..., 0)` clamps a decrement
 * that would otherwise go negative (defense in depth against a source-data
 * inconsistency, never expected in the two registered "increment-only"
 * projections' real data).
 */
export async function applyMetricDeltas(
  tx: Bun.SQL,
  tenantId: string,
  projectionKey: string,
  deltas: readonly MetricDelta[]
): Promise<void> {
  for (const { metricKey, delta } of deltas) {
    if (delta === 0) continue;

    await tx`
      INSERT INTO awcms_reporting_projection_metrics
        (tenant_id, projection_key, metric_key, metric_value)
      VALUES (${tenantId}, ${projectionKey}, ${metricKey}, GREATEST(${delta}, 0))
      ON CONFLICT (tenant_id, projection_key, metric_key) DO UPDATE SET
        metric_value = GREATEST(awcms_reporting_projection_metrics.metric_value + ${delta}, 0),
        updated_at = now()
    `;
  }
}

/** Resets every named metric for a (tenant, projection) back to 0 — used ONLY by `projection-rebuild.ts`'s reset step, in the SAME transaction that creates the new rebuild run row. */
export async function resetProjectionMetrics(
  tx: Bun.SQL,
  tenantId: string,
  projectionKey: string,
  metricKeys: readonly string[]
): Promise<void> {
  for (const metricKey of metricKeys) {
    await tx`
      INSERT INTO awcms_reporting_projection_metrics
        (tenant_id, projection_key, metric_key, metric_value)
      VALUES (${tenantId}, ${projectionKey}, ${metricKey}, 0)
      ON CONFLICT (tenant_id, projection_key, metric_key) DO UPDATE SET
        metric_value = 0,
        updated_at = now()
    `;
  }
}
