import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import { revokeDelegatedAccess } from "../../../../../modules/identity-access/application/delegated-access-store";

/**
 * `DELETE /api/v1/access/delegated-grants/{id}` — ADR-0090, Gelombang 8 PR 8.4.
 *
 * Revocation, and it is the reason the whole model is shaped the way it is: the
 * grant dies, the membership it printed goes inactive, and every session on it
 * is revoked — one transaction, no ordering that can leave one of the three
 * behind.
 *
 * Guarded by `assign` rather than an action of its own. Granting and taking
 * back are one authority; splitting them produces the one combination that must
 * not exist — somebody who can let a partner in and cannot put them out.
 */
const ASSIGN_GUARD = {
  moduleKey: "identity_access",
  activityCode: "partner_access",
  action: "assign"
} as const;

const MAX_REASON_LENGTH = 500;

export const DELETE = defineTenantRoute({
  workClass: "interactive",
  authorize: ASSIGN_GUARD,
  handler: async ({ tx, tenantId, auth, params, url, now, locals }) => {
    const grantId = params.id;
    if (!grantId) {
      return fail(400, "VALIDATION_ERROR", "Grant id is required.");
    }

    const rawReason = url.searchParams.get("reason");
    if (rawReason !== null && rawReason.length > MAX_REASON_LENGTH) {
      return fail(
        400,
        "VALIDATION_ERROR",
        `reason must be at most ${MAX_REASON_LENGTH} characters.`
      );
    }

    const result = await revokeDelegatedAccess(
      tx,
      tenantId,
      grantId,
      auth.context.tenantUserId,
      rawReason,
      now
    );

    // Also the answer for a grant that was already revoked. A caller learns
    // "there is nothing live here", which is all they are owed and all they
    // asked for.
    if (!result.revoked) {
      return fail(404, "NOT_FOUND", "No such live delegated-access grant.");
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "identity_access",
      action: "revoke",
      resourceType: "delegated_access_grant",
      resourceId: grantId,
      severity: "critical",
      message:
        "Delegated access revoked; membership deactivated and sessions killed.",
      attributes: rawReason ? { reason: rawReason } : {},
      correlationId: locals.correlationId
    });

    return ok({ revoked: true });
  }
});
