import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import {
  auditEndedBindings,
  endBindings
} from "../../../../../../modules/telegram-delivery/application/telegram-bindings";
import { isTelegramRecordId } from "../../../../../../modules/telegram-delivery/domain/telegram-record-id";

/**
 * `POST /api/v1/telegram/bindings/{id}/revoke` (Issue #965, ADR-0140 section 3) —
 * an administrator revokes ANOTHER staff member's binding. High-risk
 * (`bindings.revoke` is in `HIGH_RISK_ACTIONS` via `revoke`): the stored chat id
 * is erased and the queue cancelled at once, and the audit row is `warning`
 * because it removes a person's alert channel. The chat appears only as its mask.
 *
 * Naturally idempotent rather than `Idempotency-Key`-ed: revoking an ended binding
 * finds nothing live and answers 404, so a retry cannot repeat the effect.
 * One answer for "no such binding" and "already ended" so the id space is not an
 * oracle.
 */
export const POST = defineTenantRoute({
  workClass: "interactive",
  authorize: {
    moduleKey: "telegram_delivery",
    activityCode: "bindings",
    action: "revoke"
  },
  handler: async ({ tx, tenantId, auth, params, locals }) => {
    const bindingId = params.id;

    if (!isTelegramRecordId(bindingId)) {
      return fail(400, "VALIDATION_ERROR", "Binding id must be a uuid.");
    }

    const ended = await endBindings(tx, tenantId, { bindingId }, "admin", {
      actorTenantUserId: auth.context.tenantUserId
    });

    if (ended.ended.length === 0) {
      return fail(
        404,
        "RESOURCE_NOT_FOUND",
        "That Telegram binding does not exist or has already ended."
      );
    }

    await auditEndedBindings(tx, tenantId, ended, "admin", {
      actorTenantUserId: auth.context.tenantUserId,
      correlationId: locals.correlationId
    });

    return ok({
      revoked: true,
      cancelledMessages: ended.cancelledMessages
    });
  }
});
