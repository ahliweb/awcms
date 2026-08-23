/**
 * Which e2e specs may run while the tenant is pristine, and which are allowed
 * to change it underneath everyone else.
 *
 * ## The failure this exists to prevent
 *
 * Every spec shares ONE seeded tenant. With `fullyParallel: true` a spec that
 * writes runs interleaved with specs that read, and the reader sees a tenant
 * that nobody described. Two real instances, both diagnosed the hard way:
 *
 * - `admin-roles.e2e.ts` creates a role. The "Assign" picker on `/admin/users`
 *   lists EVERY role in the tenant, so its default option was sometimes a role
 *   the owner did not hold — the assignment then legitimately succeeded and the
 *   spec expecting `409` failed with `200`. Nothing was broken; the expectation
 *   depended on state another file mutates.
 * - `admin-modules-toggle.e2e.ts` deliberately DISABLES `reporting`, and
 *   `/admin` authorizes on `reporting.dashboard.read`. Any read sweep
 *   overlapping that window sees the dashboard deny — correctly. That is what
 *   kept a working read-only sweep off `main`.
 *
 * The second one matters more than it looks. It is not only a flake: it is why
 * the two sweeps already shipped are **accidentally immune rather than
 * correct**. `admin-screens-render` asserted only `200`, and a denied screen
 * returns `200`; `admin-deny-path` expects denial, which a disabled module also
 * produces. Both would have stayed green while a module toggle broke a screen
 * for real. Neither could be tightened while a mutator might be running.
 *
 * ## Two waves, ordered by Playwright's own dependency graph
 *
 * `setup` → `read` → `write`. The read wave gets the tenant as the bootstrap
 * left it; the write wave runs afterwards and may do as it likes. Within each
 * wave everything is still parallel, so the cost is one barrier, not
 * serialization.
 *
 * Reads run FIRST rather than last on purpose. Running them last would depend
 * on every mutator reverting cleanly, which is true today (the module toggle is
 * self-reversing) but is an invariant nobody could enforce — a mutator that
 * fails halfway leaves residue by definition, and the reader would then be
 * asserting against the wreckage of a different failure.
 *
 * ## Why a list, and what stops the list from rotting
 *
 * A list is normally the wrong answer in this repo — a gate that checks its own
 * matrix rather than what exists is the recurring failure here. So this list is
 * held to what exists from both directions:
 *
 * 1. `tests/e2e-wave-classification.test.ts` requires every `*.e2e.ts` on disk
 *    to appear in exactly one wave. A new spec fails CI until its author
 *    decides which it is — the decision cannot be skipped, only made.
 * 2. Membership of the read wave is enforced at RUN TIME, not by trusting the
 *    label: read-wave specs import `test` from `./e2e-read-wave`, which fails
 *    any test that issues a mutating request to the app. A spec that quietly
 *    starts writing turns red in its own file rather than in somebody else's.
 *
 * (2) is the part that makes this more than bookkeeping. The classification
 * below is a claim; the fixture is what checks it.
 */

/**
 * Specs that only READ tenant state — they may log in, and they may seed their
 * own fixture rows directly through the database, but they must not drive the
 * app into changing anything.
 *
 * Direct fixture seeding is deliberately still allowed here: `seedRestrictedUser`
 * writes a role holding nothing, which no other spec's expectation depends on.
 * The rule these specs are held to is about mutations made THROUGH the app,
 * because those are the ones that change what another spec's screen renders.
 */
export const READ_WAVE: readonly string[] = [
  "admin-deny-path.e2e.ts",
  "admin-offices.e2e.ts",
  "admin-read-only-access.e2e.ts",
  "admin-screens-render.e2e.ts",
  "cwv-lab.e2e.ts",
  "login.e2e.ts",
  "not-found.e2e.ts"
];

/**
 * Specs that change tenant-wide state through the app.
 *
 * `admin-abac-policies.e2e.ts` is the sharpest of them — it authors a **deny**
 * policy and toggles it, and ABAC deny is evaluated for every request in the
 * tenant. `admin-modules-toggle.e2e.ts` and `admin-roles.e2e.ts` are the two
 * that have actually broken other specs. The `*-create` / `*-edit` pair only
 * append rows, which no reader here counts, but they belong to the same wave
 * because "appends only" is a property that quietly stops being true.
 */
export const WRITE_WAVE: readonly string[] = [
  "admin-abac-policies.e2e.ts",
  "admin-email-templates-create.e2e.ts",
  "admin-modules-toggle.e2e.ts",
  "admin-offices-create.e2e.ts",
  "admin-offices-edit.e2e.ts",
  "admin-profiles-create.e2e.ts",
  "admin-roles.e2e.ts",
  "admin-users.e2e.ts"
];

/** Glob form, for a Playwright project's `testMatch`. */
export function waveTestMatch(wave: readonly string[]): string[] {
  return wave.map((file) => `**/${file}`);
}
