import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import { revokeInvitation } from "../../../../../modules/identity-access/application/invitation-admin";

/**
 * `POST /api/v1/invitations/{id}/revoke` (ADR-0082).
 *
 * Kills the link; keeps the row. `revoke` answers "this link is dead now" while
 * the surviving row answers "who offered what, to whom, and what happened" —
 * which is the question an investigation asks first, and the reason there is no
 * `delete` in this activity's permission set (`sql/107`).
 *
 * No `Idempotency-Key`: the UPDATE carries `AND status = 'pending'`, so a
 * double-click revokes once and the second call answers `404`. Requiring a key
 * for an operation that is already idempotent in the database would be
 * ceremony.
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_REASON_LENGTH = 500;

type Prepared = { id: string; reason: string | null };

export const POST = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: async ({ request, params }): Promise<Prepared | Response> => {
    const id = params.id;
    if (!id || !UUID_PATTERN.test(id)) {
      return fail(400, "VALIDATION_ERROR", "id must be a UUID.");
    }

    const bodyRead = await readJsonBody(request);
    if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

    const record = (bodyRead.value ?? {}) as Record<string, unknown>;
    if (record.reason !== undefined && record.reason !== null) {
      if (typeof record.reason !== "string") {
        return fail(400, "VALIDATION_ERROR", "reason must be a string.");
      }
      if (record.reason.length > MAX_REASON_LENGTH) {
        return fail(
          400,
          "VALIDATION_ERROR",
          `reason must be at most ${MAX_REASON_LENGTH} characters.`
        );
      }
    }

    const reason =
      typeof record.reason === "string" && record.reason.trim() !== ""
        ? record.reason.trim()
        : null;

    return { id, reason };
  },
  authorize: {
    moduleKey: "identity_access",
    activityCode: "invitations",
    action: "revoke"
  },
  handler: async ({ tx, tenantId, auth, prepared, now, locals }) => {
    const result = await revokeInvitation(
      tx,
      tenantId,
      prepared.id,
      auth.context.tenantUserId,
      now,
      prepared.reason,
      locals.correlationId
    );

    // An invitation that is not pending and one that does not exist answer
    // identically, so the response cannot be used to enumerate ids belonging to
    // another tenant — or to learn that a given invitation was already
    // accepted.
    if (result.outcome === "not_found") {
      return fail(
        404,
        "RESOURCE_NOT_FOUND",
        "No pending invitation with that id."
      );
    }

    return ok({ id: prepared.id, status: "revoked" });
  }
});
