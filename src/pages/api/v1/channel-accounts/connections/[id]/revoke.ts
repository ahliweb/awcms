import { fail } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import {
  asUuid,
  auditChannelAccounts,
  badId,
  commonRefusal,
  mayRevokeConnection,
  readIdempotencyKey,
  runIdempotent
} from "../../../../../../modules/channel-accounts/application/channel-accounts-route-support";
import {
  fetchConnection,
  revokeConnection
} from "../../../../../../modules/channel-accounts/application/connection-directory";
import { defaultSecretStore } from "../../../../../../modules/channel-accounts/application/secret-store";
import { CHANNEL_ACCOUNTS_GUARDS } from "../../../../../../modules/channel-accounts/domain/channel-accounts-constants";

type Prepared = { id: string; idempotencyKey: string };

/**
 * `POST /api/v1/channel-accounts/connections/{id}/revoke` (Issue #1140) —
 * revoke a provider connection. The grant becomes `revoked` (terminal), every
 * credential it held (access, refresh, an unexchanged authorisation code, the
 * PKCE verifier) is cleared and its ciphertext deleted, and every account bound
 * to it becomes `revoked`, so nothing can use the old grant on the next claim.
 * It does not call the provider's revoke endpoint (the connector's job); the
 * local half must not depend on the provider being reachable. High-risk:
 * `disconnect` permission, `Idempotency-Key`, audited at `warning`.
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

    // Lock the connection FIRST, then decide: the authority is computed over
    // the state this transaction will act on (audit L2). Revoking revokes EVERY
    // account bound to it, so it needs break-glass authority over the connection
    // (its scope holder, or the tenant administrator) or `owner` authority over
    // each account; one missing = the uniform 404 of an unknown connection, so a
    // foreign account can neither be revoked through it nor veto it (H1).
    const connection = await fetchConnection(tx, tenantId, prepared.id, {
      lock: true
    });

    if (
      !connection ||
      !(await mayRevokeConnection(
        context,
        CHANNEL_ACCOUNTS_GUARDS.disconnect,
        connection
      ))
    ) {
      return fail(404, "RESOURCE_NOT_FOUND", "Connection not found.");
    }

    return runIdempotent(
      tx,
      tenantId,
      "channel_accounts_connection_revoke",
      prepared.idempotencyKey,
      actor,
      { id: prepared.id },
      async () => {
        const result = await revokeConnection(
          tx,
          defaultSecretStore,
          tenantId,
          prepared.id
        );

        if (result.outcome === "not_found") {
          return fail(404, "RESOURCE_NOT_FOUND", "Connection not found.");
        }

        if (result.outcome === "refused") {
          return fail(409, result.code, "The connection is already revoked.");
        }

        await auditChannelAccounts(context, {
          action: "channel_accounts.connection.revoke",
          resourceType: "channel_connection",
          resourceId: prepared.id,
          severity: "warning",
          message: "Provider connection revoked; stored credentials erased.",
          attributes: { accountsRevoked: result.accountsRevoked }
        });

        return {
          status: 200,
          body: {
            connectionId: prepared.id,
            grantState: "revoked",
            accountsRevoked: result.accountsRevoked
          }
        };
      }
    );
  }
});
