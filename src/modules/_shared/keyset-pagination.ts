/**
 * Shared keyset (`(created_at, id) < (cursor)`) pagination helpers for
 * tenant-scoped, `created_at DESC`-ordered list endpoints (Issue #435
 * performance audit, skill `awcms-performance` §Pagination keyset).
 *
 * Every list endpoint here already has a bounded page size (50/100/200) —
 * this does not change that. What it adds is a way to page *past* the first
 * page: the cursor is opaque to the client (base64 of `createdAt|id`) and
 * only ever compared against `(created_at, id)` on the same table it came
 * from, never `OFFSET`. A malformed/forged cursor value is rejected with
 * `400 VALIDATION_ERROR` rather than silently ignored, since accepting junk
 * input silently is how cursor bugs go unnoticed.
 *
 * PRECISION — WHY `createdAt` IS TEXT, NOT A JS `Date` (Issue #158):
 * `timestamptz` stores MICROSECONDS; a JS `Date` holds only milliseconds,
 * and the driver floors the microseconds when it materialises a row's
 * `created_at` as a `Date` (`...:00.029058+00` arrives as `...:00.029Z`,
 * verified against PostgreSQL 18 — it truncates, not rounds). A cursor built
 * from that `Date` therefore denotes an instant strictly EARLIER than the row
 * it came from, so `(created_at, id) < (cursor)` skips every row that shares
 * that millisecond — including rows never yet shown, unreachable by any later
 * cursor. Measured: 105 rows → page 2 returned 4; a batch-insert sharing one
 * millisecond → page 2 returned 0.
 *
 * The fix (chosen over truncating both sides to milliseconds, which would put
 * an expression in `ORDER BY` and risk dropping the `(tenant_id, created_at
 * DESC)` index): carry the FULL microsecond precision through the cursor as
 * text and never route it through a JS `Date`. The SQL side exposes the value
 * via `KEYSET_CURSOR_CREATED_AT_SQL` (a canonical UTC ISO-8601 string with
 * microseconds), the cursor stores that string verbatim, and the WHERE clause
 * binds it back as `${cursor.createdAt}::timestamptz` — an exact,
 * index-friendly comparison on bare `(created_at, id)`.
 */

export type KeysetCursor = {
  /**
   * Full-precision `timestamptz` as text, e.g.
   * `"2026-07-17T10:00:00.029058+00:00"` — NOT a JS `Date` (which would lose
   * the microseconds). Produced by `KEYSET_CURSOR_CREATED_AT_SQL` and bound
   * back with an explicit `::timestamptz` cast; see the module note above.
   */
  createdAt: string;
  id: string;
};

const CURSOR_SEPARATOR = "|";

/**
 * SQL expression a paginated query must SELECT (aliased, conventionally
 * `AS created_at_cursor`) to obtain the full-precision text that
 * {@link encodeKeysetCursor} expects. `to_char(... AT TIME ZONE 'UTC', ...)`
 * renders the instant at UTC with 6 fractional digits (`US`) so the value is
 * deterministic regardless of the session `TimeZone`, and re-parsing it with
 * `::timestamptz` yields the exact same instant (round-trip verified against
 * PostgreSQL 18). `created_at` here refers to the row's own column; wrap it in
 * a table alias at the call site if the query joins (e.g. `t.created_at`).
 */
export const KEYSET_CURSOR_CREATED_AT_SQL =
  "to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"+00:00\"')";

/**
 * Encode a row's `(created_at, id)` into an opaque pagination cursor.
 *
 * `createdAtCursor` MUST be the full-precision text the row exposes for this
 * purpose (select {@link KEYSET_CURSOR_CREATED_AT_SQL}), NOT
 * `row.created_at.toISOString()` — a JS `Date` has already dropped the
 * microseconds and would resurrect the row-skipping bug (Issue #158).
 */
export function encodeKeysetCursor(
  createdAtCursor: string,
  id: string
): string {
  return Buffer.from(
    `${createdAtCursor}${CURSOR_SEPARATOR}${id}`,
    "utf-8"
  ).toString("base64url");
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Accepts an ISO-8601 timestamp with an optional fractional part of 1–6
 * digits and either a `Z` or `±HH:MM` offset. Deliberately lenient about the
 * fractional width so both the microsecond cursors this module now emits
 * (`.029058+00:00`) and any millisecond cursor minted by an older build
 * (`.029Z`) decode and re-bind cleanly as `::timestamptz`.
 */
const TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Decode and validate a client-supplied cursor. Returns `null` for a
 * malformed value (not a validly-shaped ISO timestamp + UUID pair) so the
 * caller can respond `400 VALIDATION_ERROR` — a corrupt cursor must never be
 * treated as "no cursor" (that would silently show page 1 instead of
 * signalling the error to the caller).
 *
 * `createdAt` is returned as the verbatim text (never a `Date`) so the
 * microsecond precision survives all the way to the SQL `::timestamptz` bind.
 */
export function decodeKeysetCursor(cursor: string): KeysetCursor | null {
  let decoded: string;

  try {
    decoded = Buffer.from(cursor, "base64url").toString("utf-8");
  } catch {
    return null;
  }

  const separatorIndex = decoded.indexOf(CURSOR_SEPARATOR);

  if (separatorIndex === -1) {
    return null;
  }

  const createdAt = decoded.slice(0, separatorIndex);
  const id = decoded.slice(separatorIndex + 1);

  if (!TIMESTAMP_PATTERN.test(createdAt) || !UUID_PATTERN.test(id)) {
    return null;
  }

  // Shape is valid; reject an out-of-range date (e.g. month 13) that the
  // regex admits but `::timestamptz` would throw on — a 500 the caller
  // cannot act on. `Date` is used ONLY for this validity probe, never for the
  // value we return.
  if (Number.isNaN(new Date(createdAt).getTime())) {
    return null;
  }

  return { createdAt, id };
}
