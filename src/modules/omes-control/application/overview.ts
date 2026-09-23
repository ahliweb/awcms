/**
 * `GET /api/v1/omes/overview` read model, Issue ahliweb/omes#198.
 *
 * A pure aggregation computed directly from the `omes_control` tables at
 * request time (small `GROUP BY` scans, each already covered by the
 * `(tenant_id, ...)` indexes `sql/154` created) — NOT sourced from the
 * `reporting` module's projection facilities. Per the issue's validated
 * reuse requirement: "OMES projections may contribute descriptors; the OMES
 * domain must not treat reporting as an authority for host/runtime state" —
 * desired/observed OMES state stays sourced from these tables directly.
 */
import { isHeartbeatStale } from "../domain/staleness";

export type OmesOverview = {
  generatedAt: string;
  serverCount: number;
  /** Counts by `awcms_omes_servers.status` (fleet inventory lifecycle state). */
  serverStatusCounts: Record<string, number>;
  /** Counts by the LATEST health snapshot's `overall_status`, one per server. */
  serverHealthDistribution: Record<string, number>;
  staleServerCount: number;
  jobStateCounts: Record<string, number>;
  backupFreshness: { fresh: number; stale: number; failed: number };
  driftSummary: {
    reconciliationStatusCounts: Record<string, number>;
    staleDeploymentCount: number;
  };
};

const BACKUP_FRESHNESS_THRESHOLD_MS = 24 * 60 * 60 * 1000;
const STALE_RECONCILIATION_THRESHOLD_MS = 30 * 60 * 1000;

function toCountMap(
  rows: { key: string; count: string | number }[]
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const row of rows) {
    result[row.key] = Number(row.count);
  }
  return result;
}

export async function computeOmesOverview(
  tx: Bun.SQL,
  tenantId: string,
  now: Date
): Promise<OmesOverview> {
  const serverStatusRows = (await tx`
    SELECT status AS key, count(*) AS count
    FROM awcms_omes_servers
    WHERE tenant_id = ${tenantId}
    GROUP BY status
  `) as { key: string; count: string }[];

  const heartbeatRows = (await tx`
    SELECT last_heartbeat_at FROM awcms_omes_servers WHERE tenant_id = ${tenantId}
  `) as { last_heartbeat_at: Date | null }[];

  const serverCount = heartbeatRows.length;
  const staleServerCount = heartbeatRows.filter((row) =>
    isHeartbeatStale(row.last_heartbeat_at, now)
  ).length;

  const healthRows = (await tx`
    SELECT DISTINCT ON (server_id) overall_status
    FROM awcms_omes_health_snapshots
    WHERE tenant_id = ${tenantId}
    ORDER BY server_id, captured_at DESC, id DESC
  `) as { overall_status: string }[];
  const serverHealthDistribution: Record<string, number> = {};
  for (const row of healthRows) {
    serverHealthDistribution[row.overall_status] =
      (serverHealthDistribution[row.overall_status] ?? 0) + 1;
  }

  const jobStateRows = (await tx`
    SELECT state AS key, count(*) AS count
    FROM awcms_omes_jobs
    WHERE tenant_id = ${tenantId}
    GROUP BY state
  `) as { key: string; count: string }[];

  const backupRows = (await tx`
    SELECT status, captured_at FROM awcms_omes_backup_snapshots
    WHERE tenant_id = ${tenantId}
  `) as { status: string; captured_at: Date }[];

  const backupFreshness = { fresh: 0, stale: 0, failed: 0 };
  for (const row of backupRows) {
    if (row.status === "failed") {
      backupFreshness.failed += 1;
    } else if (
      now.getTime() - row.captured_at.getTime() <=
      BACKUP_FRESHNESS_THRESHOLD_MS
    ) {
      backupFreshness.fresh += 1;
    } else {
      backupFreshness.stale += 1;
    }
  }

  const reconciliationRows = (await tx`
    SELECT reconciliation_status AS key, count(*) AS count
    FROM awcms_omes_deployments
    WHERE tenant_id = ${tenantId}
    GROUP BY reconciliation_status
  `) as { key: string; count: string }[];

  const deploymentAgeRows = (await tx`
    SELECT reconciliation_status, last_reconciled_at
    FROM awcms_omes_deployments
    WHERE tenant_id = ${tenantId}
  `) as { reconciliation_status: string; last_reconciled_at: Date | null }[];

  const staleDeploymentCount = deploymentAgeRows.filter((row) => {
    if (
      row.reconciliation_status === "failed" ||
      row.reconciliation_status === "drifted"
    ) {
      return true;
    }
    if (!row.last_reconciled_at) {
      return true;
    }
    return (
      now.getTime() - row.last_reconciled_at.getTime() >
      STALE_RECONCILIATION_THRESHOLD_MS
    );
  }).length;

  return {
    generatedAt: now.toISOString(),
    serverCount,
    serverStatusCounts: toCountMap(serverStatusRows),
    serverHealthDistribution,
    staleServerCount,
    jobStateCounts: toCountMap(jobStateRows),
    backupFreshness,
    driftSummary: {
      reconciliationStatusCounts: toCountMap(reconciliationRows),
      staleDeploymentCount
    }
  };
}
