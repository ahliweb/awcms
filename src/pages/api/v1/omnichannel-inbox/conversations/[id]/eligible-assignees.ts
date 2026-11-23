import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import {
  listEligibleStaff,
  validateEligibleStaffQuery,
  type EligibleStaffQuery
} from "../../../../../../modules/identity-access/application/eligible-staff-directory";
import { getVisibleConversationScope } from "../../../../../../modules/omnichannel-inbox/application/conversation-directory";
import {
  asUuid,
  badId,
  disabledResponse,
  notFound,
  personOnlyRefusal,
  visibilityFor
} from "../../../../../../modules/omnichannel-inbox/application/route-support";
import {
  ASSIGNEE_PERMISSION_KEY,
  OMNICHANNEL_INBOX_GUARDS
} from "../../../../../../modules/omnichannel-inbox/domain/inbox-constants";
import { officeScopeHierarchyPortAdapter } from "../../../../../../modules/tenant-admin/application/office-scope-hierarchy-port-adapter";

/**
 * `GET /api/v1/omnichannel-inbox/conversations/{id}/eligible-assignees` — the
 * staff who could be assigned THIS conversation (Issue #1486, #1164).
 *
 * Requires `conversations.assign` and that the caller can SEE the conversation
 * (business-scope confinement); unknown, foreign and invisible are one `404`.
 * The list is the SET form of `assigneeEligibility` (active person, tenant-wide
 * `conversations.update`, covers the conversation's scope if confined) — never
 * a directory: an ineligible colleague is absent, exactly like one who does not
 * exist. Keyset-paginated, `display name` + id only. The assignment endpoint
 * stays the authority and re-checks at write time.
 */
export const GET = defineTenantRoute<EligibleStaffQuery>({
  workClass: "interactive",
  prepare: ({ url }) => {
    const disabled = disabledResponse();

    if (disabled) return disabled;

    const query = validateEligibleStaffQuery(url.searchParams);

    return query.valid
      ? query.value
      : fail(400, "VALIDATION_ERROR", "Query is invalid.", {}, query.errors);
  },
  authorize: OMNICHANNEL_INBOX_GUARDS.assignConversations,
  handler: async (context) => {
    const refused = personOnlyRefusal(context.auth);

    if (refused) return refused;

    const id = asUuid(context.params.id);

    if (!id) return badId();

    const { tx, tenantId, now } = context;
    const visible = await getVisibleConversationScope(
      tx,
      tenantId,
      id,
      await visibilityFor(context, OMNICHANNEL_INBOX_GUARDS.assignConversations)
    );

    if (!visible) return notFound("Conversation");

    // A withdrawn customer's conversation cannot be assigned: offer nobody.
    if (!visible.reachable) return ok({ items: [], nextCursor: null });

    return ok(
      await listEligibleStaff(
        tx,
        tenantId,
        { permissionKey: ASSIGNEE_PERMISSION_KEY, scope: visible.scope },
        context.prepared,
        now,
        officeScopeHierarchyPortAdapter
      )
    );
  }
});
