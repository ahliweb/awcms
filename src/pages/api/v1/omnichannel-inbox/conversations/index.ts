import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { listConversations } from "../../../../../modules/omnichannel-inbox/application/conversation-directory";
import {
  disabledResponse,
  visibilityFor
} from "../../../../../modules/omnichannel-inbox/application/route-support";
import { OMNICHANNEL_INBOX_GUARDS } from "../../../../../modules/omnichannel-inbox/domain/inbox-constants";
import {
  validateListConversationsQuery,
  type ListConversationsQuery
} from "../../../../../modules/omnichannel-inbox/domain/inbox-validation";

/**
 * `GET /api/v1/omnichannel-inbox/conversations` — the conversations the caller
 * may see (ADR-0160 section 3: a scope-confined caller sees only the business
 * scopes they cover, never a tenant-wide conversation), newest inbound first,
 * keyset-paginated, filterable by status, assignee (`me`, `unassigned`, a
 * user id), breached SLA, tag and source kind. Opaque references and states
 * only: never a message body or a customer identifier.
 */
export const GET = defineTenantRoute<ListConversationsQuery>({
  workClass: "interactive",
  prepare: ({ url }) => {
    const disabled = disabledResponse();

    if (disabled) return disabled;

    const query = validateListConversationsQuery(url.searchParams);

    return query.valid
      ? query.value
      : fail(400, "VALIDATION_ERROR", "Query is invalid.", {}, query.errors);
  },
  authorize: OMNICHANNEL_INBOX_GUARDS.readConversations,
  handler: async (context) => {
    const visibility = await visibilityFor(
      context,
      OMNICHANNEL_INBOX_GUARDS.readConversations
    );
    const page = await listConversations(
      context.tx,
      context.tenantId,
      visibility,
      context.auth.context.tenantUserId,
      context.prepared,
      context.now
    );

    return ok(page);
  }
});
