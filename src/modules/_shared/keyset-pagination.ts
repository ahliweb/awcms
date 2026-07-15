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
 */

export type KeysetCursor = {
  createdAt: Date;
  id: string;
};

const CURSOR_SEPARATOR = "|";

/** Encode a row's `(created_at, id)` into an opaque pagination cursor. */
export function encodeKeysetCursor(createdAt: Date, id: string): string {
  return Buffer.from(
    `${createdAt.toISOString()}${CURSOR_SEPARATOR}${id}`,
    "utf-8"
  ).toString("base64url");
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Decode and validate a client-supplied cursor. Returns `null` for a
 * malformed value (not a validly-shaped ISO timestamp + UUID pair) so the
 * caller can respond `400 VALIDATION_ERROR` — a corrupt cursor must never be
 * treated as "no cursor" (that would silently show page 1 instead of
 * signalling the error to the caller).
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

  const createdAtRaw = decoded.slice(0, separatorIndex);
  const id = decoded.slice(separatorIndex + 1);
  const createdAt = new Date(createdAtRaw);

  if (Number.isNaN(createdAt.getTime()) || !UUID_PATTERN.test(id)) {
    return null;
  }

  return { createdAt, id };
}
