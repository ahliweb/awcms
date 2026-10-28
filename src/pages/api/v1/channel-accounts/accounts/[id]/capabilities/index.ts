import { ok } from "../../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../../modules/_shared/tenant-route";
import { listAccountCapabilities } from "../../../../../../../modules/channel-accounts/application/capability-directory";
import {
  accountNotFound,
  asUuid,
  badId,
  commonRefusal,
  loadAuthorizedAccount
} from "../../../../../../../modules/channel-accounts/application/channel-accounts-route-support";
import { CHANNEL_ACCOUNTS_GUARDS } from "../../../../../../../modules/channel-accounts/domain/channel-accounts-constants";
import { PROVIDER_MATRIX_VERSION } from "../../../../../../../modules/channel-accounts/domain/provider-matrix";

/**
 * `GET /api/v1/channel-accounts/accounts/{id}/capabilities` (Issue #1140,
 * ADR-0148 I2) — all nine capabilities of the account, each with the provider
 * matrix cell, the stored record (`absent` when none: absent means denied) and
 * the EFFECTIVE verdict right now, with the denial code. An unsupported or
 * unevidenced action is reported as denied; nothing here degrades one action
 * into another.
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

    const capabilities = await listAccountCapabilities(
      context.tx,
      context.tenantId,
      id
    );

    return capabilities
      ? ok({ matrixVersion: PROVIDER_MATRIX_VERSION, capabilities })
      : accountNotFound();
  }
});
