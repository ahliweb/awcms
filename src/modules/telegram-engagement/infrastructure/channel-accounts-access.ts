/**
 * Per-caller access to a customer bot (ADR-0152 section 3, T-I1), for the ROUTES
 * only. A bot IS a `channel_accounts` account, so who may see or operate it
 * (assignments, the administrator bypass, business-scope ABAC through the same
 * chokepoint) is decided by `channel_accounts`, never re-invented here.
 *
 * Kept apart from `channel-accounts-bridge.ts` so the dispatcher job's import
 * graph never reaches the request-path access chokepoint (and the session,
 * MFA and rate-limit settings it reads).
 */
import type { TenantRouteHandlerContext } from "../../_shared/tenant-route";
import { isAccountVisibleTo } from "../../channel-accounts/application/account-directory";
import {
  canSeeAllAccounts,
  scopeCoveredFor
} from "../../channel-accounts/application/channel-accounts-route-support";
import { fetchBotAccount } from "./channel-accounts-bridge";

export type BotAccessContext = Pick<
  TenantRouteHandlerContext<unknown>,
  "tx" | "tenantId" | "tokenHash" | "auth" | "now" | "request" | "clientAddress"
>;

export type BotAccessGuard = {
  moduleKey: string;
  activityCode: string;
  action: "read" | "configure" | "create" | "delete";
};

/**
 * Whether the caller may see (and with `operator`, act on) this bot account:
 * it is a live telegram bot of this tenant, the assignment rule lets the caller
 * in, and the account's business scope is one the caller holds (re-evaluated
 * through the access chokepoint). Unknown, foreign and invisible are ONE
 * answer: `false` (no IDOR oracle, T-I1).
 */
export async function canUseBotAccount(
  context: BotAccessContext,
  guard: BotAccessGuard,
  accountId: string,
  minimumKind: "viewer" | "operator" | "owner"
): Promise<boolean> {
  const account = await fetchBotAccount(
    context.tx,
    context.tenantId,
    accountId
  );

  if (!account) return false;

  const visible = await isAccountVisibleTo(
    context.tx,
    context.tenantId,
    accountId,
    context.auth.context.tenantUserId,
    await canSeeAllAccounts(context),
    minimumKind
  );

  if (!visible) return false;

  return account.businessScope
    ? scopeCoveredFor(context, guard, account.businessScope)
    : true;
}
