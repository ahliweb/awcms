import type { APIRoute } from "astro";

import { getDatabaseClient } from "../../../../../lib/database/client";
import { log } from "../../../../../lib/logging/logger";
import {
  hashClientIp,
  summarizeUserAgent
} from "../../../../../lib/security/client-fingerprint";
import { resolveClientIp } from "../../../../../lib/security/rate-limit";
import { checkAuthRateLimit } from "../../../../../lib/security/auth-rate-limit";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import {
  enforceTurnstileIfRequired,
  PASSWORD_RESET_TURNSTILE_ACTION
} from "../../../../../lib/security/turnstile";
import { fail, ok } from "../../../../../modules/_shared/api-response";
import { createEmailAuthNotificationAdapter } from "../../../../../modules/email/application/auth-notification-port-adapter";
import { requestPasswordReset } from "../../../../../modules/identity-access/application/password-reset";
import { withPublicAuthTenant } from "../../../../../modules/identity-access/application/public-auth-tenant";
import { validateForgotIdentifierInput } from "../../../../../modules/identity-access/domain/password-reset-validation";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import { resolveDeclaredBaseUrl } from "../../../../../lib/http/site-origin";

const TOKEN_TTL_MIN = Number(
  process.env.AUTH_PASSWORD_RESET_TOKEN_TTL_MIN ?? 30
);
const RATE_LIMIT_MAX_ATTEMPTS = Number(
  process.env.AUTH_PASSWORD_RESET_RATE_LIMIT_MAX ?? 5
);
const RATE_LIMIT_WINDOW_SEC = Number(
  process.env.AUTH_PASSWORD_RESET_RATE_LIMIT_WINDOW_SEC ?? 900
);

/**
 * The ONE body this endpoint ever returns on a well-formed request. Success,
 * unknown identifier, inactive account, SSO-only identity and a tenant with no
 * email template all produce this exact response.
 */
const GENERIC_MESSAGE =
  "If an account exists for that identifier, password reset instructions have been sent.";

/**
 * `POST /api/v1/auth/password/forgot` (Wave 2 delta auth, adapted from
 * awcms-micro Issue #496).
 *
 * Account-enumeration-safe by construction: the response never varies with what
 * the server found. This is `login.ts`'s "generalize the deny reason" precedent
 * (see `identity-access/README.md`) applied to a 200 instead of a 401.
 *
 * The AUDIT event does record which case occurred, and that asymmetry is the
 * point: `awcms_audit_events` is tenant-scoped and RLS-protected, readable only
 * by operators who can already read `awcms_identities` directly, so it leaks
 * nothing to them — while an unauditable recovery endpoint would leave
 * enumeration sweeps and misconfigured tenants equally invisible.
 *
 * Not routed through `defineTenantRoute`: there is no session to authorize.
 * See `application/public-auth-tenant.ts` for why the opening lives there.
 */
export const POST: APIRoute = async ({ request, clientAddress, locals }) => {
  const tenantId = request.headers.get("x-awcms-tenant-id");

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  // Rate limit before touching the database — same "cheapest rejection first"
  // ordering as `login.ts`. This endpoint is public, unauthenticated, and each
  // accepted call costs a DB write plus an email enqueue.
  const clientIp = resolveClientIp(request, clientAddress);
  const rateLimit = await checkAuthRateLimit({
    clientIp,
    tenantId,
    scope: "password-forgot",
    config: {
      maxAttempts: RATE_LIMIT_MAX_ATTEMPTS,
      windowMs: RATE_LIMIT_WINDOW_SEC * 1000
    }
  });

  if (!rateLimit.allowed) {
    return fail(
      429,
      "RATE_LIMITED",
      "Too many password reset requests from this source. Try again later.",
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
  const validation = validateForgotIdentifierInput(rawBody);

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "loginIdentifier is required.",
      {},
      validation.errors
    );
  }

  // Full-online only (Issue #186): a no-op on every local/offline/LAN
  // deployment, and cheaper than the DB write + enqueue below when it does
  // apply — so it is verified before either.
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
  const appUrl = resolveDeclaredBaseUrl();
  const source = {
    ipHash: hashClientIp(clientIp),
    userAgent: summarizeUserAgent(request)
  };

  return withPublicAuthTenant(
    sql,
    tenantId,
    { workClass: "interactive" },
    async (tx) => {
      const result = await requestPasswordReset(
        tx,
        tenantId,
        validation.value.loginIdentifier,
        now,
        {
          tokenTtlMinutes: TOKEN_TTL_MIN,
          resetUrlBase: `${appUrl}/reset-password`,
          notifications: createEmailAuthNotificationAdapter(),
          correlationId
        }
      );

      // A tenant that never seeded its `auth.password_reset` template has a
      // recovery flow that silently reaches nobody. That is an operator
      // problem, not a caller problem, so it is loud in the logs and invisible
      // in the response.
      if (result.outcome === "delivery_unavailable") {
        log("warning", "identity_access.password_reset.delivery_unavailable", {
          moduleKey: "identity_access",
          correlationId
        });
      }

      await recordAuditEvent(tx, {
        tenantId,
        // No `actorTenantUserId`: this is an unauthenticated self-service
        // request. `result.identityId` is an identity id, not a tenant_user id,
        // so it belongs in `resourceId`, not that field.
        moduleKey: "identity_access",
        action: "password_reset_requested",
        resourceType: "identity",
        resourceId: result.identityId,
        severity:
          result.outcome === "delivery_unavailable" ? "warning" : "info",
        message: `Password reset requested: ${result.outcome}.`,
        // `loginIdentifier` is deliberately absent — it is typically an email
        // address, and persisting an attacker-supplied one on a miss is exactly
        // the leak this endpoint's generic response exists to prevent. Same
        // rule `login.ts`'s audit context follows.
        attributes: { outcome: result.outcome, ...source },
        correlationId
      });

      return ok({ requested: true, message: GENERIC_MESSAGE });
    }
  );
};
