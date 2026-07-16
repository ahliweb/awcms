import { shapeSyncHealth, type SyncHealthView } from "../domain/sync-health";

export type SyncHealthReport = SyncHealthView & {
  mostRecentPushedAt: string | null;
  mostRecentPulledAt: string | null;
};

/**
 * Sync health summary (Issue 9.1, `GET /reports/sync-health`). Live
 * read-aggregation over `awcms_sync_nodes` (migration 007),
 * `awcms_sync_conflicts` (migration 008), and
 * `awcms_object_sync_queue` (migration 009) — no new tables.
 *
 * Every `COUNT(*)`/bigint column from Postgres comes back from Bun.SQL as a
 * **string** — this is the same lesson recorded during Issue 6.2/6.3
 * (`src/pages/api/v1/sync/objects/status.ts`); every count below is wrapped
 * with `Number(...)` explicitly, never `as number`.
 */
export async function fetchSyncHealthReport(
  tx: Bun.SQL,
  tenantId: string
): Promise<SyncHealthReport> {
  const nodeRows = await tx`
    SELECT
      COUNT(*) AS total_node_count,
      COUNT(*) FILTER (WHERE status = 'active') AS active_node_count,
      MAX(last_pushed_at) AS most_recent_pushed_at,
      MAX(last_pulled_at) AS most_recent_pulled_at
    FROM awcms_sync_nodes
    WHERE tenant_id = ${tenantId}
  `;

  const conflictRows = await tx`
    SELECT COUNT(*) AS open_conflict_count
    FROM awcms_sync_conflicts
    WHERE tenant_id = ${tenantId} AND status = 'open'
  `;

  const objectRows = await tx`
    SELECT
      COUNT(*) FILTER (WHERE status = 'pending') AS pending_object_count,
      COUNT(*) FILTER (WHERE status = 'failed') AS failed_object_count
    FROM awcms_object_sync_queue
    WHERE tenant_id = ${tenantId}
  `;

  const nodeRow = nodeRows[0] as
    | {
        total_node_count: string;
        active_node_count: string;
        most_recent_pushed_at: Date | null;
        most_recent_pulled_at: Date | null;
      }
    | undefined;

  const shaped = shapeSyncHealth({
    totalNodeCount: Number(nodeRow?.total_node_count ?? 0),
    activeNodeCount: Number(nodeRow?.active_node_count ?? 0),
    openConflictCount: Number(conflictRows[0]?.open_conflict_count ?? 0),
    pendingObjectCount: Number(objectRows[0]?.pending_object_count ?? 0),
    failedObjectCount: Number(objectRows[0]?.failed_object_count ?? 0)
  });

  return {
    ...shaped,
    mostRecentPushedAt: nodeRow?.most_recent_pushed_at?.toISOString() ?? null,
    mostRecentPulledAt: nodeRow?.most_recent_pulled_at?.toISOString() ?? null
  };
}
