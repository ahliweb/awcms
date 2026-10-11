import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import { deleteSuppression } from "../../../../../modules/whatsapp-delivery/application/whatsapp-consent-directory";
import { isWhatsappRecordId } from "../../../../../modules/whatsapp-delivery/domain/whatsapp-record-id";

/**
 * `DELETE /api/v1/whatsapp/suppressions/{id}` (Issue #963) — a hard delete: a
 * suppression is a live operational flag, not master data with a restore
 * workflow. High-risk (`delete` is) because it RESUMES sending to a number that
 * was stopped, so it is audited at warning severity with the original reason.
 * Not idempotency-keyed: a second call finds nothing and answers 404.
 */
export const DELETE = defineTenantRoute({
  workClass: "interactive",
  authorize: {
    moduleKey: "whatsapp_delivery",
    activityCode: "suppressions",
    action: "delete"
  },
  handler: async ({ tx, tenantId, auth, params, locals }) => {
    const suppressionId = params.id;

    if (!isWhatsappRecordId(suppressionId)) {
      return fail(400, "VALIDATION_FAILED", "Suppression id must be a uuid.");
    }

    const deleted = await deleteSuppression(tx, tenantId, suppressionId);

    if (!deleted) {
      return fail(404, "RESOURCE_NOT_FOUND", "Suppression entry not found.");
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "whatsapp_delivery",
      action: "whatsapp_suppression.deleted",
      resourceType: "whatsapp_suppression",
      resourceId: suppressionId,
      severity: "warning",
      message: `Suppression entry removed: reason=${deleted.reason}.`,
      attributes: { reason: deleted.reason },
      correlationId: locals.correlationId
    });

    return ok({ id: suppressionId, deleted: true });
  }
});
