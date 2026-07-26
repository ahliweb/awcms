import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { rejectRegistrationRequest } from "../../../../../modules/identity-access/application/self-registration";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";

/**
 * `POST /api/v1/registration-requests/{id}/reject` (Wave 2 delta auth).
 *
 * Closes a pending request. Creates nothing, notifies nobody — a rejection
 * email would confirm to an anonymous submitter that this tenant exists and
 * reviewed them, which is the enumeration answer `/api/v1/auth/register`
 * refuses to give in the first place.
 *
 * A separate permission from `approve` on purpose: clearing spam and admitting
 * a person are different authorities, and default-deny belongs on the
 * consequential one.
 */
export const POST = defineTenantRoute({
  workClass: "interactive",
  prepare: ({ params }) => {
    const requestId = params.id;

    if (!requestId) {
      return fail(400, "VALIDATION_ERROR", "Request id is required.");
    }

    return { requestId };
  },
  authorize: {
    moduleKey: "identity_access",
    activityCode: "registration_requests",
    action: "reject"
  },
  handler: async ({ tx, tenantId, auth, prepared, locals }) => {
    const result = await rejectRegistrationRequest(
      tx,
      tenantId,
      prepared.requestId,
      auth.context.tenantUserId,
      new Date()
    );

    if (result.outcome === "not_found") {
      return fail(404, "NOT_FOUND", "No pending registration request found.");
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "identity_access",
      action: "registration_rejected",
      resourceType: "registration_request",
      resourceId: result.requestId,
      severity: "info",
      message: "Self-registration rejected; no account created.",
      correlationId: locals.correlationId
    });

    return ok({ rejected: true });
  }
});
