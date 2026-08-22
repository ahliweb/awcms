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
import { revokeOtherOwnSessions } from "../../../../../modules/identity-access/application/session-directory";

/**
 * `POST /api/v1/auth/sessions/revoke-all` — sign me out everywhere else
 * (Gelombang 2 PR 2.3 of #423).
 *
 * ## No permission, and no `exceptCurrent` flag
 *
 * Self-service for the same reason as the two endpoints beside it: the subject
 * is the session bearer and there is no parameter with which to name anybody
 * else. It is also the one people reach for after "I think my password leaked",
 * which is precisely when a permission wall is most expensive.
 *
 * The program plan drafted `?exceptCurrent=true`. It ships without the flag —
 * see `revokeOtherOwnSessions` for why a boolean whose other value duplicates
 * `POST /auth/logout` (badly) is better expressed as no boolean at all.
 *
 * ## Not audited here, deliberately
 *
 * `awcms_audit_events` records what ADMINISTRATORS do to other people; the
 * paired admin endpoint `POST /api/v1/users/{id}/sessions/revoke-all` writes
 * one. A person tidying up their own sessions is not an administrative act on
 * anybody, and logging every self-service cleanup would fill the trail an
 * investigator reads with entries about people acting on themselves.
 *
 * ## Rate limited on the source, not the subject
 *
 * Same shape as the list and single-revoke routes. The bound is low because
 * there is no legitimate reason to call this in a loop — the second call in a
 * row necessarily revokes nothing.
 */
const NO_STORE_HEADERS = { "cache-control": "private, no-store" };

const RATE_LIMIT = { maxAttempts: 10, windowMs: 60_000 };

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
  // ADR-0073 — sign-out only ever REMOVES access. A suspended tenant that
  // cannot sign itself out everywhere is a suspension that protects a stolen
  // session, which is the opposite of what suspension is for.
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
    // A machine credential has no sessions of its own to end.
    if (isMachineCredentialToken(token)) return authRequired();

    const clientIp = resolveClientIp(request, clientAddress);
    const rateLimit = await checkSharedRateLimit(
      `auth-sessions-revoke-all:${clientIp}`,
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
  handler: async ({ tx, tenantId, tokenHash, now }) => {
    const result = await revokeOtherOwnSessions(tx, tenantId, tokenHash, now);

    if (result.outcome === "unauthenticated") return authRequired();

    // A count, not a bare 204: "it says it worked but am I still signed in on
    // my phone" is the immediate next question, and zero is a real answer
    // (there was nothing else) rather than a failure.
    return jsonResponse(
      { success: true, data: { revokedCount: result.revokedCount }, meta: {} },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  }
});
