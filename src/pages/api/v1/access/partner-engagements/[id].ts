import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import { severPartner } from "../../../../../modules/identity-access/application/partner-engagement-store";
import { revokeDelegatedAccess } from "../../../../../modules/identity-access/application/delegated-access-store";

/**
 * `DELETE /api/v1/access/partner-engagements/{id}` — ADR-0089/ADR-0090,
 * Gelombang 8 PR 8.4 of #423.
 *
 * The customer severs a partner's reach into their own tenant, and **every
 * live grant under it dies in the same transaction** — memberships deactivated,
 * sessions revoked.
 *
 * That cascade is not politeness. The FK from `awcms_delegated_access_grants`
 * points at this engagement, so deleting the row while a grant still names it
 * FAILS. The ordering is therefore enforced by the database rather than by
 * remembering: there is no path that severs a partnership and leaves live
 * access behind it.
 *
 * `DELETE`, not a soft delete, and ADR-0089 says why: a soft-deleted mapping is
 * a row one bug can bring back to life. What answers "who reached in last
 * March" is the audit trail, which has its own retention.
 */
const CONFIGURE_GUARD = {
  moduleKey: "identity_access",
  activityCode: "partner_access",
  action: "configure"
} as const;

export const DELETE = defineTenantRoute({
  workClass: "interactive",
  authorize: CONFIGURE_GUARD,
  handler: async ({ tx, tenantId, auth, params, now, locals }) => {
    const engagementId = params.id;
    if (!engagementId) {
      return fail(400, "VALIDATION_ERROR", "Engagement id is required.");
    }

    const result = await severPartner(
      tx,
      tenantId,
      engagementId,
      auth.context.tenantUserId,
      now,
      (grantId) =>
        revokeDelegatedAccess(
          tx,
          tenantId,
          grantId,
          auth.context.tenantUserId,
          "partnership severed",
          now
        )
    );

    if (!result.ok) {
      return fail(404, "NOT_FOUND", "No such partner engagement.");
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "identity_access",
      action: "delete",
      resourceType: "partner_engagement",
      resourceId: engagementId,
      // `critical`, not `warning`: this is the action that ENDS another
      // organisation's access, and the count below is what an incident review
      // reads to know how much reach was standing when it happened.
      severity: "critical",
      message: "Partner engagement severed; every live grant under it revoked.",
      attributes: {
        partnerTenantId: result.partnerTenantId,
        revokedGrants: result.revokedGrants
      },
      correlationId: locals.correlationId
    });

    return ok({
      severed: true,
      partnerTenantId: result.partnerTenantId,
      revokedGrants: result.revokedGrants
    });
  }
});
