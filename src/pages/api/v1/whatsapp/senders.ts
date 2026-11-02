import { ok } from "../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../modules/_shared/tenant-route";
import {
  listSenderPolicies,
  summarizeWhatsappSenders,
  type SenderDiagnostics,
  type SenderPolicyView
} from "../../../../modules/whatsapp-delivery/application/whatsapp-sender-directory";
import { loadSenderAccess } from "../../../../modules/whatsapp-delivery/infrastructure/channel-account-access-loader";
import { loadChannelAccountPort } from "../../../../modules/whatsapp-delivery/infrastructure/channel-account-port-loader";

const GUARD = {
  moduleKey: "whatsapp_delivery",
  activityCode: "senders",
  action: "read"
} as const;

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
 *
 * Only what the caller may see (Issue #1233 M1), by the rules of
 * `channel_accounts`: an account the caller is not assigned to (when it has
 * assignees), or whose business scope the caller does not hold, is left out; a
 * caller confined to business scopes does not get the tenant-wide deployment
 * lane or the tenant-wide policy; a policy whose scope the caller does not hold,
 * or that names a sender the caller cannot see, is left out. Default-deny: when
 * the channel module cannot be loaded nothing account-related is returned.
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: {
    moduleKey: "whatsapp_delivery",
    activityCode: "senders",
    action: "read"
  },
  handler: async (context) => {
    const { tx, tenantId } = context;
    let senders = null;

    try {
      senders = await loadChannelAccountPort();
    } catch {
      // A module import, not a query: every sender then reads as unavailable,
      // which is the fail-closed answer.
      senders = null;
    }

    const access = await loadSenderAccess();

    // Sequential: `tx` is ONE reserved connection.
    const policies = await listSenderPolicies(tx, tenantId);
    const diagnostics = await summarizeWhatsappSenders(tx, tenantId, senders);
    const confined = access ? await access.isConfined(context) : true;
    const seen = new Map<string, boolean>();
    const canSee = async (accountId: string): Promise<boolean> => {
      if (!access) return false;

      let known = seen.get(accountId);

      if (known === undefined) {
        known = await access.canUseAccount(context, GUARD, accountId, "viewer");
        seen.set(accountId, known);
      }

      return known;
    };
    const visibleSenders: SenderDiagnostics[] = [];

    for (const entry of diagnostics) {
      const allowed =
        entry.senderAccountId === null
          ? !confined
          : await canSee(entry.senderAccountId);

      if (allowed) visibleSenders.push(entry);
    }

    const visiblePolicies: SenderPolicyView[] = [];

    for (const policy of policies) {
      const scopeOk =
        policy.businessScope === null
          ? !confined
          : access !== null &&
            (await access.scopeCovered(context, GUARD, policy.businessScope));
      const senderOk =
        policy.defaultSenderAccountId === null ||
        (await canSee(policy.defaultSenderAccountId));

      if (scopeOk && senderOk) visiblePolicies.push(policy);
    }

    return ok({ senders: visibleSenders, policies: visiblePolicies });
  }
});
