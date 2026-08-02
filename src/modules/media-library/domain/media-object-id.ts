/**
 * Path-parameter validation for the media object routes.
 *
 * ## Why the id shape is load-bearing here, and not merely tidy
 *
 * `GET /api/v1/media/objects/list` (ADR-0056 §C) is a STATIC sibling of
 * `[id].ts`. Astro resolves static routes first, so `/objects/list` reaches the
 * list route — but that is a framework precedence rule, and on its own it makes
 * "the list" and "the object whose id is `list`" two readings of one path, with
 * only the framework deciding between them.
 *
 * Requiring a uuid closes it from the other side: there is no object `list`
 * could have addressed, so the precedence rule is not what keeps the two apart.
 * `tests/media-object-list-route.test.ts` asserts both halves.
 *
 * The secondary benefit is the ordinary one — a malformed id answers `400`
 * before the transaction opens, instead of `22P02 invalid input syntax for type
 * uuid` surfacing as a 500 the caller cannot act on.
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isMediaObjectId(value: string | undefined): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
