import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { resendInvitation } from "../../../../../modules/identity-access/application/invitation-admin";
import { createEmailAuthNotificationAdapter } from "../../../../../modules/email/application/auth-notification-port-adapter";
import { resolveInvitationConfig } from "../../../../../lib/auth/invitation-config";

/**
 * `POST /api/v1/invitations/{id}/resend` (ADR-0082).
 *
 * Guarded by `invitations.create`, not by an action of its own. Resend MINTS A
 * NEW TOKEN, which is exactly the authority `create` already names — and a
 * separate `resend` permission would let an operator hand fresh credentials to
 * everyone previously invited while holding no authority to invite anyone.
 *
 * ## No `Idempotency-Key`, deliberately
 *
 * Replaying a resend would have to either return the token it already rotated
 * away — which no longer works — or persist the plaintext token in
 * `awcms_idempotency_keys`. The machine-credential issue endpoint (ADR-0049)
 * refuses the header for the second reason exactly; this refuses it for both.
 *
 * The operation is still bounded rather than unbounded: the UPDATE carries
 * `AND resend_count < 5`, matching the database's own CHECK, so a caller
 * hammering this endpoint runs out after five links rather than forever.
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST = defineTenantRoute<string>({
  workClass: "interactive",
  prepare: ({ params }): string | Response => {
    const id = params.id;
    if (!id || !UUID_PATTERN.test(id)) {
      return fail(400, "VALIDATION_ERROR", "id must be a UUID.");
    }
    return id;
  },
  authorize: {
    moduleKey: "identity_access",
    activityCode: "invitations",
    action: "create"
  },
  handler: async ({ tx, tenantId, auth, prepared, now, locals }) => {
    const result = await resendInvitation(
      tx,
      tenantId,
      prepared,
      auth.context.tenantUserId,
      now,
      {
        ...resolveInvitationConfig(),
        notifications: createEmailAuthNotificationAdapter(),
        correlationId: locals.correlationId
      }
    );

    if (result.outcome === "not_found") {
      return fail(
        404,
        "RESOURCE_NOT_FOUND",
        "No pending invitation with that id."
      );
    }

    if (result.outcome === "resend_limit_reached") {
      return fail(
        409,
        "INVITATION_RESEND_LIMIT",
        "This invitation has been resent the maximum number of times; revoke it and issue a new one."
      );
    }

    return ok({
      id: prepared,
      resendCount: result.resendCount,
      delivery: result.delivery
    });
  }
});
