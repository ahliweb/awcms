import { ok } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { getConversation } from "../../../../../../modules/omnichannel-inbox/application/conversation-directory";
import {
  asUuid,
  badId,
  disabledResponse,
  notFound,
  visibilityFor
} from "../../../../../../modules/omnichannel-inbox/application/route-support";
import { OMNICHANNEL_INBOX_GUARDS } from "../../../../../../modules/omnichannel-inbox/domain/inbox-constants";

/**
 * `GET /api/v1/omnichannel-inbox/conversations/{id}` — one conversation with
 * its tags and its latest activity (ids and closed codes). Unknown, foreign and
 * invisible are the same `404`.
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  prepare: () => disabledResponse() ?? undefined,
  authorize: OMNICHANNEL_INBOX_GUARDS.readConversations,
  handler: async (context) => {
    const id = asUuid(context.params.id);

    if (!id) return badId();

    const conversation = await getConversation(
      context.tx,
      context.tenantId,
      id,
      await visibilityFor(context, OMNICHANNEL_INBOX_GUARDS.readConversations),
      context.now
    );

    return conversation ? ok(conversation) : notFound("Conversation");
  }
});
