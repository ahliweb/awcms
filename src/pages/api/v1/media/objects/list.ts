import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { decodeKeysetCursor } from "../../../../../modules/_shared/keyset-pagination";
import { MEDIA_PERMISSION_ACTIVITY_CODE } from "../../../../../modules/media-library/domain/media-permissions";
import {
  listMediaObjects,
  MEDIA_OBJECT_LIST_LIMIT,
  type ListMediaObjectsFilter,
  type MediaObjectDeletionFilter,
  type NewsMediaObjectStatus
} from "../../../../../modules/media-library/application/media-object-directory";

/**
 * `GET /api/v1/media/objects/list` (ADR-0056 §C) — browse this tenant's media
 * registry, keyset-paginated, newest first.
 *
 * ## Why a separate route from `GET /api/v1/media/objects`
 *
 * That endpoint demands `?ids=`. It is a batch RESOLVER built for the
 * `awcms-astro` build to swap ids for public URLs, and it answers only for
 * objects safe to reference publicly. Adding a "no `ids` means list everything"
 * branch to it would change what a request that is a **400 today** means, into
 * a dump of the entire registry — a contract change wearing the clothes of an
 * addition, and one no existing caller could opt out of.
 *
 * ## `/list` is unambiguous because ids are uuids
 *
 * This file is a STATIC sibling of `[id].ts`, and Astro resolves static routes
 * before dynamic ones. The two can never contend: `list` is not a uuid, and
 * `[id].ts` and its children reject a non-uuid id with `400` before touching
 * the database, so there is no object this path could otherwise have addressed.
 * `tests/media-object-list-route.test.ts` pins both halves.
 *
 * ## What this returns that the resolver will not
 *
 * Rows in ANY status — `pending_upload`, `failed`, `orphaned` — and, on
 * request, soft-deleted ones. That inverts
 * `isNewsMediaObjectSafeForPublicReference` on purpose: an administrator opens
 * this list precisely because of the objects that are NOT healthy, and the
 * lifecycle endpoints (§B) need a way to find their targets. `media.read`
 * keeps it inside the tenant; nothing here may be used as a public reference.
 *
 * The projection is deliberately narrower than the row: `bucket_name` and
 * `storage_driver` are deployment facts a browse screen has no use for, and
 * `owner_resource_type`/`owner_resource_id` are vestigial since ADR-0036 moved
 * attachment to the consumer's FK — shipping them would invite a screen to
 * present them as current.
 *
 * Read-only, so a machine credential (ADR-0049) may hold the permission.
 */
const VALID_STATUSES: readonly NewsMediaObjectStatus[] = [
  "pending_upload",
  "uploaded",
  "verified",
  "attached",
  "orphaned",
  "deleted",
  "failed"
];

const VALID_DELETION_FILTERS: readonly MediaObjectDeletionFilter[] = [
  "live",
  "deleted",
  "all"
];

type Prepared = {
  filter: ListMediaObjectsFilter;
  cursor: ReturnType<typeof decodeKeysetCursor>;
};

export const GET = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: ({ url }) => {
    const status = url.searchParams.get("status");
    const mimeType = url.searchParams.get("mimeType");
    const deletion = url.searchParams.get("deletion");
    const cursorParam = url.searchParams.get("cursor");

    // An unknown filter value is REFUSED, never ignored. Silently dropping it
    // answers 200 with a page the caller did not ask for, and a screen filtered
    // on a typo would look like an empty registry.
    if (status !== null && !VALID_STATUSES.includes(status as never)) {
      return fail(
        400,
        "VALIDATION_ERROR",
        `status must be one of: ${VALID_STATUSES.join(", ")}.`
      );
    }

    if (
      deletion !== null &&
      !VALID_DELETION_FILTERS.includes(deletion as never)
    ) {
      return fail(
        400,
        "VALIDATION_ERROR",
        `deletion must be one of: ${VALID_DELETION_FILTERS.join(", ")}.`
      );
    }

    let cursor: ReturnType<typeof decodeKeysetCursor>;

    if (cursorParam === null) {
      cursor = null;
    } else {
      cursor = decodeKeysetCursor(cursorParam);

      // A corrupt cursor must not be treated as "no cursor": that quietly
      // serves page 1 to a caller who asked for page 4, and the loop never
      // terminates.
      if (!cursor) {
        return fail(400, "VALIDATION_ERROR", "cursor is malformed.");
      }
    }

    return {
      filter: {
        status: (status as NewsMediaObjectStatus | null) ?? undefined,
        // Stored lowercased by `createPendingNewsMediaObject`, so the filter
        // matches it rather than requiring the caller to know that.
        mimeType: mimeType?.trim().toLowerCase() || undefined,
        deletion: (deletion as MediaObjectDeletionFilter | null) ?? undefined
      },
      cursor
    };
  },
  authorize: {
    moduleKey: "media_library",
    activityCode: MEDIA_PERMISSION_ACTIVITY_CODE,
    action: "read"
  },
  handler: async ({ tx, tenantId, prepared }) => {
    const { items, nextCursor } = await listMediaObjects(
      tx,
      tenantId,
      prepared.filter,
      prepared.cursor ?? undefined
    );

    return ok({
      items: items.map((item) => ({
        id: item.id,
        objectKey: item.objectKey,
        publicUrl: item.publicUrl,
        originalFilename: item.originalFilename,
        mimeType: item.mimeType,
        sizeBytes: item.sizeBytes,
        checksumSha256: item.checksumSha256,
        width: item.width,
        height: item.height,
        altText: item.altText,
        caption: item.caption,
        status: item.status,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        deletedAt: item.deletedAt,
        deleteReason: item.deleteReason,
        restoredAt: item.restoredAt
      })),
      nextCursor,
      pageSize: MEDIA_OBJECT_LIST_LIMIT
    });
  }
});
