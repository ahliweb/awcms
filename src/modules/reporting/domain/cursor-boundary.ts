/**
 * Shared cursor-boundary safety margin (Issue #753). Deliberately
 * DUPLICATED (not imported) from `data-lifecycle/domain/cursor-boundary.ts`
 * — that file documents the exact same root cause this module's own
 * cursor-ordered bounded scans (`application/projection-incremental-
 * worker.ts`, `application/projection-rebuild.ts`) are equally exposed to:
 * a `timestamptz` cursor value read back from Postgres as a JS `Date`
 * loses everything below 1 millisecond, so a plain `<=`/`>` comparison
 * against a row's own (truncated) stored value can spuriously evaluate
 * false exactly at the boundary row. `reporting`'s `module.ts` does not
 * declare a `dependencies` edge on `data_lifecycle` (no other file in this
 * module needs it), so importing one 10-line pure helper across that
 * boundary would introduce a real module-lifecycle-ordering coupling for a
 * disproportionately small amount of shared code — duplicating it here
 * (same value, same semantics) avoids that coupling entirely. If this
 * constant/helper ever needs a THIRD independent copy, that is the signal
 * to promote it to `src/lib/` instead of duplicating again.
 */
export const CURSOR_BOUNDARY_SAFETY_MARGIN_MS = 1;

/**
 * Pads a cursor boundary value by `CURSOR_BOUNDARY_SAFETY_MARGIN_MS` so a
 * comparison against it is guaranteed to include (not exclude) the row that
 * produced it, regardless of which direction the comparison faces (an
 * upper-bound `<=`/`<` or a lower-bound `>`/`>=`) — both directions need the
 * SAME upward pad because the true underlying value is always >= the
 * JS-`Date`-truncated one that was actually stored/read.
 */
export function applyCursorBoundarySafetyMargin(value: Date): Date {
  return new Date(value.getTime() + CURSOR_BOUNDARY_SAFETY_MARGIN_MS);
}
