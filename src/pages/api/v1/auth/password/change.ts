import {
  fail,
  jsonResponse
} from "../../../../../modules/_shared/api-response";
import { defineSelfServiceTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { isMachineCredentialToken } from "../../../../../lib/auth/machine-credential-token";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import {
  checkSharedRateLimit,
  resolveClientIp
} from "../../../../../lib/security/rate-limit";
import {
  hashClientIp,
  summarizeUserAgent
} from "../../../../../lib/security/client-fingerprint";
import { changeOwnPassword } from "../../../../../modules/identity-access/application/password-change";
import { validateCredentialChangeInput } from "../../../../../modules/identity-access/domain/credential-change-validation";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";

/**
 * `POST /api/v1/auth/password/change` (Gelombang 2 PR 2.4 of #423) — change my
 * own password while signed in.
 *
 * The counterpart to `reset.ts`: that endpoint serves someone who CANNOT sign in
 * and proves control of a mailbox; this one serves someone who is signed in and
 * proves control of the credential. Self-service and unpermissioned for the same
 * reason as the session endpoints — the subject is the bearer, and there is no
 * parameter with which to name anybody else.
 *
 * ## Second factor only from people who have one
 *
 * `password-change.ts` records the argument in full. In short: requiring `aal2`
 * unconditionally would permanently prevent every user without MFA from changing
 * their password, and the ones most likely to need to are the ones who just
 * learned it leaked.
 *
 * ## Rate limited despite being authenticated
 *
 * `currentPassword` is a guessable secret, so this is a credential-guessing
 * surface even behind a session — the case that matters is a borrowed or stolen
 * session being used to hunt for the password it did not come with. Keyed on the
 * SOURCE, not the account: an identifier-keyed bucket here would let anyone who
 * can reach the endpoint hold one person's own password change hostage.
 *
 * ## Audited, with no password-shaped attribute anywhere
 *
 * A credential change is a security event, so it is recorded like one — with the
 * device shape and IP pseudonym that make an investigation possible, and with
 * neither password, not even a length.
 */
const NO_STORE_HEADERS = { "cache-control": "private, no-store" };

const RATE_LIMIT = { maxAttempts: 5, windowMs: 900_000 };

function authRequired(): Response {
  return fail(
    401,
    "AUTH_REQUIRED",
    "Authentication required.",
    {},
    undefined,
    NO_STORE_HEADERS
  );
}

export const POST = defineSelfServiceTenantRoute({
  workClass: "interactive",
  onUnauthenticated: (reason) =>
    reason === "tenant"
      ? fail(
          400,
          "TENANT_REQUIRED",
          "Tenant header `x-awcms-tenant-id` is required.",
          {},
          undefined,
          NO_STORE_HEADERS
        )
      : authRequired(),
  beforeTransaction: async ({ request, token, clientAddress }) => {
    // A machine credential has no password to change, and ADR-0049 keeps it
    // read-only regardless.
    if (isMachineCredentialToken(token)) return authRequired();

    const clientIp = resolveClientIp(request, clientAddress);
    const rateLimit = await checkSharedRateLimit(
      `auth-password-change:${clientIp}`,
      RATE_LIMIT
    );

    if (rateLimit.allowed) return undefined;

    return fail(
      429,
      "RATE_LIMITED",
      "Too many password change attempts from this source. Try again later.",
      {},
      undefined,
      {
        ...NO_STORE_HEADERS,
        "retry-after": String(rateLimit.retryAfterSec)
      }
    );
  },
  handler: async ({ tx, tenantId, tokenHash, request, clientAddress, now }) => {
    const body = await readJsonBody(request);

    if (body.tooLarge) return bodyTooLargeResponse(body.limitBytes);

    const validation = validateCredentialChangeInput(body.value);

    if (!validation.valid) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "currentPassword and newPassword are required.",
        {},
        validation.errors,
        NO_STORE_HEADERS
      );
    }

    const result = await changeOwnPassword(
      tx,
      tenantId,
      tokenHash,
      validation.value,
      now
    );

    if (result.outcome === "unauthenticated") return authRequired();

    if (result.outcome === "step_up_required") {
      return fail(
        403,
        "STEP_UP_REQUIRED",
        "This action requires recent multi-factor verification. Complete a step-up and retry.",
        {},
        undefined,
        NO_STORE_HEADERS
      );
    }

    if (result.outcome === "password_login_disabled") {
      return fail(
        409,
        "PASSWORD_LOGIN_DISABLED",
        "This account signs in through your identity provider; there is no password to change.",
        {},
        undefined,
        NO_STORE_HEADERS
      );
    }

    const source = {
      ipHash: hashClientIp(resolveClientIp(request, clientAddress)),
      userAgent: summarizeUserAgent(request)
    };

    if (result.outcome === "invalid_credentials") {
      // Audited from INSIDE the transaction, which commits — the same shape
      // `reset.ts` uses for a failed redemption. A wrong current password
      // submitted through a live session is the signal that a session is being
      // used by someone who does not know the credential behind it, and it is
      // worth exactly as much as the successful change below.
      await recordAuditEvent(tx, {
        tenantId,
        moduleKey: "identity_access",
        action: "password_change_failed",
        resourceType: "identity",
        severity: "warning",
        message:
          "Password change attempt failed: currentPassword did not match.",
        attributes: source
      });

      return fail(
        400,
        "INVALID_CREDENTIALS",
        "The current password is incorrect.",
        {},
        undefined,
        NO_STORE_HEADERS
      );
    }

    await recordAuditEvent(tx, {
      tenantId,
      moduleKey: "identity_access",
      action: "password_changed",
      resourceType: "identity",
      resourceId: result.identityId,
      severity: "warning",
      message: `Password changed by its owner; ${result.revokedSessionCount} other session(s) revoked.`,
      attributes: {
        revokedSessionCount: result.revokedSessionCount,
        ...source
      }
    });

    return jsonResponse(
      {
        success: true,
        data: {
          changed: true,
          revokedSessionCount: result.revokedSessionCount
        },
        meta: {}
      },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  }
});
