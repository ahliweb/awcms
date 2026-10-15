import type { APIRoute } from "astro";

import { clearPrincipalLockoutForIdentity } from "../../../../../../../modules/identity-access/application/principal-store";
import { fail, ok } from "../../../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../../../lib/database/client";
import { withTenant } from "../../../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../../../lib/auth/session-token";
import { resolveAuthInputs } from "../../../../../../../modules/identity-access/application/access-guard";
import { resolveLoginPolicyConfig } from "../../../../../../../modules/identity-access/application/login-policy";
import {
  isMfaFeatureEnabled,
  resolveMfaRateLimitMax,
  resolveMfaRateLimitWindowSec
} from "../../../../../../../lib/auth/mfa-config";
import { checkAuthRateLimit } from "../../../../../../../lib/security/auth-rate-limit";
import { checkSharedRateLimit } from "../../../../../../../lib/security/rate-limit";
import {
  consumeEnrollmentGrant,
  enrollmentBindingHash,
  resolveEnrollAuth,
  verifyTotpEnrollment
} from "../../../../../../../modules/identity-access/application/mfa";
import {
  createSessionWithAssurance,
  setSessionCookies
} from "../../../../../../../modules/identity-access/application/mfa-session-assurance";
import { recordAuditEvent } from "../../../../../../../modules/logging/application/audit-log";
import { createEmailAuthNotificationAdapter } from "../../../../../../../modules/email/application/auth-notification-port-adapter";
import { notifyMfaChange } from "../../../../../../../modules/identity-access/application/mfa-security-notice";
import { log } from "../../../../../../../lib/logging/logger";
import {
  hashClientIp,
  persistableClientIpHash,
  summarizeUserAgent
} from "../../../../../../../lib/security/client-fingerprint";
import { resolveClientIp } from "../../../../../../../lib/security/rate-limit";

const ENROLLMENT_TOKEN_HEADER = "x-awcms-mfa-enrollment-token";

function tooManyVerifyAttempts(retryAfterSec: number): Response {
  return fail(
    429,
    "RATE_LIMITED",
    "Too many verification attempts. Try again later.",
    {},
    undefined,
    { "retry-after": String(retryAfterSec) }
  );
}

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
export const POST: APIRoute = async ({
  request,
  cookies,
  locals,
  clientAddress
}) => {
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

  // Same two ceilings as the login MFA challenge (`totp/verify`): per
  // session/grant - the thing being attacked, which rotating addresses does not
  // escape - and per source (and tenant). The HOLDER bucket is spent first; the
  // source bucket only once the credential is known to be real, below, so junk
  // tokens cannot burn a shared address's allowance (#1004 re-audit L1).
  const clientIp = resolveClientIp(request, clientAddress);
  const rateMax = resolveMfaRateLimitMax();
  const windowMs = resolveMfaRateLimitWindowSec() * 1000;
  const holder = token
    ? hashSessionToken(token)
    : enrollmentBindingHash(`grant-token:${enrollmentToken}`);
  const holderLimit = await checkSharedRateLimit(
    `auth-mfa-enroll-verify:${holder}`,
    {
      // Twice the source ceiling: a person who exhausts a pending secret (5
      // wrong codes) must still be able to start over and confirm in the window.
      maxAttempts: rateMax * 2,
      windowMs
    }
  );

  if (!holderLimit.allowed)
    return tooManyVerifyAttempts(holderLimit.retryAfterSec);

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

    const sourceLimit = await checkAuthRateLimit({
      clientIp,
      tenantId,
      scope: "mfa-enroll-verify",
      config: { maxAttempts: rateMax, windowMs }
    });

    if (!sourceLimit.allowed) {
      return tooManyVerifyAttempts(sourceLimit.retryAfterSec);
    }

    const result = await verifyTotpEnrollment(
      tx,
      tenantId,
      auth.identityId,
      body.code as string,
      process.env,
      now,
      auth.bindingHash
    );

    if (!result.ok) {
      if (result.code === "MFA_ENROLLMENT_EXHAUSTED") {
        await recordAuditEvent(tx, {
          tenantId,
          moduleKey: "identity_access",
          action: "mfa_enroll_verify_exhausted",
          resourceType: "identity",
          resourceId: auth.identityId,
          severity: "warning",
          message:
            "Pending TOTP enrolment discarded after too many wrong codes.",
          attributes: {
            via: auth.viaEnrollment ? "enrollment_grant" : "session",
            ipHash: hashClientIp(clientIp)
          },
          correlationId: locals.correlationId
        });
      }

      const status =
        result.code === "MFA_ENROLLMENT_NOT_FOUND"
          ? 404
          : result.code === "MFA_ENROLLMENT_EXHAUSTED"
            ? 429
            : result.code === "MFA_INVALID_CODE"
              ? 400
              : 500;

      return fail(
        status,
        result.code,
        result.code === "MFA_ENROLLMENT_NOT_FOUND"
          ? "No pending MFA enrollment found. Start enrollment again."
          : result.code === "MFA_ENROLLMENT_EXHAUSTED"
            ? "Too many wrong codes. This setup was cancelled; start again."
            : result.code === "MFA_INVALID_CODE"
              ? "Invalid verification code."
              : "Multi-factor authentication is misconfigured on this server."
      );
    }

    // Out-of-band notice to the account's own mailbox (#1004): whoever enrolled,
    // the owner is told on a channel the session does not control. Enqueue only;
    // the email dispatcher sends outside any transaction (ADR-0006).
    const notice = await notifyMfaChange(tx, {
      tenantId,
      identityId: auth.identityId,
      kind: "enrolled",
      notifications: createEmailAuthNotificationAdapter(),
      occurredAt: now,
      clientIp,
      correlationId: locals.correlationId
    });

    if (!notice.delivered) {
      log("warning", "identity_access.mfa_enrolment_notice.not_enqueued", {
        moduleKey: "identity_access",
        correlationId: locals.correlationId
      });
    }

    // `critical`, not `warning` (#1004): a first factor is what flips the
    // ADR-0141 gate to satisfied, so this is the event an investigation of a
    // takeover starts from. `notified` records whether anyone was told.
    await recordAuditEvent(tx, {
      tenantId,
      moduleKey: "identity_access",
      action: "mfa_enrolled",
      resourceType: "identity",
      resourceId: auth.identityId,
      severity: "critical",
      message: "Multi-factor authentication (TOTP) enrolled and activated.",
      attributes: {
        via: auth.viaEnrollment ? "enrollment_grant" : "session",
        notified: notice.delivered,
        ipHash: hashClientIp(clientIp),
        userAgent: summarizeUserAgent(request)
      },
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
        SET last_login_at = ${now}
        WHERE id = ${auth.identityId}
      `;

      // ADR-0086 — same obligation as the SSO callback: completing enrolment is
      // a successful authentication, and the counter it must clear is the global
      // one.
      await clearPrincipalLockoutForIdentity(tx, auth.identityId);

      const created = await createSessionWithAssurance(tx, {
        tenantId,
        identityId: auth.identityId,
        assuranceLevel: "aal2",
        ttlMin: policy.sessionTtlMin,
        now,
        issue: {
          originAuth: "password",
          clientIpHash: persistableClientIpHash(
            resolveClientIp(request, clientAddress)
          ),
          userAgentSummary: summarizeUserAgent(request) ?? null
        }
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
