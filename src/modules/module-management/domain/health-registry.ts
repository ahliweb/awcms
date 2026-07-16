/**
 * Pure aggregation logic for module health/readiness. No I/O here — the
 * application layer (`application/health-registry.ts`) computes each
 * individual readiness signal (querying the DB registry, reading migration
 * files, calling the permission-sync/settings/job-registry services) and
 * hands the resulting list to `classifyHealthStatus`.
 */

export type ReadinessSignalStatus = "pass" | "fail" | "not_applicable";

export type ReadinessSignal = {
  name: string;
  status: ReadinessSignalStatus;
  /** Safe, generic text only — never a raw error message, stack trace, or
   * env/secret value. See `application/health-registry.ts` for how each
   * signal builds this. */
  detail?: string;
};

export type HealthStatus = "healthy" | "degraded" | "failed" | "unknown";

/**
 * `not_applicable` signals never affect the verdict (e.g. "queue backlog"
 * for a module with no queue). `unknown` only when every signal is
 * `not_applicable` (nothing was actually checkable) — this should not
 * happen in practice since `descriptor_registered` always applies, but is
 * the safe fallback rather than defaulting to `healthy` on no evidence.
 * `healthy` requires every applicable signal to pass; `failed` when every
 * applicable signal fails; anything in between is `degraded`.
 */
export function classifyHealthStatus(
  signals: readonly ReadinessSignal[]
): HealthStatus {
  const applicable = signals.filter(
    (signal) => signal.status !== "not_applicable"
  );

  if (applicable.length === 0) {
    return "unknown";
  }

  const failCount = applicable.filter(
    (signal) => signal.status === "fail"
  ).length;

  if (failCount === 0) {
    return "healthy";
  }

  if (failCount === applicable.length) {
    return "failed";
  }

  return "degraded";
}
