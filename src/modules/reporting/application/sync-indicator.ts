/**
 * Lightweight "is sync healthy" check for the admin shell topbar
 * `<SyncIndicator />` (Issue 8.1 stub wired to real data in Issue 9.1).
 *
 * Deliberately a *single* query using `EXISTS`, not a reuse of
 * `fetchSyncHealthReport`'s full COUNT/MAX aggregation — `AdminLayout.astro`
 * renders on every `/admin/*` request, so it needs the cheapest possible
 * check rather than repeating the heavier per-table aggregation the
 * `GET /reports/sync-health` endpoint and the dashboard card already do.
 * The health formula intentionally mirrors
 * `domain/sync-health.ts`'s `isHealthy`: at least one active node, no open
 * conflicts, no failed object-sync-queue entries.
 */
export async function fetchSyncIndicatorActive(
  tx: Bun.SQL,
  tenantId: string
): Promise<boolean> {
  const rows = await tx`
    SELECT
      EXISTS (
        SELECT 1 FROM awcms_sync_nodes
        WHERE tenant_id = ${tenantId} AND status = 'active'
      ) AS has_active_node,
      EXISTS (
        SELECT 1 FROM awcms_sync_conflicts
        WHERE tenant_id = ${tenantId} AND status = 'open'
      ) AS has_open_conflict,
      EXISTS (
        SELECT 1 FROM awcms_object_sync_queue
        WHERE tenant_id = ${tenantId} AND status = 'failed'
      ) AS has_failed_object
  `;

  const row = rows[0] as
    | {
        has_active_node: boolean;
        has_open_conflict: boolean;
        has_failed_object: boolean;
      }
    | undefined;

  if (!row) {
    return false;
  }

  return (
    row.has_active_node && !row.has_open_conflict && !row.has_failed_object
  );
}
