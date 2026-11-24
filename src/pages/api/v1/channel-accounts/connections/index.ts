import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  commonRefusal,
  filterVisibleConnections
} from "../../../../../modules/channel-accounts/application/channel-accounts-route-support";
import { listConnections } from "../../../../../modules/channel-accounts/application/connection-directory";
import { CHANNEL_ACCOUNTS_GUARDS } from "../../../../../modules/channel-accounts/domain/channel-accounts-constants";
import {
  validateListConnectionsQuery,
  type ListPageQuery
} from "../../../../../modules/channel-accounts/domain/channel-accounts-validation";

/**
 * `GET /api/v1/channel-accounts/connections` (Issue #1140) — the tenant's
 * provider connections (OAuth grants, API-token and device connections): state,
 * granted scopes, expiry, whether a credential is stored and whether an
 * authorisation code awaits its token exchange. Never a token, an authorisation
 * code, a PKCE verifier or a secret reference. Optional `?provider=`; keyset
 * paged (`?limit=` 1-100, `?cursor=`, answer `{ items, nextCursor }`, #1215 N3).
 */
export const GET = defineTenantRoute<ListPageQuery>({
  workClass: "interactive",
  prepare: ({ url }) => {
    const query = validateListConnectionsQuery(url.searchParams);

    return query.valid
      ? query.value
      : fail(400, "VALIDATION_ERROR", "Query is invalid.", {}, query.errors);
  },
  authorize: CHANNEL_ACCOUNTS_GUARDS.read,
  handler: async (context) => {
    const refused = commonRefusal(context.auth);

    if (refused) return refused;

    const result = await listConnections(
      context.tx,
      context.tenantId,
      context.prepared
    );

    if (!result.ok) {
      return fail(400, "VALIDATION_ERROR", "cursor is invalid.");
    }

    // A connection is never more visible than the authority behind it: listed
    // when the caller holds break-glass authority over it, started it, or may
    // see at least one account bound to it (assignment AND business scope). The
    // cursor follows the RAW page, so a page that lost rows here is short but
    // never skips or repeats one.
    return ok({
      items: await filterVisibleConnections(
        context,
        CHANNEL_ACCOUNTS_GUARDS.read,
        result.items
      ),
      nextCursor: result.nextCursor
    });
  }
});
