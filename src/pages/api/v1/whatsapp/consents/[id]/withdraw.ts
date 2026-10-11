import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";
import { withdrawMarketingConsent } from "../../../../../../modules/whatsapp-delivery/application/whatsapp-consent-directory";
import { isWhatsappRecordId } from "../../../../../../modules/whatsapp-delivery/domain/whatsapp-record-id";

/**
 * `POST /api/v1/whatsapp/consents/{id}/withdraw` (Issue #963) — record an
 * opt-out. Immediate and wins over everything queued: the recipient's waiting
 * marketing messages are cancelled in the same transaction, and the dispatcher
 * re-checks consent again right before every send. Naturally idempotent
 * (withdrawing a withdrawn consent keeps the original withdrawal stamp).
 * Withdrawing is protective, so it is a separate, lower-friction permission than
 * granting.
 */
export const POST = defineTenantRoute({
  workClass: "interactive",
  authorize: {
    moduleKey: "whatsapp_delivery",
    activityCode: "consents",
    action: "withdraw"
  },
  handler: async ({ tx, tenantId, auth, params, locals }) => {
    const consentId = params.id;

    if (!isWhatsappRecordId(consentId)) {
      return fail(400, "VALIDATION_FAILED", "Consent id must be a uuid.");
    }

    const result = await withdrawMarketingConsent(
      tx,
      tenantId,
      auth.context.tenantUserId,
      consentId,
      { correlationId: locals.correlationId }
    );

    if (result.outcome === "not_found") {
      return fail(404, "RESOURCE_NOT_FOUND", "Consent record not found.");
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "whatsapp_delivery",
      action: "whatsapp_consent.withdrawn",
      resourceType: "whatsapp_consent",
      resourceId: consentId,
      severity: "warning",
      message: "WhatsApp marketing consent withdrawn.",
      attributes: {
        recipientMasked: result.entry.recipientMasked,
        cancelledMessages: result.cancelledMessages
      },
      correlationId: locals.correlationId
    });

    return ok({
      ...result.entry,
      cancelledMessages: result.cancelledMessages
    });
  }
});
