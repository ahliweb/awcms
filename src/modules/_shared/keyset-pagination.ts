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
 * via `keysetCursorCreatedAtSql()` (a canonical UTC ISO-8601 string with
 * microseconds), the cursor stores that string verbatim, and the WHERE clause
 * binds it back as `${cursor.createdAt}::timestamptz` — an exact,
 * index-friendly comparison on bare `(created_at, id)`.
 */

export type KeysetCursor = {
  /**
   * Full-precision `timestamptz` as text, e.g.
   * `"2026-07-17T10:00:00.029058+00:00"` — NOT a JS `Date` (which would lose
   * the microseconds). Produced by {@link keysetCursorCreatedAtSql} and bound
   * back with an explicit `::timestamptz` cast; see the module note above.
   */
  createdAt: string;
  id: string;
};

const CURSOR_SEPARATOR = "|";

/**
 * The `to_char(...)` format that renders a `timestamptz` as a canonical UTC
 * ISO-8601 string with MICROSECOND precision.
 *
 * Two details in this string are load-bearing and both are silent when wrong,
 * which is why nothing outside this module is allowed to write it by hand
 * (finding D13). `AT TIME ZONE 'UTC'` makes the value deterministic regardless
 * of the session `TimeZone`; `US` keeps all six fractional digits. Drop the
 * first and two deployments disagree about what an instant is; change `US` to
 * `MS` and Issue #158 comes back — a cursor built from a millisecond-truncated
 * instant denotes a moment strictly EARLIER than the row it came from, so
 * `(created_at, id) < (cursor)` skips every row sharing that millisecond. Past
 * page one only, which is where no test was looking: measured at the time, 105
 * rows returned 4 on page 2.
 *
 * There were twenty hand-inlined copies of this expression across the modules,
 * all byte-correct. That is not the same as safe: it is twenty places for the
 * twenty-first edit to get one character wrong, in a failure mode that reports
 * success.
 */
const UTC_MICROSECOND_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.US';

/**
 * Rejects anything that is not a bare identifier or `alias.identifier`.
 *
 * This function builds SQL text that its callers pass to `tx.unsafe`, so the
 * column reference is the one part of the expression that is not a literal.
 * Every call site in this repo passes a hard-coded string, and this assertion
 * is what keeps that true rather than merely currently true.
 */
const COLUMN_REFERENCE = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/;

function assertColumnReference(reference: string): string {
  if (!COLUMN_REFERENCE.test(reference)) {
    throw new Error(
      `Refusing to build SQL for "${reference}": expected a column name or alias.column.`
    );
  }

  return reference;
}

/**
 * SQL expression rendering `column` as full-precision UTC ISO-8601 TEXT.
 *
 * `offsetSuffix` picks how the zero offset is spelled. `+00:00` is what a
 * pagination cursor carries; `Z` is what the `idn_admin_regions` dataset DTO
 * has always emitted for its own timestamps. Both re-parse to the same instant
 * as `::timestamptz`, and `decodeKeysetCursor` accepts either, so the choice is
 * about matching what a surface already promised its readers — not a semantic
 * difference this module gets to unify away.
 */
export function utcMicrosecondTextSql(
  column: string,
  offsetSuffix: "+00:00" | "Z" = "+00:00"
): string {
  return `to_char(${assertColumnReference(column)} AT TIME ZONE 'UTC', '${UTC_MICROSECOND_FORMAT}"${offsetSuffix}"')`;
}

/**
 * SQL expression a paginated query must SELECT (aliased, conventionally
 * `AS created_at_cursor`) to obtain the full-precision text that
 * {@link encodeKeysetCursor} expects.
 *
 * Pass the table alias when the query joins (`keysetCursorCreatedAtSql("t")`
 * -> `t.created_at`). This used to be a CONSTANT whose own docblock told
 * callers to "wrap it in a table alias at the call site", which is not
 * something a string can be — so the joined queries wrote their own copy
 * instead, which is how there came to be twenty of them.
 */
export function keysetCursorCreatedAtSql(alias?: string): string {
  return utcMicrosecondTextSql(alias ? `${alias}.created_at` : "created_at");
}

/**
 * Encode a row's `(created_at, id)` into an opaque pagination cursor.
 *
 * `createdAtCursor` MUST be the full-precision text the row exposes for this
 * purpose (select {@link keysetCursorCreatedAtSql}), NOT
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
