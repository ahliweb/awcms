import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../../lib/database/client";
import { withTenant } from "../../../../../../lib/database/tenant-context";
import { TENANT_COOKIE_NAME } from "../../../../../../lib/auth/ssr-session";
import {
  checkRateLimit,
  resolveClientIp
} from "../../../../../../lib/security/rate-limit";
import {
  hashClientIp,
  summarizeUserAgent
} from "../../../../../../lib/security/client-fingerprint";
import {
  resolveMfaRateLimitMax,
  resolveMfaRateLimitWindowSec
} from "../../../../../../lib/auth/mfa-config";
import { resolveLoginPolicyConfig } from "../../../../../../modules/identity-access/application/login-policy";
import { verifyMfaChallenge } from "../../../../../../modules/identity-access/application/mfa";
import {
  createSessionWithAssurance,
  setSessionCookies
} from "../../../../../../modules/identity-access/application/mfa-session-assurance";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";
import { log } from "../../../../../../lib/logging/logger";

type VerifyChallengeBody = {
  mfaChallengeToken?: unknown;
  code?: unknown;
  recoveryCode?: unknown;
};

/**
 * `POST /api/v1/auth/mfa/totp/verify` (Issue #184) — completes a login that
 * `POST /auth/login` paused with `401 MFA_REQUIRED`. Deliberately NOT
 * authenticated via a session (there isn't one yet — that's the point of the
 * challenge); authenticated instead by possession of `mfaChallengeToken`. On
 * success mints the real session at `aal2` (a freshly generated token — the
 * anti-fixation rotation is inherent: no aal1 session ever existed for this
 * login). Public operation (`security: []`).
 *
 * Rate-limited two ways: source+tenant scoped AND per-challenge
 * `failed_attempts` (`verifyMfaChallenge`) — the latter bounds a distributed
 * attacker rotating source IPs against one stolen/guessed challenge token.
 */
export const POST: APIRoute = async ({
  request,
  cookies,
  clientAddress,
  locals
}) => {
  const tenantId =
    request.headers.get("x-awcms-tenant-id") ??
    cookies.get(TENANT_COOKIE_NAME)?.value ??
    null;

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  const rateMax = resolveMfaRateLimitMax();
  const clientIp = resolveClientIp(request, clientAddress);
  const rateLimit = checkRateLimit(`${clientIp}:${tenantId}:mfa-verify`, {
    maxAttempts: rateMax,
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

  const body = (await request
    .json()
    .catch(() => null)) as VerifyChallengeBody | null;

  if (
    !body ||
    typeof body.mfaChallengeToken !== "string" ||
    (typeof body.code !== "string" && typeof body.recoveryCode !== "string")
  ) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "mfaChallengeToken and either code or recoveryCode are required."
    );
  }

  const sql = getDatabaseClient();
  const now = new Date();
  const policy = resolveLoginPolicyConfig();

  return withTenant(sql, tenantId, async (tx) => {
    const result = await verifyMfaChallenge(
      tx,
      tenantId,
      body.mfaChallengeToken as string,
      {
        code: typeof body.code === "string" ? body.code : undefined,
        recoveryCode:
          typeof body.recoveryCode === "string" ? body.recoveryCode : undefined
      },
      process.env,
      rateMax,
      now
    );

    if (!result.ok) {
      const status = result.code === "MFA_MISCONFIGURED" ? 500 : 401;

      // The second factor is the last gate before a session for a caller who
      // already proved the password, so a failure here is a higher-signal
      // brute-force indicator than a plain `login_failed`. No `resourceId`: an
      // invalid/expired/replayed challenge does not resolve to an identity, and
      // the token is never persisted. Skip the audit row for an unknown tenant:
      // `awcms_audit_events.tenant_id` FKs `awcms_tenants`, so writing it would
      // trip the FK and turn the intended 401 into a 500.
      const tenantRows =
        await tx`SELECT 1 FROM awcms_tenants WHERE id = ${tenantId}`;
      if (tenantRows.length === 0) {
        log("warning", "identity_access.mfa_challenge_failed.unknown_tenant", {
          moduleKey: "identity_access",
          reason: result.code
        });
      } else {
        await recordAuditEvent(tx, {
          tenantId,
          moduleKey: "identity_access",
          action: "mfa_challenge_failed",
          resourceType: "identity",
          severity: "warning",
          message: `MFA challenge verification failed: ${result.code}.`,
          attributes: {
            reason: result.code,
            ipHash: hashClientIp(clientIp),
            userAgent: summarizeUserAgent(request)
          },
          correlationId: locals.correlationId
        });
      }

      return fail(
        status,
        result.code,
        result.code === "MFA_MISCONFIGURED"
          ? "Multi-factor authentication is misconfigured on this server."
          : "This MFA challenge is invalid, expired, or already used."
      );
    }

    const identityId = result.identityId;

    await tx`
      UPDATE awcms_identities
      SET failed_login_count = 0, last_login_at = ${now}
      WHERE id = ${identityId}
    `;

    const created = await createSessionWithAssurance(tx, {
      tenantId,
      identityId,
      assuranceLevel: "aal2",
      ttlMin: policy.sessionTtlMin,
      now
    });

    await recordAuditEvent(tx, {
      tenantId,
      moduleKey: "identity_access",
      action: "mfa_challenge_verified",
      resourceType: "identity",
      resourceId: identityId,
      severity: "info",
      message: "MFA challenge verified; aal2 session created.",
      attributes: {
        method: "mfa",
        ipHash: hashClientIp(clientIp),
        userAgent: summarizeUserAgent(request)
      },
      correlationId: locals.correlationId
    });

    setSessionCookies(cookies, tenantId, created.token, policy.sessionTtlMin);

    return ok({
      token: created.token,
      expiresAt: created.expiresAt.toISOString(),
      assuranceLevel: "aal2"
    });
  });
};
