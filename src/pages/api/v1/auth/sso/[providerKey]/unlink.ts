import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../../lib/database/client";
import { withTenant } from "../../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../../lib/auth/session-token";
import { resolveAuthInputs } from "../../../../../../modules/identity-access/application/access-guard";
import { requireStepUp } from "../../../../../../modules/identity-access/application/mfa-session-assurance";
import { isSsoEnabled } from "../../../../../../lib/auth/sso-config";
import { unlinkProviderAccount } from "../../../../../../modules/identity-access/application/tenant-sso";
import { fetchAuthProviderRowByKey } from "../../../../../../modules/identity-access/application/auth-provider-directory";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";

/**
 * `POST /api/v1/auth/sso/{providerKey}/unlink` (Issue #185) — authenticated,
 * STEP-UP gated (#184), high-risk self-service action. Never touches local
 * password login — unlinking a provider cannot lock an identity out of its own
 * account (that guarantee is `sso_required` + break-glass enforcement's job,
 * checked at policy-save time). Requiring step-up prevents a stolen aal1 session
 * from silently severing a victim's second login path.
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

    if (!provider) {
      return fail(
        404,
        "SSO_PROVIDER_NOT_FOUND",
        "No SSO provider matches this key."
      );
    }

    const result = await unlinkProviderAccount(
      tx,
      tenantId,
      provider.id,
      identityId
    );

    if (!result.ok) {
      return fail(
        409,
        result.code,
        "No SSO account is currently linked for this identity and provider."
      );
    }

    await recordAuditEvent(tx, {
      tenantId,
      moduleKey: "identity_access",
      action: "sso_account_unlinked",
      resourceType: "identity",
      resourceId: identityId,
      severity: "warning",
      message: `SSO account unlinked (provider: ${providerKey}).`,
      attributes: { providerKey },
      correlationId: locals.correlationId
    });

    return ok({ unlinked: true });
  });
};
