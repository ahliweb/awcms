import { ok } from "../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../modules/_shared/tenant-route";
import {
  listEmailSenderPolicies,
  summarizeEmailSenders,
  type EmailSenderDiagnostics,
  type EmailSenderPolicyView
} from "../../../../modules/email/application/email-sender-directory";
import { isEmailSenderRoutingEnabled } from "../../../../modules/email/domain/email-sender-config";
import {
  loadEmailSenderAccess,
  tryLoadEmailSenderPort
} from "../../../../modules/email/infrastructure/channel-account-loaders";

const GUARD = {
  moduleKey: "email",
  activityCode: "senders",
  action: "read"
} as const;

/**
 * `GET /api/v1/email/senders` (Issue #1160, ADR-0151 section 2) — the tenant's
 * email senders with per-sender diagnostics, and the default-sender policy, in
 * one response from ONE transaction. The twin of `GET /api/v1/whatsapp/senders`.
 *
 * One entry per sender that has any queue row in the last 35 days, plus the
 * deployment sender (`senderAccountId: null`). Per sender: whether it may send
 * right now (a coarse reason code when it may not), the queue (waiting, in
 * flight, recent failures, oldest waiting) and the hourly quota. Nothing here
 * returns a credential, a secret reference or a recipient. Requires
 * `email.senders.read`.
 *
 * Only what the caller may see, by the rules of `channel_accounts`: an account
 * the caller is not assigned to (when it has assignees), or whose business scope
 * the caller does not hold, is left out; a scope-confined caller does not get
 * the tenant-wide deployment lane or policy. Default-deny when the channel
 * module cannot be loaded.
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: GUARD,
  handler: async (context) => {
    const { tx, tenantId } = context;
    const senders = await tryLoadEmailSenderPort();
    const access = await loadEmailSenderAccess();

    // Sequential: `tx` is ONE reserved connection.
    const policies = await listEmailSenderPolicies(tx, tenantId);
    const diagnostics = await summarizeEmailSenders(tx, tenantId, senders);
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
    const visibleSenders: EmailSenderDiagnostics[] = [];

    for (const entry of diagnostics) {
      const allowed =
        entry.senderAccountId === null
          ? !confined
          : await canSee(entry.senderAccountId);

      if (allowed) visibleSenders.push(entry);
    }

    const visiblePolicies: EmailSenderPolicyView[] = [];

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

    return ok({
      routingEnabled: isEmailSenderRoutingEnabled(),
      senders: visibleSenders,
      policies: visiblePolicies
    });
  }
});
