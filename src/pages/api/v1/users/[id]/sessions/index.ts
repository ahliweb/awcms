import {
  fail,
  jsonResponse
} from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { listSessionsForTenantUser } from "../../../../../../modules/identity-access/application/admin-session-directory";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `GET /api/v1/users/{id}/sessions` (Gelombang 2 PR 2.2 of #423) — where is
 * this tenant user signed in?
 *
 * ## Why this is the SENSITIVE half of the pair
 *
 * `identity_access.user_sessions.read` is a standing window into a colleague's
 * movements — when they sign in, from how many device shapes, at what hours.
 * The revoke endpoint beside it destroys access instead of disclosing anything,
 * which is why the two are separate permissions and why an incident responder
 * can be given the second without the first. `admin-session-directory.ts`
 * records the full argument.
 *
 * ## `private, no-store`, on every path including the refusals
 *
 * The body describes live credentials of a named person. A 404 gets the header
 * too — a cache that stores the refusal and not the answer is still a cache
 * holding a statement about somebody's account.
 */
const NO_STORE_HEADERS = { "cache-control": "private, no-store" };

export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: {
    moduleKey: "identity_access",
    activityCode: "user_sessions",
    action: "read"
  },
  handler: async ({ tx, tenantId, params, tokenHash, now }) => {
    const tenantUserId = params.id ?? "";

    // Shape-checked before the query, and answered as 404 rather than 400: a
    // malformed id and an id belonging to another tenant should be
    // indistinguishable, or the endpoint becomes a probe for which ids exist.
    if (!UUID_PATTERN.test(tenantUserId)) {
      return fail(
        404,
        "NOT_FOUND",
        "No such tenant user.",
        {},
        undefined,
        NO_STORE_HEADERS
      );
    }

    const result = await listSessionsForTenantUser(
      tx,
      tenantId,
      tenantUserId,
      tokenHash,
      now
    );

    if (result.outcome === "not_found") {
      return fail(
        404,
        "NOT_FOUND",
        "No such tenant user.",
        {},
        undefined,
        NO_STORE_HEADERS
      );
    }

    return jsonResponse(
      { success: true, data: { sessions: result.sessions }, meta: {} },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  }
});
