/**
 * Path-parameter shape guard for this module's uuid ids. Bun.SQL sends a
 * non-uuid string straight to Postgres (`22P02`), which inside a route would
 * surface as a 500 for what is a client error.
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isWhatsappRecordId(value: string | undefined): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
