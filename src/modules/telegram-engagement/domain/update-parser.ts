/**
 * Classifies one verified Telegram update into the few shapes this module acts
 * on (ADR-0152 section 4, T-W3). Everything else is `ignored`.
 *
 * ## Binding rules, applied here once
 *
 *   - **Private chats only** (E1). A group, supergroup or channel update for a
 *     DM bot is dropped: no contact, no consent, no reply.
 *   - **No bot senders.** `from.is_bot` is dropped, so bot-to-bot loops are
 *     impossible by construction.
 *   - **The person is the chat.** In a private chat the chat id equals the
 *     sender's user id; an update where they differ is not believed.
 *   - **Forward and reply metadata are untrusted content**, never an identity:
 *     the identity is always the chat, and a forwarded message is just a message
 *     from the person who forwarded it.
 *   - **Edited messages** are not in `allowed_updates` and are ignored if they
 *     arrive anyway: an edit never re-runs `/start` or `/stop`.
 *
 * Nothing returned carries message text. The text is never stored or published
 * (ADR-0150 section 1: no upstream conversation store; the envelope's
 * `content_ref` question, Q4, is open and answered fail-closed here).
 *
 * Pure module.
 */
import {
  PROMPTABLE_PURPOSES,
  type PromptablePurpose
} from "./telegram-engagement-constants";

export type ParsedUpdate =
  | { kind: "invalid" }
  | { kind: "ignored"; updateId: number; reason: IgnoreReason }
  | {
      kind: "start";
      updateId: number;
      userId: string;
      /** The deep-link parameter, if any and well-formed: provenance, NEVER consent. */
      startParam: string | null;
      occurredAt: Date;
    }
  | { kind: "stop"; updateId: number; userId: string; occurredAt: Date }
  | {
      kind: "message";
      updateId: number;
      userId: string;
      /** What KIND of content arrived; never the content. */
      contentKinds: ContentKind[];
      forwarded: boolean;
      occurredAt: Date;
    }
  | {
      kind: "membership";
      updateId: number;
      userId: string;
      /** `blocked` = the person blocked the bot; `unblocked` = restored (grants nothing). */
      change: "blocked" | "unblocked";
      occurredAt: Date;
    }
  | {
      kind: "consent_button";
      updateId: number;
      userId: string;
      /** The id of OUR message the button sits on; checked against the queue. */
      messageId: number;
      purpose: PromptablePurpose;
      noticeVersion: string;
      accept: boolean;
      occurredAt: Date;
    };

export type IgnoreReason =
  | "not_private"
  | "bot_sender"
  | "identity_mismatch"
  | "unsupported_type"
  | "malformed_callback";

export type ContentKind = "text" | "media" | "contact" | "location" | "other";

const START_PARAM = /^[A-Za-z0-9_-]{1,64}$/;
const NOTICE_VERSION = /^[A-Za-z0-9._-]{1,40}$/;
const MAX_ID = Number.MAX_SAFE_INTEGER;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asId(value: unknown): string | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    Math.abs(value) <= MAX_ID
    ? String(value)
    : null;
}

function occurredAt(value: unknown, fallback: Date): Date {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? new Date(value * 1000)
    : fallback;
}

/** Recognises `/cmd`, `/cmd@SomeBot` and `/cmd param`. Case-sensitive, as Telegram is. */
function parseCommand(
  text: string
): { command: string; param: string | null } | null {
  const match =
    /^\/([a-z]{1,32})(?:@[A-Za-z0-9_]{1,64})?(?:\s+(\S+))?\s*$/.exec(text);

  if (!match) return null;

  return { command: match[1]!, param: match[2] ?? null };
}

function contentKindsOf(message: Record<string, unknown>): ContentKind[] {
  const kinds: ContentKind[] = [];

  if (typeof message.text === "string") kinds.push("text");

  if (
    [
      "photo",
      "video",
      "document",
      "audio",
      "voice",
      "sticker",
      "animation"
    ].some((key) => key in message)
  ) {
    kinds.push("media");
  }

  if ("contact" in message) kinds.push("contact");
  if ("location" in message) kinds.push("location");

  return kinds.length === 0 ? ["other"] : kinds;
}

/** Private chat whose id equals the (human) sender's id, or the reason it is not. */
function privatePerson(
  chat: Record<string, unknown> | null,
  from: Record<string, unknown> | null
): { userId: string } | { reason: IgnoreReason } {
  if (!chat || chat.type !== "private") return { reason: "not_private" };
  if (!from) return { reason: "identity_mismatch" };
  if (from.is_bot === true) return { reason: "bot_sender" };

  const chatId = asId(chat.id);
  const fromId = asId(from.id);

  if (chatId === null || fromId === null || chatId !== fromId) {
    return { reason: "identity_mismatch" };
  }

  return { userId: fromId };
}

/**
 * `tgc1:<purpose>:<noticeVersion>` accepts, `tgw1:<purpose>` withdraws. The
 * data is ATTACKER-CONTROLLABLE (a modified client can send any bytes), so it
 * only NAMES what to look up: the handler accepts it only for a consent prompt
 * this module actually sent to this contact, for this purpose and version.
 */
export function parseConsentCallbackData(data: string): {
  purpose: PromptablePurpose;
  noticeVersion: string;
  accept: boolean;
} | null {
  const parts = data.split(":");
  const purpose = parts[1];

  if (
    purpose === undefined ||
    !(PROMPTABLE_PURPOSES as readonly string[]).includes(purpose)
  ) {
    return null;
  }

  if (
    parts[0] === "tgc1" &&
    parts.length === 3 &&
    NOTICE_VERSION.test(parts[2]!)
  ) {
    return {
      purpose: purpose as PromptablePurpose,
      noticeVersion: parts[2]!,
      accept: true
    };
  }

  if (
    parts[0] === "tgw1" &&
    parts.length === 3 &&
    NOTICE_VERSION.test(parts[2]!)
  ) {
    return {
      purpose: purpose as PromptablePurpose,
      noticeVersion: parts[2]!,
      accept: false
    };
  }

  return null;
}

export function consentCallbackData(
  purpose: PromptablePurpose,
  noticeVersion: string,
  accept: boolean
): string {
  return `${accept ? "tgc1" : "tgw1"}:${purpose}:${noticeVersion}`;
}

export function parseTelegramUpdate(
  raw: unknown,
  now: Date = new Date()
): ParsedUpdate {
  const update = asRecord(raw);

  if (!update) return { kind: "invalid" };

  const updateIdRaw = update.update_id;

  if (
    typeof updateIdRaw !== "number" ||
    !Number.isSafeInteger(updateIdRaw) ||
    updateIdRaw < 0
  ) {
    return { kind: "invalid" };
  }

  const updateId = updateIdRaw;
  const message = asRecord(update.message);

  if (message) {
    const person = privatePerson(
      asRecord(message.chat),
      asRecord(message.from)
    );

    if ("reason" in person) {
      return { kind: "ignored", updateId, reason: person.reason };
    }

    const at = occurredAt(message.date, now);
    const forwarded =
      "forward_origin" in message ||
      "forward_from" in message ||
      "forward_from_chat" in message;

    // A forwarded "/start" is the content of someone else's message, not a
    // command from this person: it never creates a contact or a consent.
    if (typeof message.text === "string" && !forwarded) {
      const command = parseCommand(message.text);

      if (command?.command === "start") {
        return {
          kind: "start",
          updateId,
          userId: person.userId,
          startParam:
            command.param !== null && START_PARAM.test(command.param)
              ? command.param
              : null,
          occurredAt: at
        };
      }

      if (command?.command === "stop") {
        return {
          kind: "stop",
          updateId,
          userId: person.userId,
          occurredAt: at
        };
      }
    }

    return {
      kind: "message",
      updateId,
      userId: person.userId,
      contentKinds: contentKindsOf(message),
      forwarded,
      occurredAt: at
    };
  }

  const membership = asRecord(update.my_chat_member);

  if (membership) {
    const person = privatePerson(
      asRecord(membership.chat),
      asRecord(membership.from)
    );

    if ("reason" in person) {
      return { kind: "ignored", updateId, reason: person.reason };
    }

    const status = asRecord(membership.new_chat_member)?.status;
    const at = occurredAt(membership.date, now);

    if (status === "kicked") {
      return {
        kind: "membership",
        updateId,
        userId: person.userId,
        change: "blocked",
        occurredAt: at
      };
    }

    if (status === "member") {
      return {
        kind: "membership",
        updateId,
        userId: person.userId,
        change: "unblocked",
        occurredAt: at
      };
    }

    return { kind: "ignored", updateId, reason: "unsupported_type" };
  }

  const callback = asRecord(update.callback_query);

  if (callback) {
    const callbackMessage = asRecord(callback.message);
    const person = privatePerson(
      asRecord(callbackMessage?.chat),
      asRecord(callback.from)
    );

    if ("reason" in person) {
      return { kind: "ignored", updateId, reason: person.reason };
    }

    const messageId = callbackMessage?.message_id;
    const parsed =
      typeof callback.data === "string" && callback.data.length <= 64
        ? parseConsentCallbackData(callback.data)
        : null;

    if (
      parsed === null ||
      typeof messageId !== "number" ||
      !Number.isSafeInteger(messageId) ||
      messageId <= 0
    ) {
      return { kind: "ignored", updateId, reason: "malformed_callback" };
    }

    return {
      kind: "consent_button",
      updateId,
      userId: person.userId,
      messageId,
      purpose: parsed.purpose,
      noticeVersion: parsed.noticeVersion,
      accept: parsed.accept,
      occurredAt: now
    };
  }

  return { kind: "ignored", updateId, reason: "unsupported_type" };
}
