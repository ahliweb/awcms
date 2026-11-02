/**
 * Sender routing rules of `whatsapp_delivery` (Issue #1141, ADR-0148 section 4).
 * Pure: no I/O, no clock, no environment. Everything that needs the database or
 * a provider lives in `application/` and `infrastructure/`; what is decided
 * HERE is the part that must never drift, so it is tested without either.
 *
 * ## What the rules are
 *
 * 1. The sender is named explicitly, else it is the thread's (affinity), else it
 *    is the prospective default of the message's business scope, else it is the
 *    deployment sender (`null`). The result is snapshotted on the queue row and
 *    never changes.
 * 2. A sender that cannot send is a REFUSAL. There is no fallback to the
 *    default, to the deployment sender, to another number or to another
 *    provider. Rotating senders to evade a provider limit is prohibited by
 *    design (ADR-0148 I4, I5).
 * 3. Consent and suppression do not appear here at all: they are keyed by the
 *    recipient (and checked against the business scope), never by the sender,
 *    so changing the sender cannot change who consented (ADR-0148 section 4).
 */
import type {
  SenderUnavailableReason,
  WhatsappSenderCapability
} from "../../_shared/ports/channel-account-port";
import type { WhatsappPurpose } from "../../_shared/ports/whatsapp-delivery-port";
import { isWhatsappRecordId } from "./whatsapp-record-id";

/** How a sender was chosen; the value of `awcms_whatsapp_messages.sender_selection`. */
export type WhatsappSenderSelection =
  "deployment" | "explicit" | "policy" | "reply";

export type WhatsappBusinessScope = { type: string; id: string };

/** Failure code stored on a row whose sender could not send at dispatch time. */
export const SENDER_UNAVAILABLE_FAILURE_CODE = "sender_unavailable";

const SCOPE_TYPE = /^[a-z][a-z0-9_]*$/;

export function isWhatsappRecordUuid(value: unknown): value is string {
  return typeof value === "string" && isWhatsappRecordId(value);
}

/** `null` for a malformed scope: the caller fails closed rather than guessing. */
export function parseBusinessScope(
  value: unknown
): WhatsappBusinessScope | null | "invalid" {
  if (value === undefined || value === null) return null;

  if (typeof value !== "object") return "invalid";

  const { type, id } = value as { type?: unknown; id?: unknown };

  return typeof type === "string" &&
    type.length <= 64 &&
    SCOPE_TYPE.test(type) &&
    isWhatsappRecordUuid(id)
    ? { type, id: id.toLowerCase() }
    : "invalid";
}

export function sameBusinessScope(
  a: WhatsappBusinessScope | null,
  b: WhatsappBusinessScope | null
): boolean {
  return a === null || b === null
    ? a === b
    : a.type === b.type && a.id === b.id;
}

/**
 * Which provider-matrix capability a send needs. A reply inside a thread is
 * `reply`; a marketing send is `broadcast` (restricted for an unofficial
 * provider, so it needs contract evidence there); everything else is `dm`.
 */
export function capabilityForSend(
  purpose: WhatsappPurpose,
  isReply: boolean
): WhatsappSenderCapability {
  if (isReply) return "reply";

  return purpose === "marketing" ? "broadcast" : "dm";
}

/**
 * A scoped sender account may only send for its OWN business scope; a
 * tenant-wide account (no scope) may send for any. Exact `(type, id)`
 * equality, no hierarchy: the most restrictive, fail-closed reading, the same
 * one `channel_accounts` applies to its binding rule (#1215).
 */
export function senderScopeAllows(
  accountScope: WhatsappBusinessScope | null,
  messageScope: WhatsappBusinessScope | null
): boolean {
  return accountScope === null || sameBusinessScope(accountScope, messageScope);
}

export type PolicyRow = {
  businessScope: WhatsappBusinessScope | null;
  defaultSenderAccountId: string | null;
  configVersion: number;
};

/**
 * The default-sender policy that applies to a message: the row of its own
 * business scope when there is one, else the tenant-wide row, else none (the
 * deployment sender). A scoped row with a NULL default is a deliberate
 * "deployment sender for this scope" and DOES override a tenant-wide default.
 */
export function pickPolicy(
  policies: readonly PolicyRow[],
  scope: WhatsappBusinessScope | null
): PolicyRow | null {
  if (scope) {
    const scoped = policies.find(
      (policy) =>
        policy.businessScope !== null &&
        sameBusinessScope(policy.businessScope, scope)
    );

    if (scoped) return scoped;
  }

  return policies.find((policy) => policy.businessScope === null) ?? null;
}

export type SenderChoice =
  | {
      kind: "chosen";
      senderAccountId: string | null;
      selection: WhatsappSenderSelection;
      policyVersion: number | null;
    }
  | { kind: "refused"; reason: "SENDER_AFFINITY_CONFLICT" };

/**
 * Pure precedence of the four sources. `thread` is present only for a reply and
 * carries the earlier message's sender (`null` = the deployment sender). An
 * explicit sender that differs from the thread's is a CONFLICT, not an override:
 * an explicit reroute needs its own policy, authorisation and consent check
 * (ADR-0148 I5), which this change does not provide.
 */
export function chooseSender(input: {
  explicitSenderAccountId: string | null;
  thread: { senderAccountId: string | null } | null;
  policy: PolicyRow | null;
}): SenderChoice {
  const { explicitSenderAccountId, thread, policy } = input;

  if (thread) {
    if (
      explicitSenderAccountId !== null &&
      explicitSenderAccountId !== thread.senderAccountId
    ) {
      return { kind: "refused", reason: "SENDER_AFFINITY_CONFLICT" };
    }

    return {
      kind: "chosen",
      senderAccountId: thread.senderAccountId,
      selection: thread.senderAccountId === null ? "deployment" : "reply",
      policyVersion: null
    };
  }

  if (explicitSenderAccountId !== null) {
    return {
      kind: "chosen",
      senderAccountId: explicitSenderAccountId,
      selection: "explicit",
      policyVersion: null
    };
  }

  if (policy) {
    return {
      kind: "chosen",
      senderAccountId: policy.defaultSenderAccountId,
      selection:
        policy.defaultSenderAccountId === null ? "deployment" : "policy",
      policyVersion: policy.configVersion
    };
  }

  return {
    kind: "chosen",
    senderAccountId: null,
    selection: "deployment",
    policyVersion: null
  };
}

/**
 * What a dispatcher does with a claimed row whose sender cannot send now.
 *
 * - `terminal`: the sender is gone or was never approved (unknown or another
 *   tenant's, revoked, disabled, disconnected, unapproved, wrong provider): the
 *   row fails with {@link SENDER_UNAVAILABLE_FAILURE_CODE}. It is NEVER sent
 *   through anything else.
 * - `hold`: the sender is not usable right now for a reason that is not about
 *   this message and may clear on its own or by an operator (a degraded
 *   account, a pending connection, an expired token awaiting refresh, a missing
 *   key ring, a control plane switched off). The row stays WAITING and is not
 *   claimed; a security message still expires on its own clock.
 */
export function classifySenderUnavailable(
  reason: SenderUnavailableReason
): "terminal" | "hold" {
  switch (reason) {
    case "ACCOUNT_NOT_FOUND":
    case "NOT_A_WHATSAPP_SENDER":
    case "ACCOUNT_REVOKED":
    case "ACCOUNT_DISABLED":
    case "CAPABILITY_DENIED":
    case "CONNECTION_NOT_ACTIVE":
      return "terminal";
    case "CHANNEL_ACCOUNTS_DISABLED":
    case "ACCOUNT_PENDING":
    case "ACCOUNT_DEGRADED":
    case "CREDENTIAL_UNAVAILABLE":
    case "SECRET_STORE_UNAVAILABLE":
      return "hold";
  }
}
