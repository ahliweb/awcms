/**
 * The kill switch for scope-qualified evaluation (ADR-0080, Gelombang 3 PR 3.4
 * of #423).
 *
 * ## Why a build-time constant and not an env var
 *
 * Two instances of one deployment reading the same env var can still disagree —
 * a rolling restart, a stale container, a forgotten `--env-file` — and an
 * authorization rule that is on for one pod and off for another is a rule whose
 * answer depends on which socket a request landed on. The policy cache is
 * already per-process for exactly this reason (ADR-0058), so the switch has to
 * live where a process cannot pick it up late: in the build.
 *
 * Flipping it therefore means a code change and a redeploy. That is the point.
 * It is not an operational dial; it is a rollback that leaves a commit behind.
 *
 * ## What OFF means
 *
 * OFF is TODAY, exactly: scoped grants mint no facts, and no fact carries
 * `permissionKeys`, so the coverage predicate is the one that shipped in #180.
 * That equivalence is what makes the rollback safe to reason about — and it is
 * only cheap while nothing has WRITTEN a non-tenant-wide grant, because once one
 * exists, turning the switch off stops narrowing a grant that was created narrow.
 * The admin surface that writes scoped grants is deliberately a LATER PR for
 * that reason.
 *
 * ## What ON means
 *
 * ON cannot widen. A scoped grant contributes a fact that covers only its own
 * scope, carrying only the permission keys its role confers; the clause added to
 * the coverage predicate can turn a `true` into a `false` and has no branch that
 * produces `true`. And the RBAC gate is untouched — `fetchGrantedPermissionKeys`
 * decides whether the subject holds the permission AT ALL, before any of this
 * runs, so a scoped grant can never make a permission appear.
 */

/**
 * Whether scope-qualified evaluation is compiled in.
 *
 * `true` since ADR-0080. Set to `false` and redeploy to roll back to the #180
 * coverage semantics; `tests/scope-narrowing.test.ts` asserts both directions so
 * the flipped state is not an untested one.
 */
export const SCOPE_NARROWING_ENABLED = true;
