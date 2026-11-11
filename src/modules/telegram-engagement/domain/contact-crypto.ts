/**
 * The identity and content protections of `telegram_engagement` (ADR-0152
 * sections 6 and 6.4), all under the module's own ring.
 *
 *   - **Contact key**: a keyed HMAC of the Telegram user id whose hash domain
 *     is the TENANT and the ACCOUNT (the purpose string carries the account id),
 *     so the same person under two bots or two tenants yields unrelated keys
 *     (TG8). A lookup tries every ring key (rotation-safe).
 *   - **Chat id**: an AES-256-GCM envelope bound to purpose, tenant and the
 *     contact row id, so a ciphertext copied to another row fails to decrypt.
 *   - **Message text**: an envelope bound to the message row the same way.
 *   - **Masked label**: derived from the HASH, not from the id, so it carries no
 *     digit of the Telegram id at all.
 *
 * Pure module (crypto only).
 */
import { createHash } from "node:crypto";

import {
  decryptFieldToString,
  encryptField,
  keyedHashCandidates,
  keyedHashPrimary,
  type KeyRing
} from "../../../lib/security/field-encryption";
import {
  CHAT_AAD_PURPOSE,
  CONTACT_HASH_PURPOSE,
  TEXT_AAD_PURPOSE
} from "./telegram-engagement-constants";

function hashDomain(tenantId: string, accountId: string) {
  return {
    purpose: `${CONTACT_HASH_PURPOSE}:${accountId.toLowerCase()}`,
    tenantId: tenantId.toLowerCase()
  };
}

export function contactHash(
  userId: string,
  tenantId: string,
  accountId: string,
  ring: KeyRing
): string {
  return keyedHashPrimary(userId, hashDomain(tenantId, accountId), ring);
}

export function contactHashCandidates(
  userId: string,
  tenantId: string,
  accountId: string,
  ring: KeyRing
): string[] {
  return keyedHashCandidates(userId, hashDomain(tenantId, accountId), ring);
}

/** A random value of the stored hash's shape, written when a contact ENDS. */
export function erasedContactHash(): string {
  return `e:${createHash("sha256").update(crypto.randomUUID()).digest("hex")}`;
}

export function maskedLabelFor(hash: string): string {
  const hex = hash.slice(hash.indexOf(":") + 1);

  return `TG-${hex.slice(0, 6).toUpperCase()}`;
}

export function encryptChatId(
  chatId: string,
  tenantId: string,
  contactId: string,
  ring: KeyRing
): string {
  return encryptField(
    chatId,
    {
      purpose: CHAT_AAD_PURPOSE,
      tenantId: tenantId.toLowerCase(),
      rowId: contactId
    },
    ring
  );
}

export function decryptChatId(
  ciphertext: string,
  tenantId: string,
  contactId: string,
  ring: KeyRing
): string {
  return decryptFieldToString(
    ciphertext,
    {
      purpose: CHAT_AAD_PURPOSE,
      tenantId: tenantId.toLowerCase(),
      rowId: contactId
    },
    ring
  );
}

export function encryptMessageText(
  text: string,
  tenantId: string,
  messageId: string,
  ring: KeyRing
): string {
  return encryptField(
    text,
    {
      purpose: TEXT_AAD_PURPOSE,
      tenantId: tenantId.toLowerCase(),
      rowId: messageId
    },
    ring
  );
}

export function decryptMessageText(
  ciphertext: string,
  tenantId: string,
  messageId: string,
  ring: KeyRing
): string {
  return decryptFieldToString(
    ciphertext,
    {
      purpose: TEXT_AAD_PURPOSE,
      tenantId: tenantId.toLowerCase(),
      rowId: messageId
    },
    ring
  );
}
