import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import {
  auditChannelAccounts,
  commonRefusal,
  secretStoreUnavailable
} from "../../../../../../modules/channel-accounts/application/channel-accounts-route-support";
import { completeOAuthCallback } from "../../../../../../modules/channel-accounts/application/connection-directory";
import { defaultSecretStore } from "../../../../../../modules/channel-accounts/application/secret-store";
import { CHANNEL_ACCOUNTS_GUARDS } from "../../../../../../modules/channel-accounts/domain/channel-accounts-constants";
import {
  validateOAuthCallbackQuery,
  type OAuthCallbackQuery
} from "../../../../../../modules/channel-accounts/domain/channel-accounts-validation";

/**
 * `GET /api/v1/channel-accounts/connections/oauth/callback` (Issue #1140,
 * threat T1) — the provider's redirect target. A top-level browser navigation,
 * so it carries the signed-in session and is authorised like any other call
 * (`accounts.connect`); it is NOT a public endpoint.
 *
 * The `state` must exist, be unexpired and unconsumed, belong to THIS tenant and
 * to THIS signed-in person, and have been issued against this deployment's own
 * redirect URI. Every failure, replay and cross-tenant or cross-person attempt
 * answers the same `400 STATE_INVALID`. The state is consumed by a
 * compare-and-swap, so two racing callbacks have one winner.
 *
 * It does not exchange the code: that is provider I/O and must not happen inside
 * this transaction (ADR-0148 I10). It leaves a durable hand-off, a `pending`
 * connection holding the authorisation code as ciphertext, for the connector's
 * job to exchange. Neither the code nor the state is echoed in the response,
 * the audit row or any log line.
 */
export const GET = defineTenantRoute<OAuthCallbackQuery>({
  workClass: "interactive",
  prepare: ({ url }) => {
    const query = validateOAuthCallbackQuery(url.searchParams);

    return query.valid
      ? query.value
      : fail(400, "STATE_INVALID", "The authorisation response is invalid.");
  },
  authorize: CHANNEL_ACCOUNTS_GUARDS.connect,
  handler: async (context) => {
    const refused = commonRefusal(context.auth);

    if (refused) return refused;

    const unavailable = secretStoreUnavailable();

    if (unavailable) return unavailable;

    const { tx, tenantId, auth, prepared, now } = context;
    const result = await completeOAuthCallback(
      tx,
      defaultSecretStore,
      tenantId,
      auth.context.tenantUserId,
      {
        stateParam: prepared.state,
        code: prepared.code,
        providerError: prepared.providerError
      },
      now
    );

    if (result.outcome === "refused") {
      return fail(
        400,
        result.code,
        "The authorisation response is invalid or has expired."
      );
    }

    if (result.outcome === "denied_by_provider") {
      await auditChannelAccounts(context, {
        action: "channel_accounts.oauth.denied",
        resourceType: "channel_connection",
        resourceId: null,
        severity: "info",
        message: "Provider authorisation was denied or cancelled."
      });

      return fail(
        403,
        "AUTHORIZATION_DENIED",
        "The provider authorisation was denied or cancelled."
      );
    }

    await auditChannelAccounts(context, {
      action: "channel_accounts.oauth.callback",
      resourceType: "channel_connection",
      resourceId: result.connectionId,
      severity: "warning",
      message: "Provider authorisation verified; awaiting token exchange."
    });

    return ok({
      connectionId: result.connectionId,
      grantState: "pending",
      awaitingExchange: true
    });
  }
});
