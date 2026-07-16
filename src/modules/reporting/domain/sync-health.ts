/**
 * Pure shaping logic for the sync health reporting view (Issue 9.1). Kept
 * free of I/O so it can be unit tested in isolation, same pattern as
 * `evaluateObjectRetry`/`evaluatePushEventConflict` in
 * `src/modules/sync-storage/domain/`.
 *
 * "Healthy" is defined narrowly and generically (no domain knowledge): at
 * least one sync node is active, there are no open conflicts, and there are
 * no failed object-sync-queue entries. A tenant with zero registered nodes
 * is not considered healthy — there is nothing actively syncing.
 */
export type SyncHealthCounts = {
  totalNodeCount: number;
  activeNodeCount: number;
  openConflictCount: number;
  pendingObjectCount: number;
  failedObjectCount: number;
};

export type SyncHealthView = SyncHealthCounts & {
  hasOpenConflicts: boolean;
  hasFailedObjects: boolean;
  isHealthy: boolean;
};

export function shapeSyncHealth(counts: SyncHealthCounts): SyncHealthView {
  const hasOpenConflicts = counts.openConflictCount > 0;
  const hasFailedObjects = counts.failedObjectCount > 0;
  const isHealthy =
    counts.activeNodeCount > 0 && !hasOpenConflicts && !hasFailedObjects;

  return {
    ...counts,
    hasOpenConflicts,
    hasFailedObjects,
    isHealthy
  };
}
