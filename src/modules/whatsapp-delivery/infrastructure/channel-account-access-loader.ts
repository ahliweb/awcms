/**
 * Per-account access for the two `whatsapp_delivery` sender routes (Issue #1233
 * M1). A WhatsApp sender IS a `channel_accounts` account, so who may see it, and
 * for which business scope, is decided by `channel_accounts` (assignments,
 * `assignments.assign` bypass, business-scope confinement), not re-invented here.
 *
 * Like `channel-account-port-loader.ts`, this is a lazy import: the channel
 * module is loaded only when a route actually needs the decision. A failed import
 * is a DENIAL (default-deny): nothing here ever answers "allowed" because a
 * dependency could not be loaded.
 */
import type { TenantRouteHandlerContext } from "../../_shared/tenant-route";
import type { ChannelAssignmentKind } from "../../channel-accounts/domain/channel-accounts-constants";

export type SenderAccessContext = Pick<
  TenantRouteHandlerContext<unknown>,
  "tx" | "tenantId" | "tokenHash" | "auth" | "now" | "request" | "clientAddress"
>;

export type SenderAccessGuard = {
  moduleKey: string;
  activityCode: string;
  /** `create`/`restore`: the consent grant route (Issue #1231 M4) names a brand too. */
  action: "read" | "configure" | "create" | "restore";
};

export type SenderAccess = {
  /** `Response` (403 / 422) when the caller may not name this business scope (or tenant-wide, when confined); `null` to go on. Resolves the scope against a real scope of this tenant. */
  authorizeScope(
    context: SenderAccessContext,
    guard: SenderAccessGuard,
    scope: { type: string; id: string } | null
  ): Promise<Response | null>;
  /**
   * Whether the caller may see (and, with `minimumKind: "operator"`, act on)
   * this account: it exists in this tenant, the assignment rule lets the caller
   * in, and the account's own business scope is one the caller holds. An unknown
   * id, another tenant's account and an account the caller cannot see are ONE
   * answer: `false`.
   */
  canUseAccount(
    context: SenderAccessContext,
    guard: SenderAccessGuard,
    accountId: string,
    minimumKind: ChannelAssignmentKind
  ): Promise<boolean>;
  /** Whether the caller holds `scope` through the access chokepoint. */
  scopeCovered(
    context: SenderAccessContext,
    guard: SenderAccessGuard,
    scope: { type: string; id: string }
  ): Promise<boolean>;
  /** Whether the caller's access is confined to business scopes (tenant-wide data is then not theirs). */
  isConfined(context: SenderAccessContext): Promise<boolean>;
};

export async function loadSenderAccess(): Promise<SenderAccess | null> {
  try {
    const [support, directory] = await Promise.all([
      import("../../channel-accounts/application/channel-accounts-route-support"),
      import("../../channel-accounts/application/account-directory")
    ]);

    return {
      authorizeScope: (context, guard, scope) =>
        support.authorizeRequestedScope(context, guard, scope),
      scopeCovered: (context, guard, scope) =>
        support.scopeCoveredFor(context, guard, scope),
      isConfined: (context) => support.callerIsScopeConfined(context),
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
