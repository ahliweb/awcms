import { created, fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import {
  createSuppression,
  listSuppressions
} from "../../../../../modules/whatsapp-delivery/application/whatsapp-consent-directory";
import { validateSuppressionCreateInput } from "../../../../../modules/whatsapp-delivery/domain/whatsapp-validation";
import { resolveWhatsappDefaultCountryCode } from "../../../../../modules/whatsapp-delivery/domain/whatsapp-config";

/** `GET /api/v1/whatsapp/suppressions` (Issue #963) — masked recipients only; `hasMore` says whether the bounded list was cut. */
export const GET = defineTenantRoute<{ limit: number }>({
  workClass: "interactive",
  prepare: ({ url }) => {
    const raw = (url.searchParams.get("limit") ?? "").trim();
    const limit = raw === "" ? 50 : Number(raw);

    return Number.isInteger(limit) && limit >= 1 && limit <= 200
      ? { limit }
      : fail(
          422,
          "VALIDATION_FAILED",
          "limit must be an integer between 1 and 200."
        );
  },
  authorize: {
    moduleKey: "whatsapp_delivery",
    activityCode: "suppressions",
    action: "read"
  },
  handler: async ({ tx, tenantId, prepared }) => {
    const page = await listSuppressions(tx, tenantId, {
      limit: prepared.limit
    });

    return ok({ entries: page.entries, hasMore: page.hasMore });
  }
});

/**
 * `POST /api/v1/whatsapp/suppressions` (Issue #963) — manual suppression
 * (`manual` or `stop_reply`; `hard_failure` is written only by the dispatcher on
 * a provider verdict, so an operator cannot forge one). Not idempotency-keyed:
 * `ON CONFLICT DO NOTHING` makes a retry a safe no-op that reports the existing
 * entry. Waiting messages to the number are cancelled in the same transaction.
 * The body is validated AFTER authorization so an unauthorised token learns
 * nothing about the schema.
 */
export const POST = defineTenantRoute<{ payload: unknown }>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const read = await readJsonBody(request);

    if (read.tooLarge) {
      return bodyTooLargeResponse(read.limitBytes);
    }

    if (read.malformed) {
      return fail(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
    }

    return { payload: read.value };
  },
  authorize: {
    moduleKey: "whatsapp_delivery",
    activityCode: "suppressions",
    action: "create"
  },
  handler: async ({ tx, tenantId, auth, prepared, locals }) => {
    const validation = validateSuppressionCreateInput(
      prepared.payload,
      resolveWhatsappDefaultCountryCode()
    );

    if (!validation.valid) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "Suppression request is invalid.",
        {},
        validation.errors
      );
    }

    const result = await createSuppression(
      tx,
      tenantId,
      auth.context.tenantUserId,
      validation.value
    );

    if (result.outcome === "misconfigured") {
      return fail(
        503,
        "WHATSAPP_HASH_KEYS_UNAVAILABLE",
        "WhatsApp recipient hashing is not configured on this deployment."
      );
    }

    if (result.outcome === "invalid_phone") {
      return fail(400, "VALIDATION_ERROR", result.reason);
    }

    if (result.outcome === "created") {
      await recordAuditEvent(tx, {
        tenantId,
        actorTenantUserId: auth.context.tenantUserId,
        moduleKey: "whatsapp_delivery",
        action: "whatsapp_suppression.created",
        resourceType: "whatsapp_suppression",
        resourceId: result.entry.id,
        severity: "warning",
        message: `Recipient suppressed: reason=${result.entry.reason}.`,
        attributes: {
          reason: result.entry.reason,
          recipientMasked: result.entry.recipientMasked,
          cancelledMessages: result.cancelledMessages
        },
        correlationId: locals.correlationId
      });

      return created(result.entry);
    }

    return ok({ ...result.entry, alreadySuppressed: true });
  }
});
