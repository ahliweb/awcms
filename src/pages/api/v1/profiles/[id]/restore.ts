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
import { log } from "../../../../../lib/logging/logger";
import { restoreParty } from "../../../../../modules/profile-identity/application/party-directory";
import { toPartyMaskedAdminDTO } from "../../../../../modules/profile-identity/domain/projection";

/**
 * `POST /api/v1/profiles/{id}/restore` (ADR-0058 §A).
 *
 * The counterpart `DELETE /api/v1/profiles/{id}` shipped without. Until this
 * route existed, `profile_management.restore` sat seeded in the catalogue and
 * enforced by nothing, and — the part that made it a hole rather than a spare
 * row — no code path could write `restored_at`/`restored_by`, so soft-deleting
 * a profile was permanent.
 *
 * The precondition is enforced by `restoreParty`'s `WHERE … deleted_at IS NOT
 * NULL`, not by a read first: two concurrent restores that both read before
 * writing would both proceed and audit two restorations of one profile.
 *
 * Both "no such profile" and "that profile is not deleted" answer the same
 * 404. A distinguishable answer would let any caller holding `restore` probe
 * which profile ids exist by watching this route fail differently — and profile
 * ids are exactly the identifiers this module masks everywhere else.
 *
 * High-risk mutation: `Idempotency-Key` required.
 */
const IDEMPOTENCY_SCOPE = "profile_restore";

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
    moduleKey: "profile_identity",
    activityCode: "profile_management",
    action: "restore"
  },
  handler: async ({ tx, auth, prepared, params, tenantId, locals }) => {
    const profileId = params.id;

    if (!profileId) {
      return fail(400, "VALIDATION_ERROR", "Profile id is required.");
    }

    const correlationId = locals.correlationId;
    const requestHash = computeRequestHash({ profileId, action: "restore" });

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

    const restored = await restoreParty(
      tx,
      tenantId,
      auth.context.tenantUserId,
      profileId,
      correlationId
    );

    if (!restored) {
      return fail(
        404,
        "RESOURCE_NOT_FOUND",
        "Profile not found, or is not soft-deleted."
      );
    }

    log("info", "profile-identity.profile.restored", {
      correlationId,
      tenantId,
      moduleKey: "profile_identity",
      profileId
    });

    const response = ok(toPartyMaskedAdminDTO(restored));
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
