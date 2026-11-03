/**
 * Per-account access for the `social_publishing` routes (Issue #1145). A
 * publishing target IS a `channel_accounts` account, so who may use it, and for
 * which business scope, is decided by `channel_accounts` (assignments,
 * `assignments.assign` bypass, business-scope confinement), not re-invented
 * here. The same shape as `whatsapp_delivery`'s loader (Issue #1233 M1).
 *
 * A lazy import: the channel module is loaded only when a route needs the
 * decision. A failed import is a DENIAL (default-deny): nothing here ever
 * answers "allowed" because a dependency could not be loaded.
 */
import type { TenantRouteHandlerContext } from "../../_shared/tenant-route";
import type { AccessRequest } from "../../identity-access/domain/access-control";
import type { ChannelAssignmentKind } from "../../channel-accounts/domain/channel-accounts-constants";

export type AccountAccessContext = Pick<
  TenantRouteHandlerContext<unknown>,
  "tx" | "tenantId" | "tokenHash" | "auth" | "now" | "request" | "clientAddress"
>;

export type AccountAccessGuard = Pick<
  AccessRequest,
  "moduleKey" | "activityCode" | "action"
>;

export type AccountAccess = {
  /**
   * Whether the caller may see (and, with `minimumKind: "operator"`, act on)
   * this account: it exists in this tenant, the assignment rule lets the caller
   * in, and the account's own business scope is one the caller holds. An unknown
   * id, another tenant's account and an account the caller cannot see are ONE
   * answer: `false`.
   */
  canUseAccount(
    context: AccountAccessContext,
    guard: AccountAccessGuard,
    accountId: string,
    minimumKind: ChannelAssignmentKind
  ): Promise<boolean>;
};

export async function loadAccountAccess(): Promise<AccountAccess | null> {
  try {
    const [support, directory] = await Promise.all([
      import("../../channel-accounts/application/channel-accounts-route-support"),
      import("../../channel-accounts/application/account-directory")
    ]);

    return {
      canUseAccount: async (context, guard, accountId, minimumKind) => {
        const account = await directory.fetchAccountRecord(
          context.tx,
          context.tenantId,
          accountId
        );

        if (!account) return false;

        const visible = await directory.isAccountVisibleTo(
          context.tx,
          context.tenantId,
          accountId,
          context.auth.context.tenantUserId,
          await support.canSeeAllAccounts(context),
          minimumKind
        );

        if (!visible) return false;

        return account.businessScope
          ? support.scopeCoveredFor(context, guard, account.businessScope)
          : true;
      }
    };
  } catch {
    // A module import, not a query: default-deny.
    return null;
  }
}
