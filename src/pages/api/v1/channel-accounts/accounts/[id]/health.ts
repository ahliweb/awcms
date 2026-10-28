import { ok } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { fetchAccountHealth } from "../../../../../../modules/channel-accounts/application/account-directory";
import {
  asUuid,
  badId,
  commonRefusal,
  loadAuthorizedAccount
} from "../../../../../../modules/channel-accounts/application/channel-accounts-route-support";
import { CHANNEL_ACCOUNTS_GUARDS } from "../../../../../../modules/channel-accounts/domain/channel-accounts-constants";

/**
 * `GET /api/v1/channel-accounts/accounts/{id}/health` (Issue #1140) — the
 * account's status and its latest recorded health (state, a fixed reason code,
 * token expiry, quota). Read-only on purpose: health is REPORTED by a provider
 * connector's check or a dispatch failure, never asserted by a person, so a
 * caller cannot mark a broken account healthy. `health` is `null` until a
 * connector has reported once.
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: CHANNEL_ACCOUNTS_GUARDS.read,
  handler: async (context) => {
    const refused = commonRefusal(context.auth);

    if (refused) return refused;

    const id = asUuid(context.params.id);

    if (!id) return badId();

    const loaded = await loadAuthorizedAccount(
      context,
      id,
      CHANNEL_ACCOUNTS_GUARDS.read
    );

    if ("denied" in loaded) return loaded.denied;

    return ok({
      accountId: id,
      status: loaded.account.status,
      statusReason: loaded.account.statusReason,
      health: await fetchAccountHealth(context.tx, context.tenantId, id)
    });
  }
});
