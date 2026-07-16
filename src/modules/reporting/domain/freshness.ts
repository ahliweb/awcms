import type { ProjectionFreshnessPolicy } from "../../_shared/module-contract";

/**
 * Pure freshness/staleness state machine (Issue #753). Kept free of I/O so
 * it can be unit tested in isolation, same pattern as
 * `reporting/domain/sync-health.ts`'s `shapeSyncHealth`.
 *
 * CRITICAL DESIGN RULE (Issue #753 scope: "Freshness/staleness signals must
 * reflect REALITY, not just 'job ran' — if a projection-update job silently
 * fails/skips a tenant, the freshness signal must reflect that (stale), not
 * falsely report fresh"): status is ALWAYS computed live from raw
 * persisted facts (`lastSuccessAt`/`consecutiveFailures`) compared against
 * `now`, NEVER read back from a previously-written enum column. This is
 * deliberate — if the worker script that is supposed to keep a projection
 * fresh stops running entirely (crashed, cron misconfigured, deployment
 * broken), NO write ever happens again for that (tenant, projection), so a
 * cached/stored status column would freeze at whatever it last said
 * (typically `"current"`) forever. Because `computeProjectionFreshness` is
 * a pure function of "time since `lastSuccessAt`" evaluated fresh on every
 * read, the SAME silence that would fool a cached column instead naturally
 * ages the reported status from `"current"` -> `"delayed"` -> `"stale"` as
 * real time passes, with zero additional write required — the read path
 * itself is the safety net.
 */
export type ProjectionFreshnessStatus =
  "current" | "delayed" | "stale" | "rebuilding" | "failed";

export type ProjectionFreshnessFacts = {
  lastSuccessAt: Date | null;
  lastAttemptAt: Date | null;
  consecutiveFailures: number;
  lastErrorMessage: string | null;
  /** `true` when `awcms_reporting_rebuild_runs` currently has a `status = 'running'` row for this (tenant, projection) — see `application/projection-rebuild.ts`. */
  rebuildInProgress: boolean;
};

export type ProjectionFreshnessView = ProjectionFreshnessFacts & {
  status: ProjectionFreshnessStatus;
  /** `null` when the projection has never completed a successful update (age is unbounded/undefined — reported as `"stale"`, never `"current"`/`"delayed"`, see below). */
  ageSeconds: number | null;
};

/**
 * `rebuildInProgress` takes priority over every other signal (a rebuild
 * mid-flight is expected to leave the read model transiently behind, not a
 * failure). A projection that has NEVER completed a successful update
 * (`lastSuccessAt === null`) is always `"stale"` regardless of
 * `consecutiveFailures` — there is no age to measure yet, and "never
 * produced a value" is strictly worse than "produced a value that is now
 * old", so it must never report `"current"`/`"delayed"` by default.
 */
export function computeProjectionFreshness(
  facts: ProjectionFreshnessFacts,
  policy: ProjectionFreshnessPolicy,
  now: Date
): ProjectionFreshnessView {
  if (facts.rebuildInProgress) {
    return { ...facts, status: "rebuilding", ageSeconds: null };
  }

  if (facts.lastSuccessAt === null) {
    return { ...facts, status: "stale", ageSeconds: null };
  }

  const ageSeconds = Math.max(
    0,
    (now.getTime() - facts.lastSuccessAt.getTime()) / 1000
  );

  if (facts.consecutiveFailures >= policy.errorAfterConsecutiveFailures) {
    return { ...facts, status: "failed", ageSeconds };
  }

  if (ageSeconds >= policy.staleAfterSeconds) {
    return { ...facts, status: "stale", ageSeconds };
  }

  if (ageSeconds >= policy.targetSeconds) {
    return { ...facts, status: "delayed", ageSeconds };
  }

  return { ...facts, status: "current", ageSeconds };
}
