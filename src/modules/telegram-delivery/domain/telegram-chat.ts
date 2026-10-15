/**
 * Chat-id handling for `telegram_delivery` (Issue #965, ADR-0140 section 6): the
 * ONE place a Telegram `chat_id` is encrypted, decrypted, hashed and masked, all
 * through the shared ADR-0137 helper (`src/lib/security/field-encryption.ts`;
 * this file is not a second copy of it). Pure: no I/O.
 *
 * The raw id exists in memory only (the webhook handing it to `encryptChatId`,
 * the dispatcher handing a decrypted one to the provider). It reaches no log, no
 * audit row, no event, no response and no queue row.
 */
import {
  decryptFieldToString,
  encryptField,
  keyedHashCandidates,
  keyedHashPrimary,
  type KeyRing
} from "../../../lib/security/field-encryption";
import {
  TELEGRAM_CHAT_ENCRYPTION_PURPOSE,
  TELEGRAM_CHAT_HASH_PURPOSE
} from "./telegram-constants";

/**
 * A private chat id is the user's id: a positive integer. Telegram documents ids
 * as fitting 52 bits; anything negative is a group, supergroup or channel, which
 * this adapter refuses outright (ADR-0140 section 3).
 */
export function normalizePrivateChatId(raw: unknown): string | null {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw <= 0) {
    return null;
  }

  return String(raw);
}

/** AAD binds the ciphertext to its tenant and binding row (ADR-0140 section 6). */
export function encryptChatId(
  chatId: string,
  tenantId: string,
  bindingId: string,
  ring: KeyRing
): string {
  return encryptField(
    chatId,
    {
      purpose: TELEGRAM_CHAT_ENCRYPTION_PURPOSE,
      tenantId,
      rowId: bindingId
    },
    ring
  );
}

/** Throws a `FieldEncryptionError` on any failure; callers treat a throw as "cannot decrypt" and never fall back to anything. */
export function decryptChatId(
  ciphertext: string,
  tenantId: string,
  bindingId: string,
  ring: KeyRing
): string {
  return decryptFieldToString(
    ciphertext,
    {
      purpose: TELEGRAM_CHAT_ENCRYPTION_PURPOSE,
      tenantId,
      rowId: bindingId
    },
    ring
  );
}

/** The hash a NEW row is written under (the active key): `<keyId>:<hex>`. */
export function hashChatId(
  chatId: string,
  tenantId: string,
  ring: KeyRing
): { chatHash: string; hashKeyId: string } {
  const chatHash = keyedHashPrimary(
    chatId,
    { purpose: TELEGRAM_CHAT_HASH_PURPOSE, tenantId },
    ring
  );

  return { chatHash, hashKeyId: chatHash.slice(0, chatHash.indexOf(":")) };
}

/** Every hash an existing row for this chat may carry (one per ring key), for lookups that survive rotation. */
export function chatHashCandidates(
  chatId: string,
  tenantId: string,
  ring: KeyRing
): string[] {
  return keyedHashCandidates(
    chatId,
    { purpose: TELEGRAM_CHAT_HASH_PURPOSE, tenantId },
    ring
  );
}

/** The last three digits, the only form any list, log line, audit row or response carries. */
export function maskChatId(chatId: string): string {
  const digits = chatId.replace(/\D/g, "");

  return `***${digits.slice(-3)}`;
}

// eslint-disable-next-line no-control-regex
const CONTROL_AND_BIDI = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;

const MAX_DISPLAY_NAME_CODE_POINTS = 64;

/**
 * The Telegram display name shown back to the staff member for "is this you?".
 * It is attacker-influenced text (the sender chose it), so it is stripped of
 * control and bidirectional-override characters, collapsed to one line and
 * capped by CODE POINT (never mid-surrogate). It is rendered as escaped text.
 */
export function sanitizeDisplayName(
  firstName: unknown,
  lastName: unknown
): string | null {
  const parts = [firstName, lastName].filter(
    (part): part is string => typeof part === "string"
  );
  const cleaned = parts
    .join(" ")
    .replace(CONTROL_AND_BIDI, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned === "") {
    return null;
  }

  return Array.from(cleaned).slice(0, MAX_DISPLAY_NAME_CODE_POINTS).join("");
}

/** `@abc***xyz`-style: enough to recognise your own handle, not enough to look anyone up. */
export function maskUsername(username: unknown): string | null {
  if (typeof username !== "string" || !/^[A-Za-z0-9_]{1,32}$/.test(username)) {
    return null;
  }

  if (username.length <= 2) {
    return `@${username[0]}*`;
  }

  return `@${username[0]}${"*".repeat(Math.min(username.length - 2, 6))}${username.at(-1)}`;
}
