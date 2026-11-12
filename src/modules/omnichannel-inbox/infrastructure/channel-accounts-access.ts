/**
 * The business-scope rules of the inbox are `channel_accounts`' rules
 * (ADR-0160 section 3): a conversation carries its account's business scope,
 * and who covers which scope, and who is CONFINED, is decided there through
 * the access chokepoint — never re-invented here.
 *
 * Lazy import, like `whatsapp-delivery/infrastructure/channel-account-access-
 * loader.ts`: a failed import is a DENIAL (`null`), never "allowed".
 */
import type { TenantRouteHandlerContext } from "../../_shared/tenant-route";

export type InboxAccessContext = Pick<
  TenantRouteHandlerContext<unknown>,
  "tx" | "tenantId" | "tokenHash" | "auth" | "now" | "request" | "clientAddress"
>;

export type InboxGuard = {
  moduleKey: string;
  activityCode: string;
  action: "read" | "update" | "assign" | "configure";
};

export type ScopeRef = { type: string; id: string };

export type InboxScopeAccess = {
  /** Any active, non-tenant scope assignment that has not ENDED (a not-yet-started one confines too, #1171/#1270). */
  isConfined(context: InboxAccessContext): Promise<boolean>;
  /** The scopes a confined caller covers for `guard`, decided at the chokepoint. Bounded, fail-closed. */
  coveredScopes(
    context: InboxAccessContext,
    guard: InboxGuard
  ): Promise<ScopeRef[]>;
  /** `Response` (403/422) when the caller may not name this scope (or tenant-wide, when confined); `null` to go on. */
  authorizeScope(
    context: InboxAccessContext,
    guard: InboxGuard,
    scope: ScopeRef | null
  ): Promise<Response | null>;
};

export async function loadInboxScopeAccess(): Promise<InboxScopeAccess | null> {
  try {
    const support =
      await import("../../channel-accounts/application/channel-accounts-route-support");

    return {
      isConfined: (context) => support.callerIsScopeConfined(context),
      coveredScopes: (context, guard) =>
        support.coveredScopesFor(context, guard),
      authorizeScope: (context, guard, scope) =>
        support.authorizeRequestedScope(context, guard, scope)
    };
  } catch {
    return null;
  }
}
