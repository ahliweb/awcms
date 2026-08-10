import {
  fail,
  jsonResponse
} from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";
import { revokeSessionsForTenantUser } from "../../../../../../modules/identity-access/application/admin-session-directory";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `POST /api/v1/users/{id}/sessions/revoke-all` (Gelombang 2 PR 2.2 of #423) —
 * sign a tenant user out of everywhere.
 *
 * This is the incident control, and `identity_access.user_sessions.revoke` is
 * deliberately grantable WITHOUT `user_sessions.read`: stopping a
 * suspected-compromised account should not cost a standing window into where
 * everyone is signed in. Effective on the next request of every revoked session,
 * because authentication reads the same row — the property an opaque hashed
 * session token buys that a self-contained token cannot.
 *
 * ## No `Idempotency-Key`
 *
 * Unlike the high-risk mutations that mint something, this one is idempotent by
 * construction: the second call finds `revoked_at IS NULL` false everywhere and
 * revokes nothing, reporting `revokedCount: 0`. There is no duplicate to
 * suppress and therefore nothing for a stored response to protect.
 *
 * ## Success is a 200 with a count, never a bare 204
 *
 * "How many sessions did that actually end" is the question an operator asks
 * immediately afterwards, and `keptCallerSession` answers the other one — why
 * their own console still works when they pointed this at themselves.
 */
const NO_STORE_HEADERS = { "cache-control": "private, no-store" };

export const POST = defineTenantRoute({
  workClass: "interactive",
  authorize: {
    moduleKey: "identity_access",
    activityCode: "user_sessions",
    action: "revoke"
  },
  handler: async ({ tx, tenantId, params, auth, tokenHash, now }) => {
    const tenantUserId = params.id ?? "";

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

    const result = await revokeSessionsForTenantUser(
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

    // Audited even when it revoked nothing. "Somebody tried to sign this
    // account out and there was nothing to end" is the entry an investigation
    // wants most, and an audit trail that only records effective actions cannot
    // distinguish it from nobody having looked.
    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "identity_access",
      action: "user_sessions.revoked_all",
      resourceType: "tenant_user",
      resourceId: tenantUserId,
      severity: "warning",
      message: `Revoked ${result.revokedCount} live session(s) for tenant user ${tenantUserId}.`,
      attributes: {
        revokedCount: result.revokedCount,
        keptCallerSession: result.keptCallerSession
      }
    });

    return jsonResponse(
      {
        success: true,
        data: {
          revokedCount: result.revokedCount,
          keptCallerSession: result.keptCallerSession
        },
        meta: {}
      },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  }
});
