/**
 * What the channel-account detail screen may say and offer about an account AS A
 * WHATSAPP SENDER (Issue #1154, ADR-0148 section 4).
 *
 * Mirrors the two sender routes it fronts (`GET /whatsapp/senders`, `PUT
 * /whatsapp/sender-policy`) so the screen is never more generous than they are:
 * the same `loadSenderAccess` rules decide whether the caller may act on the
 * account (assignment, `operator` level, its own business scope) and whether a
 * caller confined to business scopes may touch the tenant-wide policy. It is a
 * function in this module, not in the page, so a real database can test it.
 *
 * Counts come from ONE bounded `COUNT` for the one account (the lane index
 * `(tenant_id, sender_account_id, status, ...)` serves it), not from the 35-day
 * tenant-wide aggregate the diagnostics route builds. `null` means "not known
 * to this caller", never zero.
 */
import { hasWhatsappSenderAdapter } from "../infrastructure/whatsapp-sender-providers";
import {
  loadSenderAccess,
  type SenderAccessContext,
  type SenderAccessGuard
} from "../infrastructure/channel-account-access-loader";
import { listSenderPolicies } from "./whatsapp-sender-directory";

const POLICY_GUARD: SenderAccessGuard = {
  moduleKey: "whatsapp_delivery",
  activityCode: "sender_policy",
  action: "configure"
};
const SENDERS_READ_GUARD: SenderAccessGuard = {
  moduleKey: "whatsapp_delivery",
  activityCode: "senders",
  action: "read"
};

export type SenderScreenAccount = {
  id: string;
  provider: string;
  status: string;
  businessScope: { type: string; id: string } | null;
};

export type SenderScreen = {
  hasAdapter: boolean;
  /** The caller holds `sender_policy.configure` through the chokepoint (the action may still be withheld: see `canMakeDefault`). */
  canConfigure: boolean;
  /** Show the "make default" action. */
  canMakeDefault: boolean;
  /** `null` when this caller may not learn it (no read/configure, or a tenant-wide policy hidden from a confined caller). */
  isDefault: boolean | null;
  /** Messages waiting (queued or retrying) for this sender; `null` when the caller may not read sender diagnostics. */
  waiting: number | null;
  sending: number | null;
};

type Can = (request: SenderAccessGuard) => Promise<boolean>;

export async function resolveSenderScreen(
  context: SenderAccessContext,
  account: SenderScreenAccount,
  can: Can,
  guards: { policy: SenderAccessGuard; read: SenderAccessGuard } = {
    policy: POLICY_GUARD,
    read: SENDERS_READ_GUARD
  }
): Promise<SenderScreen> {
  const canConfigure = await can(guards.policy);
  const canRead = await can(guards.read);
  const hasAdapter = hasWhatsappSenderAdapter(account.provider);
  const access = await loadSenderAccess();
  // Default-deny: a dependency that cannot be loaded is a denial.
  const confined = access ? await access.isConfined(context) : true;
  // A tenant-wide account's policy is the tenant-wide policy, which a caller
  // confined to business scopes does not hold (matches `GET /senders`).
  const policyVisible =
    (canConfigure || canRead) && (account.businessScope !== null || !confined);
  const usable =
    canConfigure && access
      ? await access.canUseAccount(
          context,
          guards.policy,
          account.id,
          "operator"
        )
      : false;

  let isDefault: boolean | null = null;

  if (policyVisible) {
    const scope = account.businessScope;

    isDefault = (await listSenderPolicies(context.tx, context.tenantId)).some(
      (policy) =>
        policy.defaultSenderAccountId === account.id &&
        (policy.businessScope?.type ?? null) === (scope?.type ?? null) &&
        (policy.businessScope?.id ?? null) === (scope?.id ?? null)
    );
  }

  let waiting: number | null = null;
  let sending: number | null = null;

  if (
    canRead &&
    (await accountReadable(access, context, account.id, guards.read))
  ) {
    const rows = (await context.tx`
      SELECT count(*) FILTER (WHERE status IN ('queued', 'retry_wait')) AS waiting,
             count(*) FILTER (WHERE status = 'sending') AS sending
      FROM awcms_whatsapp_messages
      WHERE tenant_id = ${context.tenantId}
        AND sender_account_id = ${account.id}
        AND status IN ('queued', 'retry_wait', 'sending')
    `) as { waiting: string | number; sending: string | number }[];

    waiting = Number(rows[0]?.waiting ?? 0);
    sending = Number(rows[0]?.sending ?? 0);
  }

  return {
    hasAdapter,
    canConfigure,
    canMakeDefault:
      canConfigure &&
      hasAdapter &&
      account.status === "connected" &&
      usable &&
      (account.businessScope !== null || !confined),
    isDefault,
    waiting,
    sending
  };
}

/** The sender diagnostics only describe accounts the caller may see (`viewer`), exactly as `GET /senders` filters them. */
async function accountReadable(
  access: Awaited<ReturnType<typeof loadSenderAccess>>,
  context: SenderAccessContext,
  accountId: string,
  guard: SenderAccessGuard
): Promise<boolean> {
  return access
    ? access.canUseAccount(context, guard, accountId, "viewer")
    : false;
}
