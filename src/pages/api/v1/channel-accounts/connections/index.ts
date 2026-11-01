import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  commonRefusal,
  filterVisibleConnections
} from "../../../../../modules/channel-accounts/application/channel-accounts-route-support";
import { listConnections } from "../../../../../modules/channel-accounts/application/connection-directory";
import { CHANNEL_ACCOUNTS_GUARDS } from "../../../../../modules/channel-accounts/domain/channel-accounts-constants";

/**
 * `GET /api/v1/channel-accounts/connections` (Issue #1140) — the tenant's
 * provider connections (OAuth grants, API-token and device connections): state,
 * granted scopes, expiry, whether a credential is stored and whether an
 * authorisation code awaits its token exchange. Never a token, an authorisation
 * code, a PKCE verifier or a secret reference. Optional `?provider=`.
 */
export const GET = defineTenantRoute<string | null>({
  workClass: "interactive",
  prepare: ({ url }) => {
    const provider = url.searchParams.get("provider");

    return provider === null || /^[a-z][a-z0-9_]{1,31}$/.test(provider)
      ? provider
      : fail(400, "VALIDATION_ERROR", "provider must be lower snake case.");
  },
  authorize: CHANNEL_ACCOUNTS_GUARDS.read,
  handler: async (context) => {
    const refused = commonRefusal(context.auth);

    if (refused) return refused;

    const connections = await listConnections(
      context.tx,
      context.tenantId,
      context.prepared
    );
    // A connection is never more visible than the authority behind it: listed
    // when the caller holds break-glass authority over it, started it, or may
    // see at least one account bound to it (assignment AND business scope).
    return ok(
      await filterVisibleConnections(
        context,
        CHANNEL_ACCOUNTS_GUARDS.read,
        connections,
        context.prepared
      )
    );
  }
});
