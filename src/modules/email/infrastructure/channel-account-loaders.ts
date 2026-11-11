/**
 * The ONE place `email` reaches `channel_accounts` (Issue #1160, ADR-0011,
 * `capabilities.consumes` in `module.ts`). Lazy imports, the same shape as
 * `whatsapp-delivery/infrastructure/channel-account-port-loader.ts` and
 * `channel-account-access-loader.ts`: the channel module is loaded only when a
 * message actually names a tenant-owned sender, a policy points at one, or a
 * sender route is called. The common path, a deployment-sender message, never
 * touches it, which is what keeps today's behaviour byte for byte.
 *
 * This file loads the SENDER-RESOLUTION adapter (no secret) and the per-account
 * ACCESS rules. The CREDENTIAL adapter is composed only by the dispatcher's
 * composition root (`scripts/email-dispatch.ts`), so a request path or a job
 * that only enqueues is never handed the key ring.
 *
 * A failed import is a DENIAL (default-deny): nothing here answers "allowed"
 * because a dependency could not be loaded.
 */
import type { ChannelEmailSenderPort } from "../../_shared/ports/channel-account-port";
import type { TenantRouteHandlerContext } from "../../_shared/tenant-route";
import type { ChannelAssignmentKind } from "../../channel-accounts/domain/channel-accounts-constants";

export async function loadEmailSenderPort(): Promise<ChannelEmailSenderPort> {
  const { channelAccountPortAdapter } =
    await import("../../channel-accounts/application/channel-account-port-adapter");

  return channelAccountPortAdapter;
}

/** `null` when the channel module cannot be loaded (the caller treats that as a refusal). */
export async function tryLoadEmailSenderPort(): Promise<ChannelEmailSenderPort | null> {
  try {
    return await loadEmailSenderPort();
  } catch {
    return null;
  }
}

export type EmailSenderAccessContext = Pick<
  TenantRouteHandlerContext<unknown>,
  "tx" | "tenantId" | "tokenHash" | "auth" | "now" | "request" | "clientAddress"
>;

export type EmailSenderAccessGuard = {
  moduleKey: string;
  activityCode: string;
  action: "read" | "configure" | "use" | "approve";
};

export type EmailSenderAccess = {
  /** `Response` (403 / 422) when the caller may not name this business scope (or tenant-wide, when confined); `null` to go on. */
  authorizeScope(
    context: EmailSenderAccessContext,
    guard: EmailSenderAccessGuard,
    scope: { type: string; id: string } | null
  ): Promise<Response | null>;
  /**
   * Whether the caller may see (and, with `minimumKind: "operator"`, act on)
   * this account: it exists in this tenant, the assignment rule lets the caller
   * in, and the account's own business scope is one the caller holds. An
   * unknown id, another tenant's account and an account the caller cannot see
   * are ONE answer: `false`.
   */
  canUseAccount(
    context: EmailSenderAccessContext,
    guard: EmailSenderAccessGuard,
    accountId: string,
    minimumKind: ChannelAssignmentKind
  ): Promise<boolean>;
  scopeCovered(
    context: EmailSenderAccessContext,
    guard: EmailSenderAccessGuard,
    scope: { type: string; id: string }
  ): Promise<boolean>;
  isConfined(context: EmailSenderAccessContext): Promise<boolean>;
};

/** Per-account access, decided by `channel_accounts` (assignments, scope confinement), never re-invented here. */
export async function loadEmailSenderAccess(): Promise<EmailSenderAccess | null> {
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

/**
 * Issue #1161: the Mailketing callback credential is a `channel_accounts`
 * webhook subscription (ADR-0148, `sql/318`), so its reads and writes are that
 * module's functions, loaded here and nowhere else in `email`. `null` when the
 * module cannot be loaded: the callback route then refuses (default-deny) and
 * the admin routes answer that the feature is unavailable.
 */
export type EmailWebhookSubscriptionDirectory =
  typeof import("../../channel-accounts/application/webhook-subscription-directory");

export async function tryLoadWebhookSubscriptionDirectory(): Promise<EmailWebhookSubscriptionDirectory | null> {
  try {
    return await import("../../channel-accounts/application/webhook-subscription-directory");
  } catch {
    return null;
  }
}
