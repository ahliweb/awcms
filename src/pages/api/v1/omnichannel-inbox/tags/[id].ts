import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { deleteTag } from "../../../../../modules/omnichannel-inbox/application/tag-directory";
import {
  asUuid,
  auditInbox,
  badId,
  disabledResponse,
  notFound,
  personOnlyRefusal,
  readIdempotencyKey,
  requireTenantWide,
  runIdempotent
} from "../../../../../modules/omnichannel-inbox/application/route-support";
import { OMNICHANNEL_INBOX_GUARDS } from "../../../../../modules/omnichannel-inbox/domain/inbox-constants";

/**
 * `DELETE /api/v1/omnichannel-inbox/tags/{id}` — soft-delete a tag and unlink
 * it from every conversation in the same transaction. `Idempotency-Key`;
 * audited.
 */
export const DELETE = defineTenantRoute<string>({
  workClass: "interactive",
  prepare: ({ request }) => {
    const disabled = disabledResponse();

    if (disabled) return disabled;

    return readIdempotencyKey(request);
  },
  authorize: OMNICHANNEL_INBOX_GUARDS.configureTags,
  handler: async (context) => {
    // The catalogue is tenant-wide: a scope-confined manager may not shape it
    // (#1275 audit, L-3).
    const refused =
      personOnlyRefusal(context.auth) ??
      (await requireTenantWide(
        context,
        OMNICHANNEL_INBOX_GUARDS.configureTags
      ));

    if (refused) return refused;

    const id = asUuid(context.params.id);

    if (!id) return badId();

    const actor = context.auth.context.tenantUserId;

    return runIdempotent(
      context.tx,
      context.tenantId,
      "omnichannel_inbox_tag_delete",
      context.prepared,
      actor,
      { id },
      async () => {
        const result = await deleteTag(context.tx, context.tenantId, actor, id);

        if (result.outcome === "not_found") return notFound("Tag");

        await auditInbox(context, {
          action: "omnichannel_inbox.tag.delete",
          resourceType: "omnichannel_inbox_tag",
          resourceId: id,
          severity: "info",
          message: "Inbox tag deleted and unlinked from its conversations.",
          attributes: { unlinkedConversations: result.unlinked }
        });

        return {
          status: 200,
          body: { id, deleted: true, unlinkedConversations: result.unlinked }
        };
      }
    );
  }
});
