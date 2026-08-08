export type SyncConflictType = "version_mismatch" | "missing_base_version";

export type SyncConflictEvaluation =
  { conflict: false } | { conflict: true; conflictType: SyncConflictType };

/**
 * Optimistic-concurrency conflict check for a pushed event against an
 * aggregate's known version. Generic (no domain knowledge of what the
 * aggregate represents) — applies to any domain module's aggregates.
 */
export function evaluatePushEventConflict(
  currentVersion: number,
  baseVersion: number | undefined
): SyncConflictEvaluation {
  if (currentVersion > 0 && baseVersion === undefined) {
    return { conflict: true, conflictType: "missing_base_version" };
  }

  if (baseVersion !== undefined && baseVersion !== currentVersion) {
    return { conflict: true, conflictType: "version_mismatch" };
  }

  return { conflict: false };
}
