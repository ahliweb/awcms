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

/**
 * SQL expression that binds JS `Date` parameter `$n` for comparison against the
 * descriptor's cursor column (Issue #1276).
 *
 * - `timestamptz` (default): `$n::timestamptz`. The explicit cast keeps the
 *   comparison independent of how the driver types the parameter.
 * - `date`: the UTC calendar date of the instant,
 *   `($n::timestamptz AT TIME ZONE 'UTC')::date`. A bare `$n::timestamptz`
 *   compared to a `date` column converts the DATE using the SESSION TimeZone, so
 *   the retention boundary would move with the database setting and the cutoff
 *   day itself would become eligible. The explicit UTC date is session-
 *   independent, and `day < cutoffDay` keeps a whole day until it is strictly
 *   older than the cutoff day.
 */
export function cursorBoundSql(
  cursorColumnType: "timestamptz" | "date" | undefined,
  n: number
): string {
  return cursorColumnType === "date"
    ? `(($${n}::timestamptz) AT TIME ZONE 'UTC')::date`
    : `$${n}::timestamptz`;
}
