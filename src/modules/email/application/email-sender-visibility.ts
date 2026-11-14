/**
 * Which sender lanes and default-sender policies one caller may see (Issue
 * #1160, ADR-0151 section 2; extracted for Issue #1162 so `GET
 * /api/v1/email/senders` and the `/admin/email-senders` screen apply ONE rule
 * and cannot drift apart).
 *
 * By the rules of `channel_accounts`: an account the caller is not assigned to
 * (when it has assignees), or whose business scope the caller does not hold, is
 * left out; a scope-confined caller does not get the tenant-wide deployment
 * lane or a tenant-wide policy. Default-deny when the channel module cannot be
 * loaded (`access` is `null`).
 */
import type {
  EmailSenderAccess,
  EmailSenderAccessContext,
  EmailSenderAccessGuard
} from "../infrastructure/channel-account-loaders";
import type {
  EmailSenderDiagnostics,
  EmailSenderPolicyView
} from "./email-sender-directory";

export async function filterVisibleEmailSenders(
  context: EmailSenderAccessContext,
  guard: EmailSenderAccessGuard,
  access: EmailSenderAccess | null,
  diagnostics: EmailSenderDiagnostics[],
  policies: EmailSenderPolicyView[]
): Promise<{
  confined: boolean;
  senders: EmailSenderDiagnostics[];
  policies: EmailSenderPolicyView[];
}> {
  const confined = access ? await access.isConfined(context) : true;
  const seen = new Map<string, boolean>();
  const canSee = async (accountId: string): Promise<boolean> => {
    if (!access) return false;

    let known = seen.get(accountId);

    if (known === undefined) {
      known = await access.canUseAccount(context, guard, accountId, "viewer");
      seen.set(accountId, known);
    }

    return known;
  };
  const senders: EmailSenderDiagnostics[] = [];

  for (const entry of diagnostics) {
    const allowed =
      entry.senderAccountId === null
        ? !confined
        : await canSee(entry.senderAccountId);

    if (allowed) senders.push(entry);
  }

  const visiblePolicies: EmailSenderPolicyView[] = [];

  for (const policy of policies) {
    const scopeOk =
      policy.businessScope === null
        ? !confined
        : access !== null &&
          (await access.scopeCovered(context, guard, policy.businessScope));
    const senderOk =
      policy.defaultSenderAccountId === null ||
      (await canSee(policy.defaultSenderAccountId));

    if (scopeOk && senderOk) visiblePolicies.push(policy);
  }

  return { confined, senders, policies: visiblePolicies };
}
