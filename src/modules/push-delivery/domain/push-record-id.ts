/**
 * Path-parameter shape guard for this module's row ids (Issue #466).
 *
 * Every id in `awcms_push_*` is a `uuid` column, and Bun.SQL sends a
 * non-uuid string straight to Postgres, which answers `22P02 invalid input
 * syntax for type uuid`. Inside `withTenant` that surfaces as a thrown error
 * and therefore a 500 — a malformed path segment reported as a server fault,
 * with a stack trace where a 400 belongs.
 *
 * Local to this module rather than shared, following `isMediaObjectId`: the
 * question is "is this MY id" and the answer is allowed to get stricter here
 * without renegotiating with every other module.
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPushRecordId(value: string | undefined): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
