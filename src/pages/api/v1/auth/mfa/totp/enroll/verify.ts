import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../../../lib/database/client";
import { withTenant } from "../../../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../../../lib/auth/session-token";
import { resolveAuthInputs } from "../../../../../../../modules/identity-access/application/access-guard";
import { resolveLoginPolicyConfig } from "../../../../../../../modules/identity-access/application/login-policy";
import { isMfaFeatureEnabled } from "../../../../../../../lib/auth/mfa-config";
import {
  consumeEnrollmentGrant,
  resolveEnrollAuth,
  verifyTotpEnrollment
} from "../../../../../../../modules/identity-access/application/mfa";
import {
  createSessionWithAssurance,
  setSessionCookies
} from "../../../../../../../modules/identity-access/application/mfa-session-assurance";
import { recordAuditEvent } from "../../../../../../../modules/logging/application/audit-log";

const ENROLLMENT_TOKEN_HEADER = "x-awcms-mfa-enrollment-token";

type VerifyEnrollmentBody = { code?: unknown };

/**
 * `POST /api/v1/auth/mfa/totp/enroll/verify` (Issue #184) — confirms the pending
 * secret from `enroll/start` with a live TOTP code, activating the factor and
 * returning 10 single-use recovery codes shown exactly once. Authorized by
 * EITHER a live session OR the enrollment grant. When authorized via the
 * enrollment grant (an identity that had NO session because a tenant policy
 * required MFA at login), the grant is consumed and a fresh `aal2` session is
 * minted — completing the two-step "must enroll" login self-recoverably.
 */
export const POST: APIRoute = async ({ request, cookies, locals }) => {
  if (!isMfaFeatureEnabled()) {
    return fail(
      403,
      "MFA_DISABLED",
      "Multi-factor authentication enrollment is not enabled for this deployment."
    );
  }

  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const enrollmentToken = request.headers.get(ENROLLMENT_TOKEN_HEADER);

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!token && !enrollmentToken)
    return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const body = (await request
    .json()
    .catch(() => null)) as VerifyEnrollmentBody | null;

  if (!body || typeof body.code !== "string") {
    return fail(400, "VALIDATION_ERROR", "code is required.");
  }

  const sql = getDatabaseClient();
  const now = new Date();
  const sessionTokenHash = token ? hashSessionToken(token) : null;
  const policy = resolveLoginPolicyConfig();

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await resolveEnrollAuth(
      tx,
      tenantId,
      sessionTokenHash,
      enrollmentToken,
      now
    );

    if (!auth) {
      return fail(401, "AUTH_REQUIRED", "Session is invalid or expired.");
    }

    const result = await verifyTotpEnrollment(
      tx,
      tenantId,
      auth.identityId,
      body.code as string,
      process.env,
      now
    );

    if (!result.ok) {
      const status =
        result.code === "MFA_ENROLLMENT_NOT_FOUND"
          ? 404
          : result.code === "MFA_INVALID_CODE"
            ? 400
            : 500;

      return fail(
        status,
        result.code,
        result.code === "MFA_ENROLLMENT_NOT_FOUND"
          ? "No pending MFA enrollment found. Start enrollment again."
          : result.code === "MFA_INVALID_CODE"
            ? "Invalid verification code."
            : "Multi-factor authentication is misconfigured on this server."
      );
    }

    await recordAuditEvent(tx, {
      tenantId,
      moduleKey: "identity_access",
      action: "mfa_enrolled",
      resourceType: "identity",
      resourceId: auth.identityId,
      severity: "warning",
      message: "Multi-factor authentication (TOTP) enrolled and activated.",
      correlationId: locals.correlationId
    });

    // Enrolled via the login enrollment grant (no session yet) — consume the
    // grant and mint the real aal2 session now, completing sign-in.
    if (auth.viaEnrollment && auth.enrollmentChallengeId) {
      await consumeEnrollmentGrant(
        tx,
        tenantId,
        auth.enrollmentChallengeId,
        now
      );

      await tx`
        UPDATE awcms_identities
        SET failed_login_count = 0, last_login_at = ${now}
        WHERE id = ${auth.identityId}
      `;

      const created = await createSessionWithAssurance(tx, {
        tenantId,
        identityId: auth.identityId,
        assuranceLevel: "aal2",
        ttlMin: policy.sessionTtlMin,
        now
      });

      setSessionCookies(cookies, tenantId, created.token, policy.sessionTtlMin);

      return ok({
        activated: true,
        recoveryCodes: result.recoveryCodes,
        token: created.token,
        expiresAt: created.expiresAt.toISOString(),
        assuranceLevel: "aal2"
      });
    }

    return ok({ activated: true, recoveryCodes: result.recoveryCodes });
  });
};
