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
import { restoreNewsMediaObject } from "../../../../../../modules/media-library/application/media-object-directory";
import { log } from "../../../../../../lib/logging/logger";

/**
 * `POST /api/v1/media/objects/{id}/restore` (ADR-0056 §B) — undo a soft delete.
 *
 * This is the half that makes `DELETE /api/v1/media/objects/{id}` an affordable
 * action rather than a one-way door. Soft-deleting a media object stops every
 * reference to it resolving (`resolveMediaReferences` filters
 * `deleted_at IS NULL`), so without a restore path a mistaken deletion would
 * break a published page with no in-band recovery — the shape of hole ADR-0056
 * §B was written to close, not to reproduce one level down.
 *
 * `restoreNewsMediaObject` matches on `deleted_at IS NOT NULL`, so restoring a
 * live object is a 404, not a no-op success: "there was nothing to undo" and
 * "it worked" must not share a response.
 *
 * `restore` is in `HIGH_RISK_ACTIONS` — it returns content to being publicly
 * referenceable — so `Idempotency-Key` is required. Note the asymmetry with
 * `delete`: this endpoint takes no body, so its request hash covers the id
 * alone.
 */
const IDEMPOTENCY_SCOPE = "media_object_restore";

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
    action: "restore"
  },
  handler: async ({ tx, auth, prepared, params, tenantId, locals }) => {
    const objectId = params.id;

    if (!objectId) {
      return fail(400, "VALIDATION_ERROR", "Media object id is required.");
    }

    const requestHash = computeRequestHash({ objectId, action: "restore" });

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

    const restored = await restoreNewsMediaObject(
      tx,
      tenantId,
      auth.context.tenantUserId,
      objectId,
      locals.correlationId
    );

    if (!restored) {
      return fail(
        404,
        "RESOURCE_NOT_FOUND",
        "Media object not found, or is not soft-deleted."
      );
    }

    log("info", "media-library.object.restored", {
      correlationId: locals.correlationId,
      tenantId,
      moduleKey: "media_library",
      objectId
    });

    const response = ok({
      id: restored.id,
      status: restored.status,
      restoredAt: restored.restoredAt
    });
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
