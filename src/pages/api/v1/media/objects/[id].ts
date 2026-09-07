import {
  fail,
  jsonResponse,
  ok
} from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../../modules/_shared/idempotency";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import { authorizeInTransaction } from "../../../../../modules/identity-access/application/access-guard";
import { resolveClientIp } from "../../../../../lib/security/rate-limit";
import { MEDIA_PERMISSION_ACTIVITY_CODE } from "../../../../../modules/media-library/domain/media-permissions";
import { validateSoftDeleteMediaObjectInput } from "../../../../../modules/media-library/domain/media-lifecycle-validation";
import {
  softDeleteNewsMediaObject,
  updateMediaObjectRights
} from "../../../../../modules/media-library/application/media-object-directory";
import {
  type MediaRightsUpdateInput,
  validateMediaRightsUpdateInput
} from "../../../../../modules/media-library/domain/media-rights-policy";
import { isMediaObjectId } from "../../../../../modules/media-library/domain/media-object-id";
import { log } from "../../../../../lib/logging/logger";

/**
 * `DELETE /api/v1/media/objects/{id}` (ADR-0056 §B) — soft delete one media
 * object.
 *
 * ## Why this endpoint had to exist
 *
 * `media_library.media.delete` has been in the permission catalog since
 * `sql/052`, granted to every tenant owner, and enforced by NOTHING. The
 * function behind it (`softDeleteNewsMediaObject`) was written and had zero
 * callers. So an object uploaded by mistake, orphaned, or violating policy
 * could only disappear if the reconciliation job happened to categorise it that
 * way, on the job's own schedule — there was no way for an administrator to
 * remove one, and no way to undo it if they were wrong. `restore.ts` beside
 * this file is the other half, and is why a required reason is affordable here.
 *
 * ## Soft delete BREAKS live references, on purpose
 *
 * `resolveMediaReferences` filters `deleted_at IS NULL`, so a post whose
 * `featured_media_id` points here starts resolving to nothing the moment this
 * succeeds. That is the point for the case this endpoint exists to serve — a
 * policy-violating image must stop being served — and it is recoverable, which
 * is exactly why `restore` is a sibling and not a later idea. This endpoint
 * deliberately does not scan for referencing rows first: doing so would make
 * `media_library` know its own consumers, which `module.ts` forbids.
 *
 * `delete` is in `HIGH_RISK_ACTIONS`, so `Idempotency-Key` is required. The row
 * is a soft delete, so the R2 object is untouched either way.
 */
const IDEMPOTENCY_SCOPE = "media_object_delete";

type Prepared = { idempotencyKey: string; reason: string };

export const DELETE = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const idempotencyKey = request.headers.get("idempotency-key");

    if (!idempotencyKey) {
      return fail(
        400,
        "IDEMPOTENCY_REQUIRED",
        "Idempotency-Key header is required."
      );
    }

    const bodyRead = await readJsonBody(request);

    if (bodyRead.tooLarge) {
      return bodyTooLargeResponse(bodyRead.limitBytes);
    }

    const validation = validateSoftDeleteMediaObjectInput(bodyRead.value);

    if (!validation.valid) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "reason is required.",
        {},
        validation.errors
      );
    }

    return { idempotencyKey, reason: validation.value.reason };
  },
  authorize: {
    moduleKey: "media_library",
    activityCode: MEDIA_PERMISSION_ACTIVITY_CODE,
    action: "delete"
  },
  handler: async ({ tx, auth, prepared, params, tenantId, locals }) => {
    const objectId = params.id;

    if (!isMediaObjectId(objectId)) {
      return fail(400, "VALIDATION_ERROR", "Media object id must be a uuid.");
    }

    // The reason is part of the request hash: replaying the same key with a
    // different reason is a different request, and the audit row records which
    // reason was actually written.
    const requestHash = computeRequestHash({
      objectId,
      reason: prepared.reason,
      action: "delete"
    });

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

    // `softDeleteNewsMediaObject` writes its own audit event and matches on
    // `deleted_at IS NULL`, so an already-deleted object is indistinguishable
    // from an unknown one here — both 404. That is deliberate: a distinct
    // "already deleted" answer would let a caller without `media.read` probe
    // which ids exist.
    const deleted = await softDeleteNewsMediaObject(
      tx,
      tenantId,
      auth.context.tenantUserId,
      objectId,
      prepared.reason,
      locals.correlationId
    );

    if (!deleted) {
      return fail(404, "RESOURCE_NOT_FOUND", "Media object not found.");
    }

    log("info", "media-library.object.deleted", {
      correlationId: locals.correlationId,
      tenantId,
      moduleKey: "media_library",
      objectId
    });

    const response = ok({ id: objectId, status: "deleted" });
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

/**
 * `PATCH /api/v1/media/objects/{id}` (Issue #615) — edit usage-rights metadata.
 *
 * ## Why this endpoint had to exist
 *
 * `awcms_news_media_objects` has carried `alt_text` and `caption` since
 * `sql/041`, and NOTHING could edit either. The nine media permissions were
 * create, read, verify, delete, restore, purge, cancel and the two
 * `enforcement.*` — not one of them permitted changing metadata, and the only
 * method on this file was `DELETE`. So a newsroom could upload a wire photo and
 * had nowhere to record who took it.
 *
 * `sql/137` adds the rights columns and the eighth permission,
 * `media_library.media.update`, in the same change as this route — the rule
 * `media-permissions.ts` states after two keys survived three reviews by being
 * declared ahead of their surface.
 *
 * ## Rights, not accessibility, and not the byte check
 *
 * This endpoint deliberately does NOT edit `alt_text` or `caption`. Alt text is
 * an accessibility obligation and a caption is editorial copy; a credit line is
 * a licence obligation. One form for all three would make "required" ambiguous,
 * and the field that would quietly become optional is the legal one.
 *
 * It is also not `media.verify`: that permission and a `verified` status mean
 * the BYTES passed a MIME-sniff and checksum. Whether a licence permits
 * publication is a person reading a contract.
 *
 * `update` is not in `HIGH_RISK_ACTIONS`, but `Idempotency-Key` is required
 * anyway — every write on this surface takes one, and a rights adjudication
 * replayed by a retrying client would write a second audit entry claiming a
 * second decision.
 *
 * ## Issue #794 — splitting the adjudication OUT of `update`
 *
 * Since Issue #782/PR #791, `rightsVerificationStatus === 'verified'` makes
 * `creditLine`/`sourceName`/`copyrightStatus` cross into the PUBLIC
 * `GET /api/v1/media/objects` response (`resolvePublicMediaRightsFields`).
 * Before that PR this field was a purely internal editorial flag and one
 * permission for the whole form was harmless; after it, `media.update` alone
 * let whoever could type a credit line also self-attest it cleared for
 * publication — no second reviewer, no distinct authority. See `sql/152` and
 * `media-permissions.ts`'s `adjudicate_rights` doc comment for the full case.
 *
 * The primary `authorize` guard below picks the permission from the SHAPE of
 * the already-validated body:
 *
 *   * body touches only routine fields (`creditLine`/`sourceName`/
 *     `copyrightStatus`/`rightsNotes`) -> `media.update`, unchanged from
 *     before this issue. No regression for the common case.
 *   * body touches ONLY `rightsVerificationStatus` -> `media.adjudicate_rights`
 *     ALONE. This is the deliberate choice for a caller that holds
 *     `adjudicate_rights` but not `media.update`: a rights reviewer's whole
 *     job is the adjudication, not editing the credit line it adjudicates,
 *     and requiring `media.update` too would force a tenant to also hand the
 *     reviewer role edit rights over fields it has no business touching —
 *     reintroducing, one level up, the exact coupling this issue exists to
 *     remove.
 *
 * A request that touches BOTH kinds of field in one call needs BOTH
 * permissions: the primary guard picks `media.update` (since routine fields
 * are present), and the handler makes a SECOND `authorizeInTransaction` call
 * for `adjudicate_rights` before doing anything — a caller holding only one
 * of the two is denied 403 either way, never allowed to smuggle a rights
 * decision in alongside an edit it has no adjudication authority for (or vice
 * versa). ADR-0063 still holds: both checks go through the one chokepoint,
 * `defineTenantRoute`'s wiring for the first and an explicit call for the
 * second — never an ad-hoc comparison.
 */
const RIGHTS_IDEMPOTENCY_SCOPE = "media_object_rights_update";

type RightsPrepared = {
  idempotencyKey: string;
  input: MediaRightsUpdateInput;
};

/** The four rights fields `media.update` alone still governs — everything in {@link MediaRightsUpdateInput} except the adjudication itself. */
const ROUTINE_RIGHTS_FIELDS = [
  "creditLine",
  "sourceName",
  "copyrightStatus",
  "rightsNotes"
] as const;

/** Does this (already-validated) patch touch any field `media.update` alone governs? */
function touchesRoutineRightsField(input: MediaRightsUpdateInput): boolean {
  return ROUTINE_RIGHTS_FIELDS.some((field) => input[field] !== undefined);
}

export const PATCH = defineTenantRoute<RightsPrepared>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const idempotencyKey = request.headers.get("idempotency-key");

    if (!idempotencyKey) {
      return fail(
        400,
        "IDEMPOTENCY_REQUIRED",
        "Idempotency-Key header is required."
      );
    }

    const bodyRead = await readJsonBody(request);

    if (bodyRead.tooLarge) {
      return bodyTooLargeResponse(bodyRead.limitBytes);
    }

    const validation = validateMediaRightsUpdateInput(bodyRead.value);

    if (!validation.valid) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "Media rights metadata is invalid.",
        {},
        validation.errors
      );
    }

    return { idempotencyKey, input: validation.value };
  },
  // Issue #794 — picks the permission from the SHAPE of the validated body.
  // Routine fields (present or not) decide `update` vs `adjudicate_rights`;
  // when BOTH kinds of field are present, `update` is the primary guard here
  // and the handler makes a second `authorizeInTransaction` call for
  // `adjudicate_rights` before touching anything. See this route's header for
  // why "adjudicate_rights alone" (no `update`) is deliberately sufficient
  // for a request that changes ONLY `rightsVerificationStatus`.
  authorize: ({ prepared }) => ({
    moduleKey: "media_library",
    activityCode: MEDIA_PERMISSION_ACTIVITY_CODE,
    action: touchesRoutineRightsField(prepared.input)
      ? "update"
      : "adjudicate_rights"
  }),
  handler: async ({
    tx,
    auth,
    prepared,
    params,
    tenantId,
    locals,
    tokenHash,
    now,
    request,
    clientAddress
  }) => {
    const objectId = params.id;

    if (!isMediaObjectId(objectId)) {
      return fail(400, "VALIDATION_ERROR", "Media object id must be a uuid.");
    }

    // The primary guard above only checked `adjudicate_rights` when the body
    // touched NOTHING else. A combined request (routine field + verification
    // status together) was authorized on `update` alone — this is the second
    // half of that gate, run BEFORE any read/write below. A caller holding
    // only one of the two permissions is denied here, never allowed to ride
    // the other permission's approval for the field it does not cover.
    if (
      prepared.input.rightsVerificationStatus !== undefined &&
      touchesRoutineRightsField(prepared.input)
    ) {
      const adjudication = await authorizeInTransaction(
        tx,
        tenantId,
        tokenHash,
        now,
        {
          moduleKey: "media_library",
          activityCode: MEDIA_PERMISSION_ACTIVITY_CODE,
          action: "adjudicate_rights"
        },
        // ADR-0092 — a hand-written second call is not one `defineTenantRoute`
        // wires `clientIp` for automatically; passing it explicitly keeps the
        // write-class machine-credential IP restriction enforced for this
        // guard too, not silently switched off.
        { clientIp: resolveClientIp(request, clientAddress) }
      );

      if (!adjudication.allowed) {
        return adjudication.denied;
      }
    }

    // The whole patch is in the hash: replaying a key with a different credit
    // line is a different request, and the audit row records which one was
    // actually written.
    const requestHash = computeRequestHash({
      objectId,
      input: prepared.input,
      action: "rights_update"
    });

    const existing = await findIdempotencyRecord(
      tx,
      tenantId,
      RIGHTS_IDEMPOTENCY_SCOPE,
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

    // A soft-deleted object answers 404, same as an unknown id — its rights
    // record is evidence about something already withdrawn, and distinguishing
    // the two would let a caller probe which ids exist.
    const updated = await updateMediaObjectRights(
      tx,
      tenantId,
      auth.context.tenantUserId,
      objectId,
      prepared.input,
      locals.correlationId
    );

    if (!updated) {
      return fail(404, "RESOURCE_NOT_FOUND", "Media object not found.");
    }

    log("info", "media-library.object.rights_updated", {
      correlationId: locals.correlationId,
      tenantId,
      moduleKey: "media_library",
      objectId,
      rightsVerificationStatus: updated.rightsVerificationStatus
    });

    const response = ok(updated);
    const body = await response.clone().json();

    await saveIdempotencyRecord(
      tx,
      tenantId,
      RIGHTS_IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey,
      requestHash,
      200,
      body
    );

    return response;
  }
});
