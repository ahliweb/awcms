import { ok } from "../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../modules/_shared/tenant-route";
import {
  listSenderPolicies,
  summarizeWhatsappSenders
} from "../../../../modules/whatsapp-delivery/application/whatsapp-sender-directory";
import { loadChannelAccountPort } from "../../../../modules/whatsapp-delivery/infrastructure/channel-account-port-loader";

/**
 * `GET /api/v1/whatsapp/senders` (Issue #1141, ADR-0148 section 4) — the
 * tenant's WhatsApp senders with per-sender diagnostics, and the default-sender
 * policy, in one response from ONE transaction.
 *
 * One entry per sender that has any queue row in the last 35 days, plus the
 * deployment sender (`senderAccountId: null`). Per sender: whether it may send
 * right now (a coarse reason code when it may not), the queue (waiting, in
 * flight, recent failures, oldest waiting, last failure code) and the quota (what
 * it really sent in the trailing hour and day against the caps, and whether it is
 * throttled). The dispatcher stops claiming a throttled sender's rows; nothing
 * is ever rerouted to another sender.
 *
 * Nothing here returns a credential, a secret reference, a phone number or a
 * device id: a sender is its account id. Requires
 * `whatsapp_delivery.senders.read`.
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: {
    moduleKey: "whatsapp_delivery",
    activityCode: "senders",
    action: "read"
  },
  handler: async ({ tx, tenantId }) => {
    let senders = null;

    try {
      senders = await loadChannelAccountPort();
    } catch {
      // A module import, not a query: every sender then reads as unavailable,
      // which is the fail-closed answer.
      senders = null;
    }

    // Sequential: `tx` is ONE reserved connection.
    const policies = await listSenderPolicies(tx, tenantId);
    const diagnostics = await summarizeWhatsappSenders(tx, tenantId, senders);

    return ok({ senders: diagnostics, policies });
  }
});
