import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { refuseNonInteractive } from "../../../../../../modules/telegram-delivery/application/telegram-interactive-guard";
import {
  auditEndedBindings,
  endBindings
} from "../../../../../../modules/telegram-delivery/application/telegram-bindings";

/**
 * `POST /api/v1/telegram/bindings/me/revoke` (Issue #965, ADR-0140 section 3) —
 * the staff member unlinks THEIR OWN chat from the admin (`/stop` in the chat is
 * the other way). Delivery stops at once: queued messages are cancelled and the
 * stored chat id is erased in the same transaction. No body.
 *
 * Naturally idempotent: with nothing live the answer is 404.
 */
export const POST = defineTenantRoute({
  workClass: "interactive",
  authorize: {
    moduleKey: "telegram_delivery",
    activityCode: "links",
    action: "create"
  },
  handler: async ({ tx, tenantId, auth, locals }) => {
    const refused = refuseNonInteractive(auth.context);

    if (refused) {
      return refused;
    }

    const ended = await endBindings(
      tx,
      tenantId,
      { principalId: auth.context.tenantUserId },
      "self_admin",
      { actorTenantUserId: auth.context.tenantUserId }
    );

    if (ended.ended.length === 0) {
      return fail(
        404,
        "RESOURCE_NOT_FOUND",
        "You have no Telegram chat linked."
      );
    }

    await auditEndedBindings(tx, tenantId, ended, "self_admin", {
      actorTenantUserId: auth.context.tenantUserId,
      correlationId: locals.correlationId
    });

    return ok({
      revoked: ended.ended.length,
      cancelledMessages: ended.cancelledMessages
    });
  }
});
