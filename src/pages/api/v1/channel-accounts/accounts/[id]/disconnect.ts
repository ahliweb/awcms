import { fail } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { disconnectAccount } from "../../../../../../modules/channel-accounts/application/account-directory";
import {
  accountNotFound,
  asUuid,
  auditChannelAccounts,
  badId,
  commonRefusal,
  loadAuthorizedAccount,
  readIdempotencyKey,
  runIdempotent
} from "../../../../../../modules/channel-accounts/application/channel-accounts-route-support";
import { defaultSecretStore } from "../../../../../../modules/channel-accounts/application/secret-store";
import { CHANNEL_ACCOUNTS_GUARDS } from "../../../../../../modules/channel-accounts/domain/channel-accounts-constants";

type Prepared = { id: string; idempotencyKey: string };

/**
 * `POST /api/v1/channel-accounts/accounts/{id}/disconnect` (Issue #1140) — the
 * account becomes `revoked`, its OWN stored credential is erased (hard delete),
 * and its webhook subscriptions are revoked. Effective on the next use: every
 * capability check reads the status, so nothing sends or publishes as this
 * account again. It does not call the provider (revoking at the provider is the
 * connector's job) and it does not touch a shared connection (revoke the
 * connection for that). High-risk: audited at `warning`, `Idempotency-Key`
 * required.
 */
export const POST = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: ({ request, params }) => {
    const id = asUuid(params.id);

    if (!id) return badId();

    const idempotencyKey = readIdempotencyKey(request);

    return idempotencyKey instanceof Response
      ? idempotencyKey
      : { id, idempotencyKey };
  },
  authorize: CHANNEL_ACCOUNTS_GUARDS.disconnect,
  handler: async (context) => {
    const refused = commonRefusal(context.auth);

    if (refused) return refused;

    const { tx, tenantId, auth, prepared } = context;
    const actor = auth.context.tenantUserId;
    const loaded = await loadAuthorizedAccount(
      context,
      prepared.id,
      CHANNEL_ACCOUNTS_GUARDS.disconnect,
      "owner"
    );

    if ("denied" in loaded) return loaded.denied;

    return runIdempotent(
      tx,
      tenantId,
      "channel_accounts_account_disconnect",
      prepared.idempotencyKey,
      actor,
      { id: prepared.id },
      async () => {
        const result = await disconnectAccount(
          tx,
          defaultSecretStore,
          tenantId,
          actor,
          prepared.id
        );

        if (result.outcome === "not_found") return accountNotFound();
        if (result.outcome === "refused") {
          return fail(409, result.code, "The account is already disconnected.");
        }

        await auditChannelAccounts(context, {
          action: "channel_accounts.account.disconnect",
          resourceType: "channel_account",
          resourceId: prepared.id,
          severity: "warning",
          message: "Channel account disconnected; stored credential erased.",
          attributes: { credentialErased: result.credentialErased }
        });

        return {
          status: 200,
          body: {
            account: result.account,
            credentialErased: result.credentialErased
          }
        };
      }
    );
  }
});
