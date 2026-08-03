import type { APIRoute } from "astro";

import { getDatabaseClient } from "../../../../../lib/database/client";
import {
  hashClientIp,
  summarizeUserAgent
} from "../../../../../lib/security/client-fingerprint";
import {
  checkSharedRateLimit,
  resolveClientIp
} from "../../../../../lib/security/rate-limit";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import {
  enforceTurnstileIfRequired,
  PASSWORD_RESET_TURNSTILE_ACTION
} from "../../../../../lib/security/turnstile";
import { fail, ok } from "../../../../../modules/_shared/api-response";
import { completePasswordReset } from "../../../../../modules/identity-access/application/password-reset";
import { withPublicAuthTenant } from "../../../../../modules/identity-access/application/public-auth-tenant";
import { validateCompleteResetInput } from "../../../../../modules/identity-access/domain/password-reset-validation";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";

const RATE_LIMIT_MAX_ATTEMPTS = Number(
  process.env.AUTH_PASSWORD_RESET_RATE_LIMIT_MAX ?? 5
);
const RATE_LIMIT_WINDOW_SEC = Number(
  process.env.AUTH_PASSWORD_RESET_RATE_LIMIT_WINDOW_SEC ?? 900
);

const GENERIC_INVALID_TOKEN_MESSAGE =
  "This password reset link is invalid or has expired.";

/**
 * `POST /api/v1/auth/password/reset` (Wave 2 delta auth, adapted from
 * awcms-micro Issue #496).
 *
 * The mirror image of `forgot.ts`: that endpoint refuses to distinguish its
 * successes, this one refuses to distinguish its failures. Not-found, expired,
 * already-used, deactivated-since-issue and SSO-only all return the same
 * `PASSWORD_RESET_INVALID`, so the endpoint cannot be used to fingerprint the
 * state of a token someone is holding. The audit event records the specific
 * reason.
 *
 * On success the password is replaced, the lockout counters are cleared, the
 * token is burned, and EVERY session of that identity is revoked — see
 * `application/session-revocation.ts` for why that last one is not optional.
 *
 * Not routed through `defineTenantRoute`: there is no session to authorize.
 */
export const POST: APIRoute = async ({ request, clientAddress, locals }) => {
  const tenantId = request.headers.get("x-awcms-tenant-id");

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  // Rate limit before touching the database: this endpoint lets a caller guess
  // at a token, so it is bounded like login's credential-guessing surface.
  const clientIp = resolveClientIp(request, clientAddress);
  const rateLimit = await checkSharedRateLimit(
    `${clientIp}:${tenantId}:password-reset`,
    {
      maxAttempts: RATE_LIMIT_MAX_ATTEMPTS,
      windowMs: RATE_LIMIT_WINDOW_SEC * 1000
    }
  );

  if (!rateLimit.allowed) {
    return fail(
      429,
      "RATE_LIMITED",
      "Too many password reset attempts from this source. Try again later.",
      {},
      undefined,
      { "retry-after": String(rateLimit.retryAfterSec) }
    );
  }

  const bodyRead = await readJsonBody(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const rawBody = bodyRead.value;
  const validation = validateCompleteResetInput(rawBody);

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "token and newPassword are required.",
      {},
      validation.errors
    );
  }

  // Full-online only (Issue #186): a no-op on every local/offline/LAN
  // deployment, and cheaper than the argon2id hash + DB mutation below when it
  // does apply.
  const turnstileResult = await enforceTurnstileIfRequired(
    (rawBody as Record<string, unknown> | null)?.turnstileToken,
    clientIp,
    { action: PASSWORD_RESET_TURNSTILE_ACTION }
  );

  if (!turnstileResult.ok) {
    return fail(
      400,
      turnstileResult.code,
      turnstileResult.code === "TURNSTILE_REQUIRED"
        ? "Turnstile verification token is required."
        : "Turnstile verification failed."
    );
  }

  const sql = getDatabaseClient();
  const now = new Date();
  const correlationId = locals.correlationId;
  const source = {
    ipHash: hashClientIp(clientIp),
    userAgent: summarizeUserAgent(request)
  };

  return withPublicAuthTenant(
    sql,
    tenantId,
    { workClass: "interactive" },
    async (tx) => {
      const result = await completePasswordReset(
        tx,
        tenantId,
        validation.value.token,
        validation.value.newPassword,
        now
      );

      if (result.outcome === "invalid") {
        await recordAuditEvent(tx, {
          tenantId,
          moduleKey: "identity_access",
          action: "password_reset_failed",
          resourceType: "identity",
          severity: "warning",
          message: `Password reset attempt failed: ${result.reason}.`,
          attributes: { reason: result.reason, ...source },
          correlationId
        });

        // Returned from INSIDE the transaction, which COMMITS — deliberately.
        // The audit row above is the record of a failed redemption attempt and
        // must survive; nothing else was mutated on this path.
        return fail(
          400,
          "PASSWORD_RESET_INVALID",
          GENERIC_INVALID_TOKEN_MESSAGE
        );
      }

      await recordAuditEvent(tx, {
        tenantId,
        moduleKey: "identity_access",
        action: "password_reset_completed",
        resourceType: "identity",
        resourceId: result.identityId,
        severity: "warning",
        message: "Password reset completed; all sessions revoked.",
        attributes: source,
        correlationId
      });

      return ok({ reset: true });
    }
  );
};
