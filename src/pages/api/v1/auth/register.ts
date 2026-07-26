import type { APIRoute } from "astro";

import { getDatabaseClient } from "../../../../lib/database/client";
import { isSelfRegistrationEnabled } from "../../../../lib/auth/self-registration-config";
import {
  hashClientIp,
  summarizeUserAgent
} from "../../../../lib/security/client-fingerprint";
import {
  checkRateLimit,
  resolveClientIp
} from "../../../../lib/security/rate-limit";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../lib/security/request-body-limit";
import {
  enforceTurnstileIfRequired,
  REGISTER_TURNSTILE_ACTION
} from "../../../../lib/security/turnstile";
import { fail, ok } from "../../../../modules/_shared/api-response";
import { withPublicAuthTenant } from "../../../../modules/identity-access/application/public-auth-tenant";
import { submitRegistrationRequest } from "../../../../modules/identity-access/application/self-registration";
import { validateRegistrationInput } from "../../../../modules/identity-access/domain/self-registration-validation";
import { recordAuditEvent } from "../../../../modules/logging/application/audit-log";

const RATE_LIMIT_MAX_ATTEMPTS = Number(
  process.env.AUTH_SELF_REGISTRATION_RATE_LIMIT_MAX ?? 5
);
const RATE_LIMIT_WINDOW_SEC = Number(
  process.env.AUTH_SELF_REGISTRATION_RATE_LIMIT_WINDOW_SEC ?? 900
);

/** The ONE body a well-formed request ever gets back, whatever actually happened. */
const GENERIC_MESSAGE =
  "Thanks — if this address can register, your request is now awaiting review.";

/**
 * `POST /api/v1/auth/register` (Wave 2 delta auth, adapted from awcms-micro).
 *
 * Records a request for review. It NEVER creates an account, never accepts a
 * role or any other privilege field, and never accepts a password — approval
 * creates the account with an unusable credential and emails a claim link (see
 * `application/self-registration.ts`).
 *
 * ## Off by default, and invisibly so
 *
 * `AUTH_SELF_REGISTRATION_ENABLED` gates it, and a disabled deployment answers
 * `404 NOT_FOUND` — the same answer a route that does not exist gives, so the
 * switch is not discoverable by probing.
 *
 * ## Enumeration-safe
 *
 * An address that already has an account, an address with a request already
 * pending, an inactive tenant, and a freshly recorded request all return the
 * identical 200. "This address is already registered" is the single most useful
 * sentence an attacker could be given here, which is exactly why it is never
 * said. The audit event records which it was.
 */
export const POST: APIRoute = async ({ request, clientAddress, locals }) => {
  if (!isSelfRegistrationEnabled()) {
    return fail(404, "NOT_FOUND", "Not found.");
  }

  const tenantId = request.headers.get("x-awcms-tenant-id");

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  // Cheapest rejection first, before any database work — this is a public,
  // unauthenticated endpoint whose accepted calls write a row.
  const clientIp = resolveClientIp(request, clientAddress);
  const rateLimit = checkRateLimit(`${clientIp}:${tenantId}:register`, {
    maxAttempts: RATE_LIMIT_MAX_ATTEMPTS,
    windowMs: RATE_LIMIT_WINDOW_SEC * 1000
  });

  if (!rateLimit.allowed) {
    return fail(
      429,
      "RATE_LIMITED",
      "Too many registration attempts from this source. Try again later.",
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
  const validation = validateRegistrationInput(rawBody);

  if (!validation.valid) {
    // Shape errors ARE returned in detail, and that is not a leak: they
    // describe the submitted body, never anything about the tenant's accounts.
    return fail(
      400,
      "VALIDATION_ERROR",
      "Registration details are invalid.",
      {},
      validation.errors
    );
  }

  const turnstileResult = await enforceTurnstileIfRequired(
    (rawBody as Record<string, unknown> | null)?.turnstileToken,
    clientIp,
    { action: REGISTER_TURNSTILE_ACTION }
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
      const result = await submitRegistrationRequest(
        tx,
        tenantId,
        validation.value
      );

      await recordAuditEvent(tx, {
        tenantId,
        // Unauthenticated: there is no actor tenant_user.
        moduleKey: "identity_access",
        action: "registration_requested",
        resourceType: "registration_request",
        resourceId: result.requestId,
        severity: "info",
        message: `Self-registration submitted: ${result.outcome}.`,
        // The submitted identifier is deliberately absent — it is an email
        // address supplied by an anonymous caller, and persisting it on a
        // rejected submission is the enumeration leak in reverse. The stored
        // ROW holds it when one was created; a miss records only the outcome.
        attributes: { outcome: result.outcome, ...source },
        correlationId
      });

      return ok({ requested: true, message: GENERIC_MESSAGE });
    }
  );
};
