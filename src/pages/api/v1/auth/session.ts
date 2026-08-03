import { fail, jsonResponse } from "../../../../modules/_shared/api-response";
import { defineSelfServiceTenantRoute } from "../../../../modules/_shared/tenant-route";
import { isMachineCredentialToken } from "../../../../lib/auth/machine-credential-token";
import {
  checkSharedRateLimit,
  resolveClientIp
} from "../../../../lib/security/rate-limit";
import { introspectSession } from "../../../../modules/identity-access/application/session-introspection";

/**
 * `GET /api/v1/auth/session` — cross-origin session introspection (ADR-0045 §3,
 * ADR-0049 §7). Called by `awcms-astro`'s BFF, never by a browser: the BFF holds
 * the `awcms` session token server-side and asks this endpoint what it may show.
 *
 * ## Not a duplicate of `GET /api/v1/auth/me`
 *
 * `me` returns `loginIdentifier` — the raw email — and says nothing about roles,
 * assurance, or expiry. That is precisely inverted from what a public portal
 * header needs. This one returns roles/assurance/expiry/scopes and no raw
 * identifier at all.
 *
 * ## Anti-oracle
 *
 * Missing bearer, unknown token, expired, revoked, deactivated identity, and a
 * machine credential presented here all produce the SAME `401 AUTH_REQUIRED`.
 * A response that distinguished them would turn this endpoint into a probe for
 * session state — and, in the machine-credential case, into a classifier for a
 * bearer someone is holding.
 *
 * ## Never cached
 *
 * `private, no-store` on EVERY path including the failures: this body describes
 * a live session, and any shared cache in front of it would be a cross-user
 * leak.
 */
const NO_STORE_HEADERS = { "cache-control": "private, no-store" };

const RATE_LIMIT = { maxAttempts: 60, windowMs: 60_000 };

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

export const GET = defineSelfServiceTenantRoute({
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
    // A machine credential has no session to introspect. Refused here, before
    // any database work, with the ordinary 401 shape.
    if (isMachineCredentialToken(token)) return authRequired();

    const clientIp = resolveClientIp(request, clientAddress);
    const rateLimit = await checkSharedRateLimit(
      `session-introspect:${clientIp}`,
      RATE_LIMIT
    );

    if (rateLimit.allowed) return undefined;

    return fail(
      429,
      "RATE_LIMITED",
      "Too many introspection requests from this source. Try again later.",
      {},
      undefined,
      {
        ...NO_STORE_HEADERS,
        "retry-after": String(rateLimit.retryAfterSec)
      }
    );
  },
  handler: async ({ tx, tenantId, tokenHash, now }) => {
    const introspection = await introspectSession(tx, tenantId, tokenHash, now);

    if (!introspection) return authRequired();

    return jsonResponse(
      { success: true, data: introspection, meta: {} },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  }
});
