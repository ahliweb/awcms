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

/**
 * How a DASHBOARD should render sync health — deliberately three states, where
 * `isHealthy` above is two.
 *
 * `isHealthy` is false for a tenant with zero registered nodes, and that is
 * correct for the report: nothing is syncing. But the admin dashboard was
 * rendering that same boolean as an amber "Needs attention" badge, so an
 * online-first deployment that never enrols an offline node (ADR-0035: sync is
 * the resilience mode, not the main path) sat at `0/0` showing a permanent
 * warning with no action behind it. A badge that is always lit is one operators
 * learn to ignore — including on the day it means something.
 *
 * `"not_configured"` is therefore NOT a degraded state; it is the steady state
 * of a tenant that does not use sync. A tenant that HAS enrolled nodes but has
 * none active is still `"needs_attention"` — that one is a real regression.
 *
 * Pure and separate from the view above so the distinction is unit-testable:
 * the same logic inline in `index.astro` frontmatter is unreachable by any test
 * (`tsc --noEmit` does not even read `.astro`).
 */
export type SyncHealthDisplayState =
  "healthy" | "not_configured" | "needs_attention";

export function classifySyncHealthDisplay(
  view: Pick<SyncHealthView, "totalNodeCount" | "isHealthy">
): SyncHealthDisplayState {
  if (view.isHealthy) return "healthy";
  // Checked AFTER `isHealthy` so a tenant with zero nodes but (impossibly)
  // healthy counts is never labelled unconfigured on a contradiction.
  if (view.totalNodeCount === 0) return "not_configured";
  return "needs_attention";
}
