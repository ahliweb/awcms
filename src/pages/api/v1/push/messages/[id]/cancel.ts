import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";
import { cancelPushMessage } from "../../../../../../modules/push-delivery/application/push-enqueue";
import { isPushRecordId } from "../../../../../../modules/push-delivery/domain/push-record-id";

/**
 * `POST /api/v1/push/messages/{id}/cancel` (Issue #466) — stop a notification
 * that has not been handed to a provider yet.
 *
 * ## Why `sending` is refused rather than forced
 *
 * `cancelPushMessage` only matches `queued`/`retry_wait`. A row in `sending`
 * has been claimed by a dispatcher pass that may already be inside the HTTP
 * call, so "cancelled" would be a status this system cannot substantiate: the
 * notification may be on the device by the time the row says it was stopped.
 * The honest answer is a refusal that says so, and the operator's real recourse
 * — waiting out the lease — is bounded and short.
 *
 * ## Deliberately NOT idempotency-keyed
 *
 * Cancelling twice reaches the same end state and the second call reports
 * `cancelled: false` for the same reason a `sending` row does: the row is no
 * longer cancellable. There is no new work to replay and therefore no replay
 * contract to honour — the same reasoning `/access/machine-credentials`'s
 * revoke path records.
 */
export const POST = defineTenantRoute({
  workClass: "interactive",
  authorize: {
    moduleKey: "push_delivery",
    activityCode: "messages",
    action: "cancel"
  },
  handler: async ({ tx, tenantId, auth, params }) => {
    const messageId = params.id;

    if (!isPushRecordId(messageId)) {
      return fail(400, "VALIDATION_FAILED", "Push message id must be a uuid.");
    }

    const result = await cancelPushMessage(tx, tenantId, messageId);

    if (!result.cancelled) {
      // One answer for "no such message", "already sent", "already failed",
      // "already cancelled" and "currently sending". The distinctions an
      // operator needs are on the diagnostics screen, which they hold the
      // permission for; making this endpoint report them would hand a narrower
      // grant an existence oracle over the queue.
      return fail(
        409,
        "PUSH_MESSAGE_NOT_CANCELLABLE",
        "That push message is not waiting in the queue — it was already sent, failed, cancelled, or is being sent right now."
      );
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "push_delivery",
      action: "push_message.cancelled",
      resourceType: "push_message",
      resourceId: messageId,
      severity: "info",
      message: "Queued push notification cancelled before delivery."
    });

    return ok({ cancelled: true });
  }
});
