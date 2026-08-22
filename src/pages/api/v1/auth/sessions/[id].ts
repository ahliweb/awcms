import {
  fail,
  jsonResponse
} from "../../../../../modules/_shared/api-response";
import { defineSelfServiceTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { isMachineCredentialToken } from "../../../../../lib/auth/machine-credential-token";
import {
  checkSharedRateLimit,
  resolveClientIp
} from "../../../../../lib/security/rate-limit";
import { revokeOwnSession } from "../../../../../modules/identity-access/application/session-directory";

/**
 * `DELETE /api/v1/auth/sessions/{id}` — end a session that is not this one.
 *
 * Self-service and unpermissioned for the same reason as the list beside it:
 * the subject is the caller, and the route cannot be pointed at anybody else.
 * Ownership is enforced in the `WHERE` clause of the UPDATE, not by a preceding
 * read.
 *
 * ## One 404 for four different situations
 *
 * Unknown id, another person's session, another tenant's session, and one
 * already revoked or expired all answer `404 NOT_FOUND`. Distinguishing them
 * would turn this into an existence oracle for session ids across the whole
 * deployment — and the caller can do nothing differently with the distinction
 * anyway.
 *
 * ## Revoking the CURRENT session is refused
 *
 * `409`, not a silent success. Ending the session you are holding is
 * `POST /auth/logout`, which also clears the cookies; doing it here would leave
 * the caller authenticated by a dead token with no bookkeeping. The refusal
 * names the alternative rather than merely denying.
 */
const NO_STORE_HEADERS = { "cache-control": "private, no-store" };

const RATE_LIMIT = { maxAttempts: 30, windowMs: 60_000 };

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

export const DELETE = defineSelfServiceTenantRoute({
  // ADR-0073 — see `revoke-all.ts`: ending a session can only take access
  // away, and the suspended tenant is exactly the one that may need to.
  allowedWhileTenantSuspended:
    "Revocation only ever removes access; refusing it would protect a stolen session.",
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
    if (isMachineCredentialToken(token)) return authRequired();

    const clientIp = resolveClientIp(request, clientAddress);
    const rateLimit = await checkSharedRateLimit(
      `auth-session-revoke:${clientIp}`,
      RATE_LIMIT
    );

    if (rateLimit.allowed) return undefined;

    return fail(
      429,
      "RATE_LIMITED",
      "Too many revocation requests from this source. Try again later.",
      {},
      undefined,
      {
        ...NO_STORE_HEADERS,
        "retry-after": String(rateLimit.retryAfterSec)
      }
    );
  },
  handler: async ({ tx, tenantId, tokenHash, now, params }) => {
    const sessionId = params.id;

    if (typeof sessionId !== "string" || sessionId.length === 0) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "Session id is required.",
        {},
        undefined,
        NO_STORE_HEADERS
      );
    }

    const result = await revokeOwnSession(
      tx,
      tenantId,
      tokenHash,
      sessionId,
      now
    );

    if (result.outcome === "unauthenticated") return authRequired();

    if (result.outcome === "is_current") {
      return fail(
        409,
        "SESSION_IS_CURRENT",
        "This is the session you are using. Use POST /api/v1/auth/logout to end it.",
        {},
        undefined,
        NO_STORE_HEADERS
      );
    }

    if (result.outcome === "not_found") {
      return fail(
        404,
        "NOT_FOUND",
        "Session not found.",
        {},
        undefined,
        NO_STORE_HEADERS
      );
    }

    return jsonResponse(
      { success: true, data: { revoked: true }, meta: {} },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  }
});
