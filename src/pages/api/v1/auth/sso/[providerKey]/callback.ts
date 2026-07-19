import type { APIRoute } from "astro";

import { fail } from "../../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../../lib/database/client";
import { withTenant } from "../../../../../../lib/database/tenant-context";
import {
  createSessionWithAssurance,
  setSessionCookies
} from "../../../../../../modules/identity-access/application/mfa-session-assurance";
import { resolveLoginPolicyConfig } from "../../../../../../modules/identity-access/application/login-policy";
import { isSsoEnabled } from "../../../../../../lib/auth/sso-config";
import { completeTenantSsoCallback } from "../../../../../../modules/identity-access/application/tenant-sso";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";

/**
 * `GET /api/v1/auth/sso/{providerKey}/callback` (Issue #185) — the IdP's own
 * redirect target: a plain top-level browser navigation, raw JSON error
 * responses (no dedicated error page yet — accepted trade-off). `state`/nonce/
 * PKCE/ID-token are all validated cryptographically before any claim is trusted
 * (`completeTenantSsoCallback`). MFA is always checked before session creation
 * (fail-closed). On success mints an awcms OPAQUE session (never the ID token
 * itself) at `aal1` — an active MFA factor routes through `MFA_REQUIRED` to an
 * aal2 session instead. The post-login redirect is the server-validated
 * same-origin `returnTo` captured at `start`, defaulting to `/admin` (never a
 * client-controlled absolute URL — open-redirect safe).
 */
export const GET: APIRoute = async ({ cookies, url, params, locals }) => {
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

  if (url.searchParams.get("error")) {
    return fail(
      401,
      "SSO_OAUTH_STATE_INVALID",
      "SSO sign-in was cancelled or denied."
    );
  }

  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");

  if (!state) {
    return fail(
      400,
      "SSO_OAUTH_STATE_INVALID",
      "Missing or invalid state parameter."
    );
  }

  const sql = getDatabaseClient();
  const now = new Date();

  const result = await completeTenantSsoCallback(
    sql,
    providerKey,
    state,
    code,
    process.env,
    now
  );

  if (result.outcome === "error") {
    const status =
      result.code === "SSO_PROVIDER_UNAVAILABLE"
        ? 502
        : result.code === "SSO_ALREADY_LINKED"
          ? 409
          : result.code === "ACCESS_DENIED" ||
              result.code === "SSO_PROVIDER_DISABLED"
            ? 403
            : 401;

    return fail(
      status,
      result.code,
      "SSO sign-in could not be completed. Please try again."
    );
  }

  if (result.outcome === "mfa_required") {
    await withTenant(sql, result.tenantId, (tx) =>
      recordAuditEvent(tx, {
        tenantId: result.tenantId,
        moduleKey: "identity_access",
        action: "mfa_challenge_issued",
        resourceType: "identity",
        resourceId: result.identityId,
        severity: "info",
        message: "SSO sign-in verified; MFA challenge issued.",
        attributes: { method: "sso", providerKey },
        correlationId: locals.correlationId
      })
    );

    return fail(
      401,
      "MFA_REQUIRED",
      "Multi-factor authentication is required to complete sign-in.",
      {},
      {
        mfaChallengeToken: result.challengeToken,
        expiresAt: result.challengeExpiresAt.toISOString()
      }
    );
  }

  if (result.outcome === "linked") {
    await withTenant(sql, result.tenantId, (tx) =>
      recordAuditEvent(tx, {
        tenantId: result.tenantId,
        moduleKey: "identity_access",
        action: "sso_account_linked",
        resourceType: "identity",
        resourceId: result.identityId,
        severity: "warning",
        message: `SSO account linked (provider: ${providerKey}).`,
        attributes: { providerKey },
        correlationId: locals.correlationId
      })
    );

    return new Response(null, {
      status: 302,
      headers: { Location: "/admin" }
    });
  }

  const policy = resolveLoginPolicyConfig();

  const mintResult = await withTenant(sql, result.tenantId, async (tx) => {
    await tx`
      UPDATE awcms_identities
      SET failed_login_count = 0, last_login_at = ${now}
      WHERE id = ${result.identityId}
    `;

    const created = await createSessionWithAssurance(tx, {
      tenantId: result.tenantId,
      identityId: result.identityId,
      assuranceLevel: "aal1",
      ttlMin: policy.sessionTtlMin,
      now
    });

    if (result.provisioned) {
      await recordAuditEvent(tx, {
        tenantId: result.tenantId,
        moduleKey: "identity_access",
        action: "sso_identity_provisioned",
        resourceType: "identity",
        resourceId: result.identityId,
        severity: "warning",
        message: `SSO JIT-provisioned a new identity at minimum privilege (provider: ${providerKey}).`,
        attributes: { providerKey },
        correlationId: locals.correlationId
      });
    }

    await recordAuditEvent(tx, {
      tenantId: result.tenantId,
      moduleKey: "identity_access",
      action: "sso_login_succeeded",
      resourceType: "identity",
      resourceId: result.identityId,
      severity: "info",
      message: `SSO sign-in succeeded; session created (provider: ${providerKey}).`,
      attributes: { method: "sso", providerKey },
      correlationId: locals.correlationId
    });

    return created;
  });

  if (mintResult instanceof Response) {
    return mintResult;
  }

  setSessionCookies(
    cookies,
    result.tenantId,
    mintResult.token,
    policy.sessionTtlMin
  );

  return new Response(null, {
    status: 302,
    headers: { Location: result.redirectAfter ?? "/admin" }
  });
};
