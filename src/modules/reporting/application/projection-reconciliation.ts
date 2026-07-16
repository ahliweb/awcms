/**
 * Source reconciliation (Issue #753 scope: "detect/report drift between a
 * projection and its source"). Computes a FRESH, full (unbounded) control
 * total straight from each `rebuildSource` stream's authoritative table —
 * deliberately the SAME source contract a rebuild would re-derive from,
 * so "reconcile" and "rebuild" always agree about what the correct value
 * IS, even though reconciliation itself never mutates anything (a plain
 * `COUNT(*)`/`COUNT(*) FILTER (...)` read, same "zero mutation, safe to
 * retry, no Idempotency-Key needed" posture `data_lifecycle`'s dry-run
 * endpoint already established).
 *
 * A mismatch is NOT necessarily a bug — a projection that is merely
 * `"delayed"` (has not yet caught up to the latest source rows) will
 * legitimately reconcile with a mismatch until its next successful
 * incremental pass. That is reconciliation doing its job (surfacing
 * drift), not a false positive; callers should read the freshness status
 * alongside a reconciliation result, not instead of it.
 *
 * Takes the CALLER's own already-open transaction (`tx`) — same
 * "route-invoked mutations run inside the route's own `withTenant`
 * transaction, never a nested one" convention every other application
 * function invoked from an API route in this repo follows.
 */
import type { ProjectionDescriptor } from "../../_shared/module-contract";
import { getProjectionMetrics } from "./projection-metric-store";
import {
  recordReconciliationRun,
  type ReconciliationMetricDetail,
  type ReconciliationRunRow
} from "./reconciliation-run-store";

const TABLE_NAME_PATTERN = /^awcms_[a-z][a-z0-9_]*$/;
const COLUMN_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

function assertSafeIdentifier(name: string, kind: "table" | "column"): string {
  const pattern = kind === "table" ? TABLE_NAME_PATTERN : COLUMN_NAME_PATTERN;
  if (!pattern.test(name)) {
    throw new Error(
      `reporting reconciliation: refusing to build SQL from an unsafe ${kind} identifier: ${JSON.stringify(name)}.`
    );
  }
  return name;
}

async function computeSourceTotals(
  tx: Bun.SQL,
  tenantId: string,
  descriptor: ProjectionDescriptor
): Promise<Record<string, number>> {
  const totals: Record<string, number> = {};

  for (const stream of descriptor.rebuildSource.streams) {
    const tableName = assertSafeIdentifier(stream.tableName, "table");
    const tenantColumn = assertSafeIdentifier(
      stream.tenantColumn ?? "tenant_id",
      "column"
    );

    for (const rule of stream.metrics) {
      let rows: { total: string | number }[];
      if (rule.matchColumn === undefined) {
        rows = (await tx.unsafe(
          `SELECT COUNT(*) AS total FROM ${tableName} WHERE ${tenantColumn} = $1`,
          [tenantId]
        )) as { total: string | number }[];
      } else {
        const matchColumn = assertSafeIdentifier(rule.matchColumn, "column");
        rows = (await tx.unsafe(
          `SELECT COUNT(*) AS total FROM ${tableName} WHERE ${tenantColumn} = $1 AND ${matchColumn} = $2`,
          [tenantId, rule.matchValue]
        )) as { total: string | number }[];
      }

      totals[rule.metricKey] =
        (totals[rule.metricKey] ?? 0) + Number(rows[0]?.total ?? 0);
    }
  }

  return totals;
}

export async function reconcileProjection(
  tx: Bun.SQL,
  tenantId: string,
  descriptor: ProjectionDescriptor,
  requestedBy: string | null,
  correlationId?: string | null
): Promise<ReconciliationRunRow> {
  // Sequential, NOT `Promise.all` — both calls issue queries on the SAME
  // transaction/connection (`tx`), and a single Postgres connection
  // processes one query at a time; running them concurrently produced a
  // real hang in this repo (confirmed empirically while writing this
  // issue's own integration test — the hang left a stuck connection that
  // then broke every SUBSEQUENT test's `resetDatabase()` TRUNCATE too).
  const projectionTotals = await getProjectionMetrics(
    tx,
    tenantId,
    descriptor.key
  );
  const sourceTotals = await computeSourceTotals(tx, tenantId, descriptor);

  const metricKeys = new Set([
    ...Object.keys(projectionTotals),
    ...Object.keys(sourceTotals)
  ]);

  const details: ReconciliationMetricDetail[] = Array.from(metricKeys)
    .sort()
    .map((metricKey) => {
      const projectionTotal = projectionTotals[metricKey] ?? 0;
      const sourceTotal = sourceTotals[metricKey] ?? 0;
      return {
        metricKey,
        projectionTotal,
        sourceTotal,
        mismatch: projectionTotal !== sourceTotal
      };
    });

  const mismatch = details.some((detail) => detail.mismatch);

  return recordReconciliationRun(tx, tenantId, {
    projectionKey: descriptor.key,
    mismatch,
    details,
    requestedBy,
    correlationId
  });
}
