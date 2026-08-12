import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withPublicAuthTenant } from "../../../../../modules/identity-access/application/public-auth-tenant";
import {
  completeSwitchOut,
  loadSwitchSource,
  type SwitchSource
} from "../../../../../modules/identity-access/application/session-switch";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import { resolveLoginPolicyConfig } from "../../../../../modules/identity-access/application/login-policy";
import { evaluateTenantEntry } from "../../../../../modules/identity-access/application/tenant-entry";
import { resolveAuthInputs } from "../../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import {
  createSessionWithAssurance,
  NON_SWITCHABLE_ORIGIN_AUTH,
  type SessionOriginAuth
} from "../../../../../modules/identity-access/application/mfa-session-assurance";
import {
  SESSION_COOKIE_NAME,
  TENANT_COOKIE_NAME
} from "../../../../../lib/auth/ssr-session";
import {
  persistableClientIpHash,
  summarizeUserAgent
} from "../../../../../lib/security/client-fingerprint";
import { resolveClientIp } from "../../../../../lib/security/rate-limit";
import { checkAuthRateLimit } from "../../../../../lib/security/auth-rate-limit";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import { log } from "../../../../../lib/logging/logger";

type SwitchBody = { tenantId?: unknown };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `POST /api/v1/auth/session/switch` — ADR-0088, Gelombang 7 PR 7.4 of #423.
 *
 * Moves a live session to another tenant the same HUMAN belongs to. The source
 * session is revoked and a fresh one is minted in the target: switching leaves,
 * it does not accumulate.
 *
 * ## The non-switchable rule is the reason this endpoint is dangerous
 *
 * A session whose `origin_auth` is `sso` or `handoff` may NOT switch, and the
 * attack it closes is complete takeover with no control violated at any step:
 * the administrator of tenant B's IdP asserts `alice@corp.com` — an address
 * their own IdP is allowed to claim — receives a legitimate tenant B session,
 * and switches into tenant A where the real Alice works.
 *
 * What makes switching safe is the GLOBAL credential: a password verified
 * against `awcms_principals` proves the human, and no tenant can issue one. An
 * IdP assertion proves something far narrower — that one tenant is willing to
 * call you that name. `handoff` is refused for the same reason: it is not
 * evidence of a credential either.
 *
 * ## Assurance does not travel
 *
 * The new session starts at `aal1` even when the source was `aal2`, and the
 * target tenant's MFA policy runs from scratch through `evaluateTenantEntry`.
 * Carrying step-up across a tenant boundary would let a fresh second factor
 * proven to tenant A satisfy tenant B's demand for one.
 */
export const POST: APIRoute = async ({
  request,
  cookies,
  clientAddress,
  locals
}) => {
  const { tenantId: sourceTenantId, token } = resolveAuthInputs(
    request,
    cookies
  );

  if (!sourceTenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const bodyRead = await readJsonBody<SwitchBody>(request);
  if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

  const body = bodyRead.value;

  if (
    !body ||
    typeof body.tenantId !== "string" ||
    !UUID_PATTERN.test(body.tenantId)
  ) {
    return fail(400, "VALIDATION_ERROR", "A uuid tenantId is required.");
  }

  const targetTenantId = body.tenantId;

  if (targetTenantId === sourceTenantId) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Already signed in to that tenant; nothing to switch."
    );
  }

  const policy = resolveLoginPolicyConfig();
  const clientIp = resolveClientIp(request, clientAddress);

  const rateLimit = await checkAuthRateLimit({
    clientIp,
    tenantId: targetTenantId,
    scope: "session-switch",
    config: {
      maxAttempts: policy.rateLimitMaxAttempts,
      windowMs: policy.rateLimitWindowSec * 1000
    }
  });

  if (!rateLimit.allowed) {
    return fail(
      429,
      "RATE_LIMITED",
      "Too many attempts from this source. Try again later.",
      {},
      undefined,
      { "retry-after": String(rateLimit.retryAfterSec) }
    );
  }

  const sql = getDatabaseClient();
  const now = new Date();
  const tokenHash = hashSessionToken(token);

  // Step 1, in the SOURCE tenant's context: who is asking, and is their session
  // allowed to leave? A separate transaction from step 2 because the two run
  // under different tenant contexts, and one `withTenant` sets exactly one. The
  // opening itself lives in the application layer — see `session-switch.ts`.
  let source: SwitchSource | null = null;

  try {
    source = await loadSwitchSource(sql, sourceTenantId, tokenHash, now);
  } catch {
    return fail(503, "DATABASE_BUSY", "Database is busy. Try again shortly.");
  }

  if (!source) {
    return fail(401, "AUTH_REQUIRED", "Session is invalid or expired.");
  }

  if (
    NON_SWITCHABLE_ORIGIN_AUTH.includes(source.originAuth as SessionOriginAuth)
  ) {
    log("warning", "auth.session_switch.refused_non_switchable", {
      moduleKey: "identity_access",
      tenantId: sourceTenantId,
      originAuth: source.originAuth,
      correlationId: locals.correlationId
    });

    return fail(
      403,
      "SESSION_NOT_SWITCHABLE",
      "This session was not issued by a global credential and cannot switch tenants. Sign in with your password to switch."
    );
  }

  // Step 2, in the TARGET tenant's context.
  return withPublicAuthTenant(
    sql,
    targetTenantId,
    { workClass: "interactive" },
    async (tx) => {
      const entry = await evaluateTenantEntry(tx, {
        tenantId: targetTenantId,
        principalId: source.principalId,
        now
      });

      if (!entry.ok) {
        if (entry.kind === "tenant_unavailable") {
          return fail(
            403,
            "TENANT_UNAVAILABLE",
            "This tenant is not currently being served."
          );
        }

        if (entry.kind === "password_login_disabled") {
          return fail(
            403,
            "PASSWORD_LOGIN_DISABLED",
            "Password sign-in is disabled for this account by tenant policy. Use single sign-on."
          );
        }

        if (entry.kind === "mfa_challenge") {
          return fail(
            401,
            "MFA_REQUIRED",
            "Multi-factor authentication is required to complete the switch.",
            {},
            {
              mfaChallengeToken: entry.token,
              expiresAt: entry.expiresAt.toISOString()
            }
          );
        }

        if (entry.kind === "mfa_enrollment") {
          return fail(
            401,
            "MFA_ENROLLMENT_REQUIRED",
            "Multi-factor authentication enrollment is required before the switch can complete.",
            {},
            {
              mfaEnrollmentToken: entry.token,
              expiresAt: entry.expiresAt.toISOString()
            }
          );
        }

        // ONE shape for "you do not belong there", so this endpoint cannot be
        // used to ask whether a colleague belongs to a tenant you name.
        return fail(404, "MEMBERSHIP_NOT_FOUND", "No membership to switch to.");
      }

      const created = await createSessionWithAssurance(tx, {
        tenantId: targetTenantId,
        identityId: entry.identityId,
        assuranceLevel: "aal1",
        ttlMin: policy.sessionTtlMin,
        now,
        issue: {
          // The fourth `origin_auth` value, produced for the first time here —
          // `sql/100` reserved it and `sql/115` widened the CHECK for it. A
          // `switch` session is password-rooted by construction, because the
          // two origins that are not were refused above.
          originAuth: "switch",
          clientIpHash: persistableClientIpHash(clientIp),
          userAgentSummary: summarizeUserAgent(request) ?? null
        }
      });

      await recordAuditEvent(tx, {
        tenantId: targetTenantId,
        moduleKey: "identity_access",
        action: "session_tenant_switched_in",
        resourceType: "identity",
        resourceId: entry.identityId,
        severity: "info",
        message: "Session switched in from another tenant.",
        // The SOURCE tenant is deliberately absent. Telling tenant B which
        // tenant this person came from would hand it a membership fact about
        // somebody it only employs part-time — the same disclosure ADR-0087
        // refused to make in the other direction.
        attributes: { method: "switch" },
        correlationId: locals.correlationId
      });

      const cookieOptions = {
        httpOnly: true,
        sameSite: "lax" as const,
        path: "/",
        maxAge: policy.sessionTtlMin * 60,
        secure: process.env.AUTH_COOKIE_SECURE === "true"
      };

      cookies.set(SESSION_COOKIE_NAME, created.token, cookieOptions);
      cookies.set(TENANT_COOKIE_NAME, targetTenantId, cookieOptions);

      return ok({
        token: created.token,
        expiresAt: created.expiresAt.toISOString(),
        tenantId: targetTenantId
      });
    }
  ).then(async (response) => {
    // The source session is revoked only once the target session EXISTS, and
    // only on success. Revoking first would strand a person in no tenant at all
    // whenever the target refuses them — the failure mode of a switch must be
    // "you are still where you were", never "you are nowhere".
    if (response.status === 200) {
      try {
        await completeSwitchOut(sql, {
          tenantId: sourceTenantId,
          sessionId: source!.sessionId,
          now,
          correlationId: locals.correlationId
        });
      } catch {
        // The new session is already live and the old one expires on its own
        // TTL, so this is degraded rather than broken: loud in the log, and
        // never a reason to fail a switch that already succeeded.
        log("warning", "auth.session_switch.source_revoke_failed", {
          moduleKey: "identity_access",
          tenantId: sourceTenantId,
          correlationId: locals.correlationId
        });
      }
    }

    return response;
  });
};
