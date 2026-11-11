import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { ok } from "../../../../../../modules/_shared/api-response";
import { recordResponse } from "../../../../../../modules/omnichannel-inbox/application/conversation-directory";
import {
  asUuid,
  auditInbox,
  badId,
  customerUnreachable,
  disabledResponse,
  notFound,
  personOnlyRefusal,
  readValidatedBody,
  versionConflict,
  visibilityFor
} from "../../../../../../modules/omnichannel-inbox/application/route-support";
import { OMNICHANNEL_INBOX_GUARDS } from "../../../../../../modules/omnichannel-inbox/domain/inbox-constants";
import { validateVersionOnlyBody } from "../../../../../../modules/omnichannel-inbox/domain/inbox-validation";

/**
 * `POST /api/v1/omnichannel-inbox/conversations/{id}/responses` — record that
 * the caller answered the customer THROUGH THE ARRIVAL CHANNEL'S OWN ROUTE (the
 * inbox sends nothing and has no send facade, ADR-0160 section 2). Settles
 * everything received up to now and stops the SLA clock. Refused (`409
 * CUSTOMER_UNREACHABLE`) when the customer opted out or withdrew. Guarded by
 * `expectedVersion`; audited.
 */
export const POST = defineTenantRoute<{ expectedVersion: number }>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const disabled = disabledResponse();

    if (disabled) return disabled;

    return readValidatedBody(request, validateVersionOnlyBody);
  },
  authorize: OMNICHANNEL_INBOX_GUARDS.updateConversations,
  handler: async (context) => {
    const refused = personOnlyRefusal(context.auth);

    if (refused) return refused;

    const id = asUuid(context.params.id);

    if (!id) return badId();

    const result = await recordResponse(
      context.tx,
      context.tenantId,
      id,
      await visibilityFor(
        context,
        OMNICHANNEL_INBOX_GUARDS.updateConversations
      ),
      context.auth.context.tenantUserId,
      context.prepared,
      context.now
    );

    switch (result.outcome) {
      case "not_found":
        return notFound("Conversation");
      case "version_conflict":
        return versionConflict(result.currentVersion);
      case "customer_unreachable":
        return customerUnreachable();
      default:
        break;
    }

    await auditInbox(context, {
      action: "omnichannel_inbox.conversation.response",
      resourceType: "omnichannel_inbox_conversation",
      resourceId: id,
      severity: "info",
      message: "Inbox conversation response recorded."
    });

    return ok({ outcome: result.outcome, conversation: result.conversation });
  }
});
