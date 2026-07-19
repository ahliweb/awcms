import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import { resolveAuthInputs } from "../../../../../modules/identity-access/application/access-guard";
import {
  checkRateLimit,
  resolveClientIp
} from "../../../../../lib/security/rate-limit";
import {
  hashClientIp,
  summarizeUserAgent
} from "../../../../../lib/security/client-fingerprint";
import {
  resolveMfaRateLimitMax,
  resolveMfaRateLimitWindowSec
} from "../../../../../lib/auth/mfa-config";
import { resolveLoginPolicyConfig } from "../../../../../modules/identity-access/application/login-policy";
import { verifyStepUpFactor } from "../../../../../modules/identity-access/application/mfa";
import {
  resolveSessionAssurance,
  stepUpSession,
  setSessionCookies
} from "../../../../../modules/identity-access/application/mfa-session-assurance";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";

type StepUpBody = { code?: unknown; recoveryCode?: unknown };

/**
 * `POST /api/v1/auth/mfa/step-up` (Issue #184) — raises the current session to
 * `aal2` by re-verifying a second factor, so a subsequent high-risk action
 * passes the `requireStepUp` gate. If the session was `aal1`, it is rotated to
 * a fresh `aal2` token (anti-fixation) and the new token is returned + set as a
 * cookie; if already `aal2`, only the step-up freshness stamp is refreshed.
 */
export const POST: APIRoute = async ({
  request,
  cookies,
  clientAddress,
  locals
}) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const clientIp = resolveClientIp(request, clientAddress);
  const rateLimit = checkRateLimit(`${clientIp}:${tenantId}:mfa-stepup`, {
    maxAttempts: resolveMfaRateLimitMax(),
    windowMs: resolveMfaRateLimitWindowSec() * 1000
  });

  if (!rateLimit.allowed) {
    return fail(
      429,
      "RATE_LIMITED",
      "Too many verification attempts from this source. Try again later.",
      {},
      undefined,
      { "retry-after": String(rateLimit.retryAfterSec) }
    );
  }

  const body = (await request.json().catch(() => null)) as StepUpBody | null;

  if (
    !body ||
    (typeof body.code !== "string" && typeof body.recoveryCode !== "string")
  ) {
    return fail(400, "VALIDATION_ERROR", "code or recoveryCode is required.");
  }

  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const policy = resolveLoginPolicyConfig();

  return withTenant(sql, tenantId, async (tx) => {
    const session = await resolveSessionAssurance(tx, tenantId, tokenHash, now);

    if (!session) {
      return fail(401, "AUTH_REQUIRED", "Session is invalid or expired.");
    }

    const verified = await verifyStepUpFactor(
      tx,
      tenantId,
      session.identityId,
      {
        code: typeof body.code === "string" ? body.code : undefined,
        recoveryCode:
          typeof body.recoveryCode === "string" ? body.recoveryCode : undefined
      },
      process.env,
      now
    );

    if (!verified.ok) {
      const status =
        verified.code === "MFA_MISCONFIGURED"
          ? 500
          : verified.code === "MFA_LOCKED"
            ? 429
            : 400;

      await recordAuditEvent(tx, {
        tenantId,
        moduleKey: "identity_access",
        action: "mfa_step_up_failed",
        resourceType: "identity",
        resourceId: session.identityId,
        severity: "warning",
        message: `MFA step-up failed: ${verified.code}.`,
        attributes: {
          reason: verified.code,
          ipHash: hashClientIp(clientIp),
          userAgent: summarizeUserAgent(request)
        },
        correlationId: locals.correlationId
      });

      return fail(
        status,
        verified.code,
        verified.code === "MFA_NOT_ACTIVE"
          ? "No active multi-factor authentication for this account."
          : verified.code === "MFA_MISCONFIGURED"
            ? "Multi-factor authentication is misconfigured on this server."
            : verified.code === "MFA_LOCKED"
              ? "Too many failed attempts. This factor is temporarily locked."
              : "Invalid verification code."
      );
    }

    const rotation = await stepUpSession(tx, {
      tenantId,
      session,
      ttlMin: policy.sessionTtlMin,
      now
    });

    await recordAuditEvent(tx, {
      tenantId,
      moduleKey: "identity_access",
      action: "mfa_step_up_succeeded",
      resourceType: "identity",
      resourceId: session.identityId,
      severity: "info",
      message: rotation.rotated
        ? "Session stepped up to aal2 (rotated)."
        : "Session step-up refreshed.",
      attributes: {
        rotated: rotation.rotated,
        ipHash: hashClientIp(clientIp),
        userAgent: summarizeUserAgent(request)
      },
      correlationId: locals.correlationId
    });

    if (rotation.rotated) {
      setSessionCookies(
        cookies,
        tenantId,
        rotation.token,
        policy.sessionTtlMin
      );

      return ok({
        assuranceLevel: "aal2",
        rotated: true,
        token: rotation.token,
        expiresAt: rotation.expiresAt.toISOString()
      });
    }

    return ok({
      assuranceLevel: "aal2",
      rotated: false,
      expiresAt: rotation.expiresAt.toISOString()
    });
  });
};
