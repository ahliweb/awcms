import { fail } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { assigneeEligibility } from "../../../../../../modules/omnichannel-inbox/application/assignee-eligibility";
import { assignConversation } from "../../../../../../modules/omnichannel-inbox/application/conversation-directory";
import {
  asUuid,
  auditInbox,
  badId,
  disabledResponse,
  notFound,
  personOnlyRefusal,
  readIdempotencyKey,
  readValidatedBody,
  runIdempotent,
  versionConflict,
  visibilityFor
} from "../../../../../../modules/omnichannel-inbox/application/route-support";
import { OMNICHANNEL_INBOX_GUARDS } from "../../../../../../modules/omnichannel-inbox/domain/inbox-constants";
import { validateAssignmentBody } from "../../../../../../modules/omnichannel-inbox/domain/inbox-validation";
import { officeScopeHierarchyPortAdapter } from "../../../../../../modules/tenant-admin/application/office-scope-hierarchy-port-adapter";

type Prepared = {
  key: string;
  body: { assigneeTenantUserId: string | null; expectedVersion: number };
};

/**
 * `POST /api/v1/omnichannel-inbox/conversations/{id}/assignment` — assign the
 * conversation to an eligible staff member, or unassign it (`null`).
 * High-risk: `Idempotency-Key`, a signed-in person, audited. The caller must
 * SEE the conversation (business-scope confinement). The assignee must be an
 * active user holding `conversations.update` on a tenant-wide grant and, if
 * confined, cover the conversation's scope; otherwise `422
 * ASSIGNEE_NOT_ELIGIBLE` with a reason code. `expectedVersion` makes concurrent
 * reassignment safe: exactly one writer wins, the other gets `409`.
 */
export const POST = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const disabled = disabledResponse();

    if (disabled) return disabled;

    const key = readIdempotencyKey(request);

    if (key instanceof Response) return key;

    const body = await readValidatedBody(request, validateAssignmentBody);

    return body instanceof Response ? body : { key, body };
  },
  authorize: OMNICHANNEL_INBOX_GUARDS.assignConversations,
  handler: async (context) => {
    const refused = personOnlyRefusal(context.auth);

    if (refused) return refused;

    const id = asUuid(context.params.id);

    if (!id) return badId();

    const { tx, tenantId, now } = context;
    const actor = context.auth.context.tenantUserId;
    const visibility = await visibilityFor(
      context,
      OMNICHANNEL_INBOX_GUARDS.assignConversations
    );

    return runIdempotent(
      tx,
      tenantId,
      "omnichannel_inbox_conversation_assign",
      context.prepared.key,
      actor,
      { id, ...context.prepared.body },
      async () => {
        const result = await assignConversation(
          tx,
          tenantId,
          id,
          visibility,
          actor,
          context.prepared.body,
          now,
          (assigneeId, scope) =>
            assigneeEligibility(
              tx,
              tenantId,
              assigneeId,
              scope,
              now,
              officeScopeHierarchyPortAdapter
            )
        );

        switch (result.outcome) {
          case "not_found":
            return notFound("Conversation");
          case "version_conflict":
            return versionConflict(result.currentVersion);
          case "customer_unreachable":
            return fail(409, "CUSTOMER_UNREACHABLE", "Not assignable.");
          case "assignee_not_eligible":
            return fail(
              422,
              "ASSIGNEE_NOT_ELIGIBLE",
              "The person cannot be assigned this conversation.",
              {},
              { reason: result.reason }
            );
          default:
            break;
        }

        if (result.outcome !== "unchanged") {
          await auditInbox(context, {
            action: `omnichannel_inbox.conversation.${result.outcome === "assigned" ? "assign" : "unassign"}`,
            resourceType: "omnichannel_inbox_conversation",
            resourceId: id,
            severity: "info",
            message:
              result.outcome === "assigned"
                ? "Inbox conversation assigned."
                : "Inbox conversation unassigned.",
            attributes: {
              assigneeTenantUserId: context.prepared.body.assigneeTenantUserId,
              previousAssigneeTenantUserId: result.previousAssignee
            }
          });
        }

        return {
          status: 200,
          body: {
            outcome: result.outcome,
            conversation: result.conversation
          }
        };
      }
    );
  }
});
