import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { MEDIA_PERMISSION_ACTIVITY_CODE } from "../../../../../modules/media-library/domain/media-permissions";
import { mediaLibraryPortAdapter } from "../../../../../modules/media-library/application/media-library-port-adapter";

/**
 * `GET /api/v1/media/objects?ids=<uuid>,<uuid>` — batch-resolve media object ids
 * to their public reference (URL + alt text + intrinsic metadata).
 *
 * ## Why this endpoint had to exist
 *
 * `awcms_blog_posts` carries `featured_media_id` and `seo_image_media_id`, but
 * `media_library` exposed no read surface at all — only upload sessions and the
 * enforcement flag. So an external consumer could see that a post HAS an image
 * and had no way to learn its URL. `awcms-astro`'s `article-images.ts` returns
 * `src: undefined` for exactly this reason, and every article it publishes goes
 * out without its image while nothing anywhere fails.
 *
 * The resolution logic itself is NOT new: `MediaLibraryPort.resolveMediaReferences`
 * has always done this for in-process consumers. This is the same call, reached
 * over HTTP, with the same safety rule — only `verified`/`attached`, same-tenant,
 * non-deleted objects resolve.
 *
 * ## Batch, not one-per-id
 *
 * A build feed resolves every image on a page at once. One request per id would
 * turn a 200-post site into a thousand round trips, and the port is already
 * batch-shaped (`id = ANY(...)`, one query).
 *
 * ## Unresolved ids are REPORTED, not dropped
 *
 * An id that is unknown, cross-tenant, soft-deleted, or not yet verified comes
 * back in `unresolved`. Returning only what resolved would make "this post has
 * no image" and "this post's image is broken" the same response — the exact
 * ambiguity that let the missing-images gap sit unnoticed. It leaks nothing: the
 * caller supplied the ids, and every failure reason collapses into one bucket.
 *
 * Gated on `media_library.media.read`, a permission declared and seeded since
 * `sql/052` while waiting for its surface (ADR-0026 step 5d). Read-only, so a
 * machine credential (ADR-0049) may hold it.
 */
const MAX_IDS = 100;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: {
    moduleKey: "media_library",
    activityCode: MEDIA_PERMISSION_ACTIVITY_CODE,
    action: "read"
  },
  handler: async ({ tx, tenantId, url }) => {
    const idsParam = url.searchParams.get("ids");

    if (!idsParam) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "ids is required — a comma-separated list of media object uuids."
      );
    }

    const ids = idsParam
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    if (ids.length === 0) {
      return fail(400, "VALIDATION_ERROR", "ids must contain at least one id.");
    }

    if (ids.length > MAX_IDS) {
      return fail(
        400,
        "VALIDATION_ERROR",
        `ids accepts at most ${MAX_IDS} values per request.`
      );
    }

    // A malformed id is refused rather than reported as merely "unresolved":
    // "you sent junk" and "that object is not referenceable" are different
    // facts, and collapsing them hides a caller-side bug behind a normal-looking
    // response.
    const malformed = ids.filter((id) => !UUID_PATTERN.test(id));

    if (malformed.length > 0) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "ids must all be uuids.",
        {},
        { malformed }
      );
    }

    const unique = [...new Set(ids)];
    const resolved = await mediaLibraryPortAdapter.resolveMediaReferences(
      tx,
      tenantId,
      unique
    );

    return ok({
      items: unique
        .filter((id) => resolved.has(id))
        .map((id) => ({ id, ...resolved.get(id)! })),
      unresolved: unique.filter((id) => !resolved.has(id))
    });
  }
});
