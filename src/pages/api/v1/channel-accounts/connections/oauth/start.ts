import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import {
  auditChannelAccounts,
  authorizeRequestedScope,
  commonRefusal,
  readValidatedBody,
  secretStoreUnavailable
} from "../../../../../../modules/channel-accounts/application/channel-accounts-route-support";
import { startOAuthGrant } from "../../../../../../modules/channel-accounts/application/connection-directory";
import { defaultSecretStore } from "../../../../../../modules/channel-accounts/application/secret-store";
import { CHANNEL_ACCOUNTS_GUARDS } from "../../../../../../modules/channel-accounts/domain/channel-accounts-constants";
import {
  validateOAuthStart,
  type OAuthStartInput
} from "../../../../../../modules/channel-accounts/domain/channel-accounts-validation";

/**
 * `POST /api/v1/channel-accounts/connections/oauth/start` (Issue #1140,
 * threat T1) — begins an OAuth 2.0 authorisation for a provider. Creates a
 * single-use `state` (256 random bits, stored only as a SHA-256, bound to this
 * tenant and this person, valid for 10 minutes) and, where the provider offers
 * PKCE, an S256 challenge whose verifier is held server-side as ciphertext. The
 * redirect URI is this deployment's own fixed callback and is NOT an input.
 * Returns the provider's authorisation URL for the browser to visit.
 *
 * Refused with `PROVIDER_ADAPTER_UNAVAILABLE` for a provider whose connector is
 * not installed: this module does not guess a provider's authorisation endpoint.
 * Not idempotency-keyed: each call deliberately mints a fresh state, and the
 * number of unconsumed states per person is capped.
 */
export const POST = defineTenantRoute<OAuthStartInput>({
  workClass: "interactive",
  prepare: async ({ request }) =>
    readValidatedBody(request, validateOAuthStart),
  authorize: CHANNEL_ACCOUNTS_GUARDS.connect,
  handler: async (context) => {
    const refused = commonRefusal(context.auth);

    if (refused) return refused;

    const unavailable = secretStoreUnavailable();

    if (unavailable) return unavailable;

    // The scope the client names is a request, not a fact (ADR-0148 review M3).
    const scopeRefusal = await authorizeRequestedScope(
      context,
      CHANNEL_ACCOUNTS_GUARDS.connect,
      context.prepared.businessScope
    );

    if (scopeRefusal) return scopeRefusal;

    const { tx, tenantId, auth, prepared, now } = context;
    const result = await startOAuthGrant(
      tx,
      defaultSecretStore,
      tenantId,
      auth.context.tenantUserId,
      prepared,
      now
    );

    if (result.outcome === "refused") {
      return fail(
        result.code === "TOO_MANY_PENDING" ? 429 : 422,
        result.code,
        "The authorisation cannot be started."
      );
    }

    await auditChannelAccounts(context, {
      action: "channel_accounts.oauth.start",
      resourceType: "channel_connection",
      resourceId: null,
      severity: "info",
      message: "Provider authorisation started.",
      attributes: {
        provider: prepared.provider,
        scopeCount: prepared.scopes.length
      }
    });

    return ok({
      authorizationUrl: result.authorizationUrl,
      expiresAt: result.expiresAt
    });
  }
});
