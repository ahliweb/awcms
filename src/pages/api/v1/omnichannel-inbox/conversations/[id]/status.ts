import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { ok } from "../../../../../../modules/_shared/api-response";
import { changeStatus } from "../../../../../../modules/omnichannel-inbox/application/conversation-directory";
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
import {
  OMNICHANNEL_INBOX_GUARDS,
  type ConversationStatus
} from "../../../../../../modules/omnichannel-inbox/domain/inbox-constants";
import { validateStatusBody } from "../../../../../../modules/omnichannel-inbox/domain/inbox-validation";

/**
 * `POST /api/v1/omnichannel-inbox/conversations/{id}/status` — move a
 * conversation to `open`, `pending`, `resolved` or `closed`. Resolving or
 * closing settles everything received so far (the SLA clock stops; only a NEW
 * inbound reopens it). A withdrawn customer's conversation cannot be reopened.
 * Guarded by `expectedVersion` (`409 VERSION_CONFLICT`); audited.
 */
export const POST = defineTenantRoute<{
  status: ConversationStatus;
  expectedVersion: number;
}>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const disabled = disabledResponse();

    if (disabled) return disabled;

    return readValidatedBody(request, validateStatusBody);
  },
  authorize: OMNICHANNEL_INBOX_GUARDS.updateConversations,
  handler: async (context) => {
    const refused = personOnlyRefusal(context.auth);

    if (refused) return refused;

    const id = asUuid(context.params.id);

    if (!id) return badId();

    const result = await changeStatus(
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

    if (result.outcome === "changed") {
      await auditInbox(context, {
        action: "omnichannel_inbox.conversation.status",
        resourceType: "omnichannel_inbox_conversation",
        resourceId: id,
        severity: "info",
        message: "Inbox conversation status changed.",
        attributes: { status: context.prepared.status }
      });
    }

    return ok({ outcome: result.outcome, conversation: result.conversation });
  }
});
