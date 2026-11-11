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
 *
 * Tenant-wide by design (Issue #1231 M4, option (c)): one withdrawal ends the
 * opt-in for EVERY brand the row listed and the unscoped one; there is no
 * per-brand withdrawal, and none is offered, because narrowing an opt-out is the
 * unsafe direction. The brands it ended are kept in the audit record.
 *
 * NOT business-scope confined, on purpose (#1231 audit L-2): a caller confined
 * to brand A may record the opt-out of a person who also opted in for brand B,
 * because an opt-out is the person's decision about the whole tenant and
 * honouring it can only stop messages. The permission `consents.withdraw` is
 * still required, and the route-level `authorize` goes through the access
 * chokepoint, which writes the allow/deny row to `awcms_abac_decision_logs`.
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
        cancelledMessages: result.cancelledMessages,
        withdrawnBusinessScopes: result.withdrawnBusinessScopes
      },
      correlationId: locals.correlationId
    });

    return ok({
      ...result.entry,
      cancelledMessages: result.cancelledMessages
    });
  }
});
