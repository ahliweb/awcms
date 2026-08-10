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
import { listOwnSessions } from "../../../../../modules/identity-access/application/session-directory";

/**
 * `GET /api/v1/auth/sessions` — where am I signed in? (Gelombang 2 of #423.)
 *
 * ## No permission, deliberately
 *
 * Self-service, exactly like `GET /api/v1/auth/session` and the push-device
 * endpoints: the subject is the caller, and the route never accepts a
 * `tenantUserId` to act on. Inventing a permission for "see your own sessions"
 * would put a wall in front of the feature and, worse, install the latent-authz
 * trap ADR-0058 §E describes — an action nothing seeds denies everyone,
 * including the tenant owner, while the calling code reads as correctly
 * guarded.
 *
 * Listing OTHER people's sessions is a different endpoint and does need a
 * permission. It is not this one.
 *
 * ## What it does not return
 *
 * No token, no token hash, no raw IP, no raw `User-Agent`. `clientIpHash` is a
 * keyed pseudonym and is `null` on a deployment without `AUTH_IP_HASH_SECRET`
 * — the fallback key is per-process, so a stored hash would stop being
 * comparable after a restart and the list would show one device as several.
 * Saying `null` is the honest answer; a wrong grouping is the one that produces
 * a wrong revocation.
 *
 * `current` marks the session making the request, so a person can tell which
 * row is the browser they are looking at.
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
    // A machine credential has no sessions of its own to list.
    if (isMachineCredentialToken(token)) return authRequired();

    const clientIp = resolveClientIp(request, clientAddress);
    const rateLimit = await checkSharedRateLimit(
      `auth-sessions-list:${clientIp}`,
      RATE_LIMIT
    );

    if (rateLimit.allowed) return undefined;

    return fail(
      429,
      "RATE_LIMITED",
      "Too many session requests from this source. Try again later.",
      {},
      undefined,
      {
        ...NO_STORE_HEADERS,
        "retry-after": String(rateLimit.retryAfterSec)
      }
    );
  },
  handler: async ({ tx, tenantId, tokenHash, now }) => {
    const sessions = await listOwnSessions(tx, tenantId, tokenHash, now);

    if (!sessions) return authRequired();

    return jsonResponse(
      { success: true, data: { sessions }, meta: {} },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  }
});
