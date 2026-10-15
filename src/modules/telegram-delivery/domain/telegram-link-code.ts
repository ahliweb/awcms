/**
 * One-time link codes and the webhook update shape (Issue #965, ADR-0140
 * sections 3 and 4). Pure: no I/O.
 *
 * ## The code
 *
 * 32 random bytes, base64url: 43 characters, inside Telegram's 64-character
 * deep-link payload limit. Only its SHA-256 is stored: a high-entropy secret
 * needs no keyed or slow hash, and an unkeyed hash lets the webhook find the
 * tenant from the code alone (`sql/217`).
 *
 * ## The update
 *
 * The webhook subscribes to `message` updates only and acts on two commands from
 * a PRIVATE chat: `/start <code>` and `/stop`. Everything else parses to
 * `ignored`, which is answered with nothing at all: no echo, no help text, no
 * "unknown command" (ADR-0140 section 4). A group, supergroup or channel never
 * reaches a command, whatever it says.
 */
import { createHash, randomBytes } from "node:crypto";

import { normalizePrivateChatId } from "./telegram-chat";

export const LINK_CODE_BYTES = 32;
export const LINK_CODE_LENGTH = 43;
export const LINK_CODE_TTL_MS = 10 * 60_000;
export const PENDING_CONFIRMATION_TTL_MS = 10 * 60_000;

const LINK_CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateLinkCode(): string {
  return randomBytes(LINK_CODE_BYTES).toString("base64url");
}

export function isWellFormedLinkCode(value: string): boolean {
  return LINK_CODE_PATTERN.test(value);
}

/** Lower-case hex SHA-256: what `awcms_telegram_link_codes.code_hash` holds. */
export function hashLinkCode(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

/** `https://t.me/<bot>?start=<code>`: the link shown ONCE to the staff member. */
export function buildDeepLink(botUsername: string, code: string): string {
  return `https://t.me/${botUsername}?start=${code}`;
}

export type TelegramInboundCommand =
  | {
      kind: "start";
      code: string;
      chatId: string;
      firstName: unknown;
      lastName: unknown;
      username: unknown;
    }
  | { kind: "stop"; chatId: string }
  /** A well-formed `/start` whose payload is not a link code. Answered like an unknown code. */
  | { kind: "start_invalid"; chatId: string }
  | { kind: "ignored" };

const START_PATTERN = /^\/start(?:@[A-Za-z0-9_]{5,32})?(?:[ \t]+(\S+))?$/;
const STOP_PATTERN = /^\/stop(?:@[A-Za-z0-9_]{5,32})?$/;

const IGNORED: TelegramInboundCommand = { kind: "ignored" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads a Telegram `Update` defensively. Only `message` is considered (the
 * webhook is registered with `allowed_updates=["message"]`, but this does not
 * trust the registration), and only from a private chat whose id equals the
 * sender's id, from a human. Edits, callback queries, media, forwards' captions
 * and everything else are `ignored`.
 */
export function parseTelegramUpdate(update: unknown): TelegramInboundCommand {
  if (!isRecord(update) || !isRecord(update.message)) {
    return IGNORED;
  }

  const message = update.message;
  const chat = message.chat;
  const from = message.from;

  if (!isRecord(chat) || !isRecord(from)) {
    return IGNORED;
  }

  if (chat.type !== "private" || from.is_bot === true) {
    return IGNORED;
  }

  const chatId = normalizePrivateChatId(chat.id);

  if (chatId === null || chat.id !== from.id) {
    return IGNORED;
  }

  const text = message.text;

  if (typeof text !== "string" || text.length === 0 || text.length > 200) {
    return IGNORED;
  }

  if (STOP_PATTERN.test(text)) {
    return { kind: "stop", chatId };
  }

  const start = START_PATTERN.exec(text);

  if (!start) {
    return IGNORED;
  }

  const payload = start[1];

  // A bare `/start` (someone opened the bot without a link) is ignored: it
  // carries no code, and replying would make the bot a chat oracle.
  if (payload === undefined) {
    return IGNORED;
  }

  if (!isWellFormedLinkCode(payload)) {
    return { kind: "start_invalid", chatId };
  }

  return {
    kind: "start",
    code: payload,
    chatId,
    firstName: from.first_name,
    lastName: from.last_name,
    username: from.username
  };
}

/**
 * The chat an update came from, as a string key, for rate limiting only (Issue
 * #1008). Unlike `parseTelegramUpdate` it does not care what the message says or
 * what kind of chat it is: a noisy user is noisy with plain text too, and those
 * messages are exactly the ones that parse as `ignored`. `null` when the update
 * has no usable chat.
 */
export function extractUpdateChatKey(update: unknown): string | null {
  if (!isRecord(update) || !isRecord(update.message)) {
    return null;
  }

  const chat = update.message.chat;

  if (!isRecord(chat) || !Number.isSafeInteger(chat.id)) {
    return null;
  }

  return String(chat.id);
}

/**
 * The fixed replies. Plain text, no markup (no `parse_mode` is ever sent), no
 * link. One neutral wording covers an unknown, expired, consumed or malformed
 * code, so the reply is not an oracle for which codes exist.
 */
/**
 * Names the TENANT the code belongs to, so a person who was handed a link for the
 * wrong organisation (or a forwarded one) sees whose alerts they are about to
 * enable before they press anything. `tenantLabel` is the tenant's display name
 * after `sanitizeDisplayName` (control and bidi characters stripped, capped); the
 * rest of the text is fixed.
 */
export function telegramReplyLinked(
  tenantLabel: string | null,
  pin: string
): string {
  const who = tenantLabel ?? "this organisation";
  const siapa = tenantLabel ?? "organisasi ini";

  return `Chat received for ${who}. Your verification PIN is ${pin}. Open the admin and enter this PIN to confirm that this is you; until then this chat will not receive alerts. Do not share the PIN. / Chat diterima untuk ${siapa}. PIN verifikasi Anda adalah ${pin}. Buka admin dan masukkan PIN ini untuk mengonfirmasi bahwa ini Anda; sebelum itu chat ini tidak menerima notifikasi. Jangan bagikan PIN ini.`;
}

/** The same person, with the same chat, who asked for a new code: nothing is waiting for confirmation. */
export function telegramReplyAlreadyLinked(tenantLabel: string | null): string {
  const who = tenantLabel ?? "this organisation";
  const siapa = tenantLabel ?? "organisasi ini";

  return `This chat already receives alerts for ${who}. Send /stop to stop them. / Chat ini sudah menerima notifikasi untuk ${siapa}. Kirim /stop untuk menghentikannya.`;
}

export const TELEGRAM_REPLY_CODE_NOT_VALID =
  "This link code is not valid or has expired. Request a new one from the admin. / Kode tautan ini tidak valid atau sudah kedaluwarsa. Minta kode baru dari admin.";

export const TELEGRAM_REPLY_STOPPED =
  "Alerts stopped. You can link again from the admin. / Notifikasi dihentikan. Anda dapat menautkan lagi dari admin.";
