/**
 * Meta Cloud API rules of `whatsapp_delivery` (Issue #1143). Pure: no I/O, no
 * clock, no environment. Everything here was re-verified against Meta's
 * official documentation on 11 November 2026 (see the module README section
 * "Meta Cloud API multi-WABA senders"); where the documentation is silent the
 * rule is the FAIL-CLOSED reading and says so.
 *
 * These rules apply to a TENANT-OWNED Meta sender (`whatsapp_cloud`) only. They
 * are deliberately NOT applied to StarSender (an unofficial gateway Meta does
 * not approve templates for) and NOT to the legacy deployment sender (which has
 * no WABA record to check against and keeps its unchanged behaviour: Meta
 * itself rejects an unapproved template).
 */
import type { WhatsappPurpose } from "../../_shared/ports/whatsapp-delivery-port";

// ---------------------------------------------------------------------------
// Templates (approved per WABA)
// ---------------------------------------------------------------------------

/** Meta's `message_template_status_update` `event` values, verbatim (closed list). */
export const META_TEMPLATE_STATUSES = [
  "APPROVED",
  "ARCHIVED",
  "UNARCHIVED",
  "DELETED",
  "DISABLED",
  "FLAGGED",
  "IN_APPEAL",
  "LIMIT_EXCEEDED",
  "LOCKED",
  "PAUSED",
  "PENDING",
  "REINSTATED",
  "PENDING_DELETION",
  "REJECTED"
] as const;

export type MetaTemplateStatus = (typeof META_TEMPLATE_STATUSES)[number];

export const META_TEMPLATE_CATEGORIES = [
  "MARKETING",
  "UTILITY",
  "AUTHENTICATION"
] as const;

export type MetaTemplateCategory = (typeof META_TEMPLATE_CATEGORIES)[number];

export function isMetaTemplateStatus(
  value: unknown
): value is MetaTemplateStatus {
  return (
    typeof value === "string" &&
    (META_TEMPLATE_STATUSES as readonly string[]).includes(value)
  );
}

export function isMetaTemplateCategory(
  value: unknown
): value is MetaTemplateCategory {
  return (
    typeof value === "string" &&
    (META_TEMPLATE_CATEGORIES as readonly string[]).includes(value)
  );
}

/**
 * Only `APPROVED` and `REINSTATED` (back from a pause) may be sent. `FLAGGED`
 * is still sendable at Meta for a while, but it is the first step towards a
 * pause and nothing here can tell how long it has; it is refused (fail closed)
 * until Meta reports it approved again. Every other status is not sendable.
 */
export function isMetaTemplateSendable(status: MetaTemplateStatus): boolean {
  return status === "APPROVED" || status === "REINSTATED";
}

/**
 * The Meta category a purpose must be sent under. A marketing message under a
 * utility template, or a notice under an authentication template, is a policy
 * violation at Meta (and a different price); the mapping is exact.
 */
export function metaCategoryForPurpose(
  purpose: WhatsappPurpose
): MetaTemplateCategory {
  switch (purpose) {
    case "marketing":
      return "MARKETING";
    case "security":
      return "AUTHENTICATION";
    case "transactional":
      return "UTILITY";
  }
}

// ---------------------------------------------------------------------------
// The 24-hour customer-service window
// ---------------------------------------------------------------------------

/** "A 24-hour timer called a customer service window" starts (and resets) when the user messages the business. */
export const META_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isServiceWindowOpen(
  lastInboundAt: Date | null,
  now: Date
): boolean {
  if (!lastInboundAt) return false;

  const age = now.getTime() - lastInboundAt.getTime();

  return age >= 0 && age < META_SERVICE_WINDOW_MS;
}

export type MetaSendRefusal =
  "TEMPLATE_NOT_APPROVED" | "OUTSIDE_SERVICE_WINDOW";

export type MetaSendDecision =
  /** `template`: an approved template; `session`: free text inside the open window. */
  | { ok: true; mode: "template" | "session" }
  | { ok: false; reason: MetaSendRefusal };

/**
 * May this message go out through a Meta number NOW, and how?
 *
 * - A registration with a `providerTemplate` is a TEMPLATE message: it needs an
 *   approval row on the sender's own WABA, sendable, of the category the
 *   purpose requires. No row, a pending/paused/rejected/disabled template, or
 *   the wrong category is `TEMPLATE_NOT_APPROVED`, never free text instead.
 * - A registration WITHOUT a `providerTemplate` can only be a free-text service
 *   message, which Meta allows only inside the 24-hour window opened by that
 *   recipient writing to THIS number. Outside it: `OUTSIDE_SERVICE_WINDOW`.
 *   Marketing is never sent as free text (`TEMPLATE_NOT_APPROVED`): an opt-in
 *   is necessary for marketing but the content still has to be an approved
 *   marketing template.
 */
export function decideMetaSend(input: {
  purpose: WhatsappPurpose;
  hasProviderTemplate: boolean;
  approval: {
    status: MetaTemplateStatus;
    category: MetaTemplateCategory;
  } | null;
  windowOpen: boolean;
}): MetaSendDecision {
  if (input.hasProviderTemplate) {
    if (
      !input.approval ||
      !isMetaTemplateSendable(input.approval.status) ||
      input.approval.category !== metaCategoryForPurpose(input.purpose)
    ) {
      return { ok: false, reason: "TEMPLATE_NOT_APPROVED" };
    }

    return { ok: true, mode: "template" };
  }

  if (input.purpose === "marketing") {
    return { ok: false, reason: "TEMPLATE_NOT_APPROVED" };
  }

  return input.windowOpen
    ? { ok: true, mode: "session" }
    : { ok: false, reason: "OUTSIDE_SERVICE_WINDOW" };
}

/**
 * Which of two template statuses wins, by Meta's event time. A strictly newer
 * event wins; on a tie the NOT-sendable one wins (a pause and an approval
 * stamped the same second must not leave the template approved).
 */
export function templateChangeWins(input: {
  current: { status: MetaTemplateStatus; eventAt: Date } | null;
  incoming: { status: MetaTemplateStatus; eventAt: Date };
}): boolean {
  if (!input.current) return true;

  const delta =
    input.incoming.eventAt.getTime() - input.current.eventAt.getTime();

  if (delta > 0) return true;
  if (delta < 0) return false;

  return (
    input.incoming.status !== input.current.status &&
    !isMetaTemplateSendable(input.incoming.status)
  );
}

// ---------------------------------------------------------------------------
// Provider-reported delivery status
// ---------------------------------------------------------------------------

export type MetaDeliveryStatus = "sent" | "delivered" | "read" | "failed";

export const META_DELIVERY_STATUS_RANK: Readonly<
  Record<MetaDeliveryStatus, number>
> = { sent: 1, delivered: 2, read: 3, failed: 9 };

/** Meta's status values mapped to ours; `played` (a voice message) is a read. Unknown values are ignored. */
export function parseMetaDeliveryStatus(
  value: unknown
): MetaDeliveryStatus | null {
  switch (value) {
    case "sent":
    case "delivered":
    case "read":
    case "failed":
      return value;
    case "played":
      return "read";
    default:
      return null;
  }
}

/**
 * The status a row moves to, or `null` for "nothing to do". Forward only: a
 * repeated status, an older one arriving late (Meta retries for days and does
 * not promise order) and anything after `failed` change nothing. `failed` is
 * accepted only before delivery: a message the device received cannot become
 * undelivered.
 */
export function nextProviderStatus(
  current: MetaDeliveryStatus | null,
  incoming: MetaDeliveryStatus
): MetaDeliveryStatus | null {
  if (current === "failed") return null;

  if (incoming === "failed") {
    return current === null || current === "sent" ? "failed" : null;
  }

  const currentRank = current ? META_DELIVERY_STATUS_RANK[current] : 0;

  return META_DELIVERY_STATUS_RANK[incoming] > currentRank ? incoming : null;
}

// ---------------------------------------------------------------------------
// WABA account signals
// ---------------------------------------------------------------------------

export type MetaRestrictionReason =
  | "ACCOUNT_DELETED"
  | "ACCOUNT_RESTRICTION"
  | "DISABLED"
  | "OFFBOARDED"
  | "APP_UNINSTALLED";

export type MetaAccountSignal =
  | { kind: "restrict"; reason: MetaRestrictionReason }
  /** Clears ONLY a restriction of this exact reason (a reinstatement does not lift a deletion). */
  | { kind: "clear"; reason: MetaRestrictionReason }
  | { kind: "ignore" };

/**
 * `account_update` events. Restrictive ones stop the WABA's numbers; the two
 * documented reversals (`DISABLED_UPDATE` with `waba_ban_state: REINSTATE`,
 * `ACCOUNT_RECONNECTED`) lift only the restriction they reverse. A
 * `DISABLED_UPDATE` with an unknown ban state is read as restrictive (fail
 * closed). `ACCOUNT_RESTRICTION` carries expirations Meta may or may not fill;
 * it is held until an operator clears it after checking at Meta.
 */
export function classifyMetaAccountUpdate(value: unknown): MetaAccountSignal {
  if (typeof value !== "object" || value === null) return { kind: "ignore" };

  const event = (value as { event?: unknown }).event;

  switch (event) {
    case "ACCOUNT_DELETED":
      return { kind: "restrict", reason: "ACCOUNT_DELETED" };
    case "ACCOUNT_RESTRICTION":
      return { kind: "restrict", reason: "ACCOUNT_RESTRICTION" };
    case "ACCOUNT_OFFBOARDED":
      return { kind: "restrict", reason: "OFFBOARDED" };
    case "ACCOUNT_RECONNECTED":
      return { kind: "clear", reason: "OFFBOARDED" };
    case "PARTNER_APP_UNINSTALLED":
      return { kind: "restrict", reason: "APP_UNINSTALLED" };
    case "DISABLED_UPDATE": {
      const banInfo = (value as { ban_info?: unknown }).ban_info;
      const state =
        typeof banInfo === "object" && banInfo !== null
          ? (banInfo as { waba_ban_state?: unknown }).waba_ban_state
          : undefined;

      return state === "REINSTATE"
        ? { kind: "clear", reason: "DISABLED" }
        : { kind: "restrict", reason: "DISABLED" };
    }
    default:
      return { kind: "ignore" };
  }
}

export const META_MESSAGING_LIMIT_TIERS = [
  "TIER_50",
  "TIER_250",
  "TIER_1K",
  "TIER_2K",
  "TIER_10K",
  "TIER_100K",
  "TIER_NOT_SET",
  "TIER_UNLIMITED"
] as const;

export type MetaMessagingLimitTier =
  (typeof META_MESSAGING_LIMIT_TIERS)[number];

/** `max_daily_conversations_per_business` (current), else the deprecated `current_limit`. */
export function parseMessagingLimitTier(
  value: unknown
): MetaMessagingLimitTier | null {
  if (typeof value !== "object" || value === null) return null;

  const record = value as {
    max_daily_conversations_per_business?: unknown;
    current_limit?: unknown;
  };
  const tier =
    record.max_daily_conversations_per_business ?? record.current_limit;

  return typeof tier === "string" &&
    (META_MESSAGING_LIMIT_TIERS as readonly string[]).includes(tier)
    ? (tier as MetaMessagingLimitTier)
    : null;
}

// ---------------------------------------------------------------------------
// The webhook payload
// ---------------------------------------------------------------------------

/** Most actions one webhook may produce; the rest are dropped and counted. Meta batches far fewer. */
export const META_WEBHOOK_MAX_ACTIONS = 500;

/**
 * #1298 L2. The oldest `entry.time` whose WABA-level changes (template status,
 * messaging limit, account restriction) a webhook may still apply. Meta retries
 * a delivery for up to seven days and the body-hash receipts are kept for eight
 * (`WHATSAPP_WEBHOOK_RECEIPT_RETENTION_DAYS`), so an entry older than this
 * horizon cannot be a first delivery, and no receipt can still vouch that it was
 * seen: it is either a replay of a captured signed body after the receipts were
 * purged, or against a rotated token, or a delivery so late its content is
 * stale. It is dropped (counted as ignored), never applied. Kept strictly below
 * the receipt retention, so the two windows overlap by a day and leave no gap.
 */
export const META_ENTRY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const WAMID = /^[A-Za-z0-9._=:+/-]{1,200}$/;
const PHONE_DIGITS = /^[1-9][0-9]{6,14}$/;
const TEMPLATE_NAME = /^[a-z0-9_]{1,512}$/;
const LANGUAGE = /^[A-Za-z]{2,3}([_-][A-Za-z0-9]{2,8}){0,2}$/;

export type MetaWebhookAction =
  | {
      kind: "status";
      providerMessageId: string;
      status: MetaDeliveryStatus;
      /** Digits without `+`, when Meta sent one. */
      recipientDigits: string | null;
      /** `meta_<code>` of the first error of a failed status. */
      failureCode: string | null;
    }
  | { kind: "inbound"; fromDigits: string; at: Date }
  | {
      kind: "template";
      name: string;
      language: string;
      category: MetaTemplateCategory;
      status: MetaTemplateStatus;
      eventAt: Date;
    }
  | { kind: "limit"; tier: MetaMessagingLimitTier; eventAt: Date }
  | { kind: "account"; signal: MetaAccountSignal; eventAt: Date };

export type ParsedMetaWebhook = {
  actions: MetaWebhookAction[];
  /** Changes that named another WABA or phone number id than the token's binding: dropped, never applied. */
  bindingMismatches: number;
  /** Changes or items that were malformed, of an unhandled field, or over the action cap. */
  ignored: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function unixSeconds(value: unknown): Date | null {
  const seconds =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^[0-9]{1,12}$/.test(value)
        ? Number(value)
        : NaN;

  if (!Number.isFinite(seconds) || seconds <= 0) return null;

  const at = new Date(seconds * 1000);

  // `1e300` is finite but past the Date range: an `Invalid Date` would reach
  // the database as a value it rejects, a 503, and Meta retrying for 7 days
  // (#1267 audit M3). Unreadable, so the caller's fallback applies.
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * Reads a VERIFIED Meta webhook body into actions, keeping only what belongs to
 * the binding the callback token resolved to: `entry.id` must be the number's
 * own WABA id and, for `messages`, `value.metadata.phone_number_id` must be the
 * number itself. Anything naming another WABA or number is dropped (counted),
 * never applied to "whichever row matches": tenant and account come from the
 * token, the payload only selects WITHIN that binding.
 *
 * Inbound message CONTENT is never read: only the sender's number (for the
 * window) and its timestamp.
 */
export function parseMetaWebhook(
  payload: unknown,
  binding: { wabaId: string; phoneNumberId: string },
  now: Date
): ParsedMetaWebhook {
  const result: ParsedMetaWebhook = {
    actions: [],
    bindingMismatches: 0,
    ignored: 0
  };
  const root = asRecord(payload);

  if (!root || root.object !== "whatsapp_business_account") {
    result.ignored += 1;

    return result;
  }

  const entries = Array.isArray(root.entry) ? root.entry : [];
  const push = (action: MetaWebhookAction) => {
    if (result.actions.length >= META_WEBHOOK_MAX_ACTIONS) {
      result.ignored += 1;

      return;
    }

    result.actions.push(action);
  };

  for (const rawEntry of entries.slice(0, 100)) {
    const entry = asRecord(rawEntry);

    if (!entry) {
      result.ignored += 1;
      continue;
    }

    const entryId = typeof entry.id === "string" ? entry.id : null;
    const changes = Array.isArray(entry.changes) ? entry.changes : [];

    if (entryId !== binding.wabaId) {
      result.bindingMismatches += Math.max(1, changes.length);
      continue;
    }

    // Clamped like an inbound timestamp (#1267 audit M3): a future `entry.time`
    // would make this event "newer" than every genuine later one and freeze the
    // WABA's template and restriction state until that date.
    const statedTime = unixSeconds(entry.time);
    const entryTime =
      statedTime && statedTime.getTime() <= now.getTime() ? statedTime : now;
    // #1298 L2: a WABA-level change needs a STATED time inside the horizon. A
    // missing or unreadable time used to default to "now" (so a captured body
    // stripped of its time applied as brand new); a stale one was applied as
    // old. Both are refused for the three state-changing kinds. Statuses and
    // inbound messages are unaffected: statuses only move forward by rank and
    // an inbound message carries its own (clamped) timestamp.
    const stateFresh =
      statedTime !== null &&
      now.getTime() - statedTime.getTime() <= META_ENTRY_MAX_AGE_MS;

    for (const rawChange of changes.slice(0, 100)) {
      const change = asRecord(rawChange);
      const value = asRecord(change?.value);

      if (!change || !value) {
        result.ignored += 1;
        continue;
      }

      switch (change.field) {
        case "messages": {
          const metadata = asRecord(value.metadata);

          if (metadata?.phone_number_id !== binding.phoneNumberId) {
            result.bindingMismatches += 1;
            continue;
          }

          for (const rawStatus of Array.isArray(value.statuses)
            ? value.statuses.slice(0, META_WEBHOOK_MAX_ACTIONS)
            : []) {
            const status = asRecord(rawStatus);
            const parsedStatus = parseMetaDeliveryStatus(status?.status);
            const id = status?.id;

            if (
              !status ||
              !parsedStatus ||
              typeof id !== "string" ||
              !WAMID.test(id)
            ) {
              result.ignored += 1;
              continue;
            }

            const recipient =
              typeof status.recipient_id === "string" &&
              PHONE_DIGITS.test(status.recipient_id)
                ? status.recipient_id
                : null;
            const firstError = Array.isArray(status.errors)
              ? asRecord(status.errors[0])
              : null;
            const code =
              typeof firstError?.code === "number" &&
              Number.isInteger(firstError.code) &&
              firstError.code >= 0 &&
              firstError.code < 1_000_000_000
                ? `meta_${firstError.code}`
                : null;

            push({
              kind: "status",
              providerMessageId: id,
              status: parsedStatus,
              recipientDigits: recipient,
              failureCode: parsedStatus === "failed" ? code : null
            });
          }

          for (const rawMessage of Array.isArray(value.messages)
            ? value.messages.slice(0, META_WEBHOOK_MAX_ACTIONS)
            : []) {
            const message = asRecord(rawMessage);
            const from = message?.from;
            const at = unixSeconds(message?.timestamp);

            if (typeof from !== "string" || !PHONE_DIGITS.test(from) || !at) {
              result.ignored += 1;
              continue;
            }

            // A timestamp in the future would extend the window; it is clamped
            // to the moment the verified webhook arrived.
            push({
              kind: "inbound",
              fromDigits: from,
              at: at.getTime() > now.getTime() ? now : at
            });
          }

          break;
        }

        case "message_template_status_update": {
          if (!stateFresh) {
            result.ignored += 1;
            continue;
          }

          const status = value.event;
          const category = value.message_template_category;
          const name = value.message_template_name;
          const language = value.message_template_language;

          if (
            !isMetaTemplateStatus(status) ||
            !isMetaTemplateCategory(category) ||
            typeof name !== "string" ||
            !TEMPLATE_NAME.test(name) ||
            typeof language !== "string" ||
            !LANGUAGE.test(language)
          ) {
            result.ignored += 1;
            continue;
          }

          push({
            kind: "template",
            name,
            language,
            category,
            status,
            eventAt: entryTime
          });
          break;
        }

        case "phone_number_quality_update": {
          if (!stateFresh) {
            result.ignored += 1;
            continue;
          }

          const tier = parseMessagingLimitTier(value);

          if (!tier) {
            result.ignored += 1;
            continue;
          }

          push({ kind: "limit", tier, eventAt: entryTime });
          break;
        }

        case "account_update": {
          if (!stateFresh) {
            result.ignored += 1;
            continue;
          }

          const signal = classifyMetaAccountUpdate(value);

          if (signal.kind === "ignore") {
            result.ignored += 1;
            continue;
          }

          push({ kind: "account", signal, eventAt: entryTime });
          break;
        }

        default:
          result.ignored += 1;
      }
    }
  }

  return result;
}
