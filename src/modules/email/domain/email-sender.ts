/**
 * Sender routing rules of `email` (Issue #1160, ADR-0151 sections 2 and 4).
 * Pure: no I/O, no clock, no environment. The twin of
 * `whatsapp-delivery/domain/whatsapp-sender.ts` (Issue #1141), deliberately the
 * same shape so the two channels cannot drift into two different ideas of what
 * a sender is.
 *
 * ## The rules
 *
 * 1. The sender is the one the caller names explicitly, else the prospective
 *    default of the message's business scope, else the deployment sender
 *    (`null`). It is snapshotted on the queue row and never changes (`sql/346`).
 * 2. A sender that cannot send is a REFUSAL. There is no fallback to the
 *    default, to the deployment sender, to another address or to another
 *    Mailketing account, and no rotation across senders to spread volume or to
 *    evade a provider limit, a block or a reputation signal (ADR-0151 M5, M6;
 *    ADR-0148 I4, I5).
 * 3. Security mail (password reset, invitation, security notice) is always the
 *    deployment sender (ADR-0151 Q7): account recovery never depends on a
 *    tenant's credit or verification. The database enforces it too.
 * 4. A tenant sender is usable at dispatch only while its verification and its
 *    account's credit are KNOWN and FRESH: an unknown or stale fact is a hold,
 *    never an assumption that all is well.
 */
import type {
  EmailSenderCapability,
  EmailSenderUnavailableReason
} from "../../_shared/ports/channel-account-port";

/** How a sender was chosen; the value of `awcms_email_messages.sender_selection`. */
export type EmailSenderSelection = "deployment" | "explicit" | "policy";

/** `awcms_email_messages.purpose` (`sql/346`). `marketing` is not admitted until its consent gate exists. */
export type EmailPurpose = "transactional" | "security";

export type EmailBusinessScope = { type: string; id: string };

/** Stored on a row whose tenant sender could not send at dispatch time (the `last_error` prefix). */
export const EMAIL_SENDER_UNAVAILABLE_CODE = "SENDER_UNAVAILABLE";

const SCOPE_TYPE = /^[a-z][a-z0-9_]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isEmailRecordUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** `null` for none; `"invalid"` for a malformed scope, which the caller refuses rather than guessing. */
export function parseEmailBusinessScope(
  value: unknown
): EmailBusinessScope | null | "invalid" {
  if (value === undefined || value === null) return null;

  if (typeof value !== "object" || Array.isArray(value)) return "invalid";

  const { type, id } = value as { type?: unknown; id?: unknown };

  return typeof type === "string" &&
    type.length <= 64 &&
    SCOPE_TYPE.test(type) &&
    isEmailRecordUuid(id)
    ? { type, id: id.toLowerCase() }
    : "invalid";
}

export function sameEmailBusinessScope(
  a: EmailBusinessScope | null,
  b: EmailBusinessScope | null
): boolean {
  return a === null || b === null
    ? a === b
    : a.type === b.type && a.id === b.id;
}

/**
 * A scoped sender may only send for its OWN business scope; a tenant-wide
 * sender may send for any. Exact equality, no hierarchy: the most restrictive
 * reading, the same one `whatsapp_delivery` and `channel_accounts` apply.
 */
export function emailSenderScopeAllows(
  accountScope: EmailBusinessScope | null,
  messageScope: EmailBusinessScope | null
): boolean {
  return (
    accountScope === null || sameEmailBusinessScope(accountScope, messageScope)
  );
}

/**
 * The purpose of a message, from its template category. Classified by the
 * calling module's category at enqueue (ADR-0151 Q8, recommended option): the
 * `auth.*` categories and `system.security_notice` are `security`; everything
 * else this repository enqueues is `transactional`.
 */
export function purposeForEmailCategory(category: string): EmailPurpose {
  return category.startsWith("auth.") || category === "system.security_notice"
    ? "security"
    : "transactional";
}

/** The provider-matrix capability a send of `purpose` needs. */
export function capabilityForEmailPurpose(
  purpose: EmailPurpose
): EmailSenderCapability {
  // Both admitted purposes are business-initiated one-to-one mail. A future
  // `marketing` purpose maps to `broadcast` together with its consent gate.
  return purpose === "security" || purpose === "transactional"
    ? "dm"
    : "broadcast";
}

export type EmailPolicyRow = {
  businessScope: EmailBusinessScope | null;
  defaultSenderAccountId: string | null;
  configVersion: number;
};

/**
 * The policy that applies to a message: its own scope's row when there is one,
 * else the tenant-wide row, else none. A scoped row with a NULL default is a
 * deliberate "deployment sender for this scope" and DOES override a tenant-wide
 * default.
 */
export function pickEmailPolicy(
  policies: readonly EmailPolicyRow[],
  scope: EmailBusinessScope | null
): EmailPolicyRow | null {
  if (scope) {
    const scoped = policies.find(
      (policy) =>
        policy.businessScope !== null &&
        sameEmailBusinessScope(policy.businessScope, scope)
    );

    if (scoped) return scoped;
  }

  return policies.find((policy) => policy.businessScope === null) ?? null;
}

export type EmailSenderChoice = {
  senderAccountId: string | null;
  selection: EmailSenderSelection;
  policyVersion: number | null;
};

/** Pure precedence: explicit, else policy, else deployment. Never a second candidate. */
export function chooseEmailSender(input: {
  explicitSenderAccountId: string | null;
  policy: EmailPolicyRow | null;
}): EmailSenderChoice {
  if (input.explicitSenderAccountId !== null) {
    return {
      senderAccountId: input.explicitSenderAccountId,
      selection: "explicit",
      policyVersion: null
    };
  }

  if (input.policy) {
    return {
      senderAccountId: input.policy.defaultSenderAccountId,
      selection:
        input.policy.defaultSenderAccountId === null ? "deployment" : "policy",
      policyVersion: input.policy.configVersion
    };
  }

  return {
    senderAccountId: null,
    selection: "deployment",
    policyVersion: null
  };
}

/**
 * What the dispatcher does with a claimed row whose tenant sender cannot send.
 *
 * - `terminal`: the sender is gone or was never approved (unknown, another
 *   tenant's, not a Mailketing sender identity, revoked, disabled, its
 *   connection dead, capability not granted). The row FAILS. It is never sent
 *   through anything else.
 * - `hold`: not usable right now for a reason that is not this message's and
 *   may clear (a degraded or pending sender or account, an unverified sender
 *   awaiting the provider, an expired grant, a missing key ring, the control
 *   plane switched off). The row waits, retry count untouched, and fails with a
 *   named reason once the hold budget is spent.
 */
export function classifyEmailSenderUnavailable(
  reason: EmailSenderUnavailableReason
): "terminal" | "hold" {
  switch (reason) {
    case "ACCOUNT_NOT_FOUND":
    case "NOT_AN_EMAIL_SENDER":
    case "NOT_A_WHATSAPP_SENDER":
    case "ACCOUNT_REVOKED":
    case "ACCOUNT_DISABLED":
    case "CAPABILITY_DENIED":
    case "RISK_ACKNOWLEDGEMENT_REQUIRED":
    case "PROVIDER_ADAPTER_DISABLED":
    case "CONNECTION_NOT_ACTIVE":
      return "terminal";
    case "CHANNEL_ACCOUNTS_DISABLED":
    case "CONNECTION_EXPIRED":
    case "ACCOUNT_PENDING":
    case "ACCOUNT_DEGRADED":
    case "CREDENTIAL_UNAVAILABLE":
    case "SECRET_STORE_UNAVAILABLE":
      return "hold";
  }
}

/** The latest `awcms_channel_account_health` facts the dispatcher reads (worker-granted columns only, `sql/348`). */
export type EmailAccountHealthFacts = {
  state: string;
  reasonCode: string | null;
  checkedAt: Date;
  quotaRemaining: number | null;
};

export type EmailSenderHealthHold =
  | "SENDER_VERIFICATION_UNKNOWN"
  | "SENDER_VERIFICATION_STALE"
  | "SENDER_UNVERIFIED"
  | "CREDIT_UNKNOWN"
  | "CREDIT_STALE"
  | "CREDIT_BELOW_THRESHOLD";

/**
 * The freshness gate (ADR-0151 sections 1 and 6, "status stale/unknown", "credit
 * threshold"). `null` lets the send go on; anything else HOLDS the row. Unknown
 * is never treated as fine: no health row, a non-`ok` state, a missing balance or
 * a check older than `maxAgeMs` all hold.
 *
 * - the SENDER's row is the verification the provider reported (`GET /senders`);
 * - the ACCOUNT's row carries the credit balance (`GET /credits`); a balance
 *   below `creditFloor` holds every sender of that account (the 402 path of the
 *   adapter is the second, provider-side, line).
 */
export function evaluateEmailSenderHealth(input: {
  sender: EmailAccountHealthFacts | null;
  account: EmailAccountHealthFacts | null;
  now: Date;
  maxAgeMs: number;
  creditFloor: number;
}): EmailSenderHealthHold | null {
  const { sender, account, now, maxAgeMs, creditFloor } = input;
  const stale = (facts: EmailAccountHealthFacts) =>
    now.getTime() - facts.checkedAt.getTime() > maxAgeMs;

  if (!sender) return "SENDER_VERIFICATION_UNKNOWN";
  if (sender.state !== "ok") {
    return sender.state === "unknown"
      ? "SENDER_VERIFICATION_UNKNOWN"
      : "SENDER_UNVERIFIED";
  }
  if (stale(sender)) return "SENDER_VERIFICATION_STALE";

  if (!account || account.quotaRemaining === null) return "CREDIT_UNKNOWN";
  if (account.state !== "ok") {
    return account.state === "unknown"
      ? "CREDIT_UNKNOWN"
      : "CREDIT_BELOW_THRESHOLD";
  }
  if (stale(account)) return "CREDIT_STALE";
  if (account.quotaRemaining < creditFloor) return "CREDIT_BELOW_THRESHOLD";

  return null;
}

/** The per-connection breaker key: one Mailketing ACCOUNT, never shared with the deployment sender or another tenant (ADR-0151 M9). */
export function emailSenderBreakerKey(espAccountId: string): string {
  return `email-mailketing:account:${espAccountId}`;
}
