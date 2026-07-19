import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../../lib/database/client";
import { withTenant } from "../../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../../lib/auth/session-token";
import { resolveAuthInputs } from "../../../../../../modules/identity-access/application/access-guard";
import { requireStepUp } from "../../../../../../modules/identity-access/application/mfa-session-assurance";
import {
  isSsoEnabled,
  resolveSsoOAuthRequestTtlSec
} from "../../../../../../lib/auth/sso-config";
import {
  buildSsoAuthorizationUrl,
  createSsoOAuthRequest
} from "../../../../../../modules/identity-access/application/tenant-sso";
import { fetchAuthProviderRowByKey } from "../../../../../../modules/identity-access/application/auth-provider-directory";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";

/**
 * `POST /api/v1/auth/sso/{providerKey}/link` (Issue #185) — authenticated AND
 * STEP-UP gated (`requireStepUp`, #184). Account linking is explicit and never
 * auto-links by email: it starts a `link`-purpose OAuth request for the
 * CALLER's own identity (captured server-side from the stepped-up session,
 * never trusted from the eventual callback) and returns the provider's
 * authorization URL as JSON. Requiring a recent second-factor step-up means a
 * stolen aal1 session alone cannot bind an attacker's IdP account to the
 * victim's identity.
 */
export const POST: APIRoute = async ({ request, cookies, params, locals }) => {
  if (!isSsoEnabled()) {
    return fail(
      403,
      "SSO_DISABLED",
      "Tenant OIDC SSO is not enabled for this deployment."
    );
  }

  const providerKey = params.providerKey;

  if (!providerKey) {
    return fail(400, "VALIDATION_ERROR", "providerKey is required.");
  }

  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();

  return withTenant(sql, tenantId, async (tx) => {
    const stepUp = await requireStepUp(tx, tenantId, tokenHash, now);

    if (!stepUp.ok) {
      return stepUp.denied;
    }

    const identityId = stepUp.session.identityId;

    const provider = await fetchAuthProviderRowByKey(tx, tenantId, providerKey);

    if (!provider || !provider.enabled) {
      return fail(
        404,
        "SSO_PROVIDER_NOT_FOUND",
        "No enabled SSO provider matches this key."
      );
    }

    const { state, nonce, codeVerifier } = await createSsoOAuthRequest(tx, {
      tenantId,
      providerId: provider.id,
      purpose: "link",
      identityId,
      redirectAfter: null,
      ttlSec: resolveSsoOAuthRequestTtlSec(),
      now
    });

    const authorizationResult = await buildSsoAuthorizationUrl(
      provider,
      tenantId,
      state,
      nonce,
      codeVerifier
    );

    if (!authorizationResult.ok) {
      return fail(
        502,
        authorizationResult.code,
        "The SSO provider could not be reached. Try again later."
      );
    }

    await recordAuditEvent(tx, {
      tenantId,
      moduleKey: "identity_access",
      action: "sso_account_link_started",
      resourceType: "identity",
      resourceId: identityId,
      severity: "warning",
      message: `SSO account link initiated (provider: ${providerKey}).`,
      attributes: { providerKey },
      correlationId: locals.correlationId
    });

    return ok({ authorizationUrl: authorizationResult.authorizationUrl });
  });
};
