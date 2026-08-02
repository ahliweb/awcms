import {
  fail,
  jsonResponse,
  ok
} from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../../../modules/_shared/idempotency";
import { MEDIA_PERMISSION_ACTIVITY_CODE } from "../../../../../../modules/media-library/domain/media-permissions";
import { purgeNewsMediaObject } from "../../../../../../modules/media-library/application/media-object-directory";
import { log } from "../../../../../../lib/logging/logger";

/**
 * `POST /api/v1/media/objects/{id}/purge` (ADR-0056 §B) — hard-delete the
 * registry row of an already soft-deleted media object.
 *
 * ## `purge` clears the REGISTRY, not the R2 bytes
 *
 * This is the decision ADR-0056 §B states explicitly, and it is not an
 * oversight to be fixed later. The reconciliation job
 * (`scripts/news-media-r2-reconcile.ts`) owns the bucket and has the ordering
 * discipline for deleting from it. A second writer here would mean two
 * processes with two different ideas of what is safe to remove from one bucket.
 *
 * Accepted and stated cost: a window where the R2 object outlives its registry
 * row. The next reconciliation tick sees a key with no row, categorises it as
 * orphan-in-R2, and removes it — the job's existing self-healing path, not a
 * new one.
 *
 * ## Eligibility, and the 409 a foreign key produces
 *
 * The row must already be soft-deleted; `purgeNewsMediaObject` enforces that in
 * its `WHERE`, so purging a live object answers 404 rather than destroying it.
 * `awcms_news_portal_ad_placements.media_object_id` is a hard NOT NULL FK with
 * no `ON DELETE`, so purging a still-referenced object answers `409
 * MEDIA_OBJECT_REFERENCED`. That path runs inside a savepoint — see the
 * application function — because in PostgreSQL a `23503` aborts the whole
 * transaction, and the COMMIT `withTenant` performs on a returned 4xx would
 * fail with it.
 *
 * `purge` is in `HIGH_RISK_ACTIONS` and is the one action here that cannot be
 * undone, so `Idempotency-Key` is required.
 */
const IDEMPOTENCY_SCOPE = "media_object_purge";

type Prepared = { idempotencyKey: string };

export const POST = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: ({ request }) => {
    const idempotencyKey = request.headers.get("idempotency-key");

    if (!idempotencyKey) {
      return fail(
        400,
        "IDEMPOTENCY_REQUIRED",
        "Idempotency-Key header is required."
      );
    }

    return { idempotencyKey };
  },
  authorize: {
    moduleKey: "media_library",
    activityCode: MEDIA_PERMISSION_ACTIVITY_CODE,
    action: "purge"
  },
  handler: async ({ tx, auth, prepared, params, tenantId, locals }) => {
    const objectId = params.id;

    if (!objectId) {
      return fail(400, "VALIDATION_ERROR", "Media object id is required.");
    }

    const requestHash = computeRequestHash({ objectId, action: "purge" });

    const existing = await findIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey
    );

    if (existing) {
      if (existing.requestHash !== requestHash) {
        return fail(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Idempotency-Key was already used with a different request."
        );
      }
      return jsonResponse(existing.responseBody, {
        status: existing.responseStatus
      });
    }

    const result = await purgeNewsMediaObject(
      tx,
      tenantId,
      auth.context.tenantUserId,
      objectId,
      locals.correlationId
    );

    if (!result.ok) {
      if (result.reason === "still_referenced") {
        return fail(
          409,
          "MEDIA_OBJECT_REFERENCED",
          "Media object is still referenced by another resource and cannot be purged. Remove the reference first."
        );
      }

      return fail(
        404,
        "RESOURCE_NOT_FOUND",
        "Media object not found, or is not soft-deleted."
      );
    }

    log("warning", "media-library.object.purged", {
      correlationId: locals.correlationId,
      tenantId,
      moduleKey: "media_library",
      objectId
    });

    const response = ok({ id: objectId, status: "purged" });
    const body = await response.clone().json();

    await saveIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey,
      requestHash,
      200,
      body
    );

    return response;
  }
});
