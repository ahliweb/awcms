import { fail, ok } from "../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../modules/_shared/tenant-route";
import {
  isWhatsappMessageStatus,
  listRecentWhatsappAttempts,
  listRecentWhatsappMessages,
  summarizeWhatsappQueue,
  WHATSAPP_MESSAGE_STATUSES,
  type WhatsappMessageStatusValue
} from "../../../../modules/whatsapp-delivery/application/whatsapp-diagnostics";
import {
  isKnownWhatsappProvider,
  isWhatsappEnabled
} from "../../../../modules/whatsapp-delivery/domain/whatsapp-config";

/**
 * `GET /api/v1/whatsapp/diagnostics` (Issue #963) — the tenant's WhatsApp queue
 * in one response: counts per status, the most recent messages and delivery
 * attempts, with recipients MASKED and never the body or variables. One
 * transaction, so the parts share a snapshot (four endpoints could not).
 *
 * `configured` is deployment truth, not tenant state: a queue that is filling
 * while the dispatcher is a no-op looks exactly like a queue that is stuck, and
 * reporting the flag is what lets the screen say "nothing is sending because
 * WhatsApp is off". Neither value is a secret.
 */
export const GET = defineTenantRoute<{
  status?: WhatsappMessageStatusValue;
  limit: number;
}>({
  workClass: "interactive",
  prepare: ({ url }) => {
    const statusParam = (url.searchParams.get("status") ?? "").trim();

    if (statusParam !== "" && !isWhatsappMessageStatus(statusParam)) {
      return fail(
        422,
        "VALIDATION_FAILED",
        `status must be one of: ${WHATSAPP_MESSAGE_STATUSES.join(", ")}.`
      );
    }

    const limitParam = (url.searchParams.get("limit") ?? "").trim();
    const limit = limitParam === "" ? 50 : Number(limitParam);

    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      // Rejected rather than clamped: a caller asking for 1000 rows and
      // silently receiving 200 reads the short list as "that is all there is".
      return fail(
        422,
        "VALIDATION_FAILED",
        "limit must be an integer between 1 and 200."
      );
    }

    return {
      ...(statusParam === "" ? {} : { status: statusParam }),
      limit
    };
  },
  authorize: {
    moduleKey: "whatsapp_delivery",
    activityCode: "messages",
    action: "read"
  },
  handler: async ({ tx, tenantId, prepared }) => {
    // Sequential: `tx` is ONE reserved connection.
    const summary = await summarizeWhatsappQueue(tx, tenantId);
    const list = await listRecentWhatsappMessages(tx, tenantId, {
      ...(prepared.status ? { status: prepared.status } : {}),
      limit: prepared.limit
    });
    const attempts = await listRecentWhatsappAttempts(tx, tenantId, {
      limit: prepared.limit
    });

    return ok({
      summary,
      messages: list.messages,
      hasMoreMessages: list.hasMore,
      attempts,
      configured: {
        enabled: isWhatsappEnabled(),
        provider: isKnownWhatsappProvider(process.env.WHATSAPP_PROVIDER)
          ? process.env.WHATSAPP_PROVIDER
          : null
      }
    });
  }
});
