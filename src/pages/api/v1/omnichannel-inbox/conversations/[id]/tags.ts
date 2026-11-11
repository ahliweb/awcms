import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { setConversationTags } from "../../../../../../modules/omnichannel-inbox/application/conversation-directory";
import {
  asUuid,
  auditInbox,
  badId,
  disabledResponse,
  notFound,
  personOnlyRefusal,
  readValidatedBody,
  versionConflict,
  visibilityFor
} from "../../../../../../modules/omnichannel-inbox/application/route-support";
import { OMNICHANNEL_INBOX_GUARDS } from "../../../../../../modules/omnichannel-inbox/domain/inbox-constants";
import { validateTagsBody } from "../../../../../../modules/omnichannel-inbox/domain/inbox-validation";

/**
 * `PUT /api/v1/omnichannel-inbox/conversations/{id}/tags` — replace the
 * conversation's tags with `tagIds` (at most 20 live tags of this tenant).
 * Each added or removed tag is an activity row. Guarded by `expectedVersion`;
 * audited.
 */
export const PUT = defineTenantRoute<{
  tagIds: string[];
  expectedVersion: number;
}>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const disabled = disabledResponse();

    if (disabled) return disabled;

    return readValidatedBody(request, validateTagsBody);
  },
  authorize: OMNICHANNEL_INBOX_GUARDS.updateConversations,
  handler: async (context) => {
    const refused = personOnlyRefusal(context.auth);

    if (refused) return refused;

    const id = asUuid(context.params.id);

    if (!id) return badId();

    const result = await setConversationTags(
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
        return fail(409, "CUSTOMER_UNREACHABLE", "Not taggable.");
      case "tag_unknown":
        return fail(
          422,
          "TAG_UNKNOWN",
          "Every tag must be a live tag of this tenant."
        );
      default:
        break;
    }

    if (result.outcome === "changed") {
      await auditInbox(context, {
        action: "omnichannel_inbox.conversation.tags",
        resourceType: "omnichannel_inbox_conversation",
        resourceId: id,
        severity: "info",
        message: "Inbox conversation tags changed.",
        attributes: { tagCount: context.prepared.tagIds.length }
      });
    }

    return ok({ outcome: result.outcome, conversation: result.conversation });
  }
});
