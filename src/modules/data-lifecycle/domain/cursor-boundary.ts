/**
 * Shared cursor-boundary safety margin (ported from awcms-micro Issue #745,
 * ADR-0037). A `timestamptz` cursor value read back from Postgres as a JS
 * `Date` loses everything below 1 millisecond — `timestamptz` itself is
 * microsecond-resolution — so a plain `<=`/`>` comparison against a row's own
 * (truncated) stored value can spuriously evaluate false exactly at the
 * boundary row. Confirmed empirically (see `application/archive-purge-job.ts`'s
 * header comment "CONFIRMED BUG, FIXED"): a freshly-inserted row's own stored
 * value failed its own `<=` check after a plain `Date` round-trip.
 *
 * This constant/helper is the SINGLE shared source both
 * `application/archive-purge-job.ts`'s real archive/purge DELETE queries and
 * `application/dry-run-planner.ts`'s informational `archivedCount`/
 * `purgeableCount` SELECT must use — otherwise the dry-run's reported counts can
 * disagree with what the real purge pass actually deletes at exactly the
 * boundary row (the two files must never independently drift, one padded and one
 * not).
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
