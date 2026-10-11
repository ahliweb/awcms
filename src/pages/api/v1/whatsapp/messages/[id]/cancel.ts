import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";
import { cancelWhatsappMessage } from "../../../../../../modules/whatsapp-delivery/application/whatsapp-enqueue";
import { isWhatsappRecordId } from "../../../../../../modules/whatsapp-delivery/domain/whatsapp-record-id";

/**
 * `POST /api/v1/whatsapp/messages/{id}/cancel` (Issue #963) — stop a message
 * that has not been handed to a provider yet.
 *
 * `sending` is refused rather than forced: the row is claimed by a dispatcher
 * pass that may already be inside the HTTP call, so "cancelled" would be a
 * status this system cannot substantiate.
 *
 * Deliberately NOT idempotency-keyed: cancelling twice reaches the same end
 * state and the second call is refused for the same reason a `sending` row is —
 * there is no new work to replay.
 */
export const POST = defineTenantRoute({
  workClass: "interactive",
  authorize: {
    moduleKey: "whatsapp_delivery",
    activityCode: "messages",
    action: "cancel"
  },
  handler: async ({ tx, tenantId, auth, params, locals }) => {
    const messageId = params.id;

    if (!isWhatsappRecordId(messageId)) {
      return fail(
        400,
        "VALIDATION_FAILED",
        "WhatsApp message id must be a uuid."
      );
    }

    const result = await cancelWhatsappMessage(tx, tenantId, messageId);

    if (!result.cancelled) {
      // One answer for "no such message", "already sent/failed/cancelled" and
      // "currently sending": the distinctions are on the diagnostics screen, and
      // reporting them here would hand a narrower grant an existence oracle.
      return fail(
        409,
        "WHATSAPP_MESSAGE_NOT_CANCELLABLE",
        "That WhatsApp message is not waiting in the queue — it was already sent, failed, cancelled, or is being sent right now."
      );
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "whatsapp_delivery",
      action: "whatsapp_message.cancelled",
      resourceType: "whatsapp_message",
      resourceId: messageId,
      severity: "info",
      message: "Queued WhatsApp message cancelled before delivery.",
      correlationId: locals.correlationId
    });

    return ok({ cancelled: true });
  }
});
