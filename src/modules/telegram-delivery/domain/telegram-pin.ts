/**
 * The verification PIN (Issue #1008, M5 of the #965 audit; ADR-0140 section 3).
 * Pure: no I/O.
 *
 * ## What it proves
 *
 * The bot answers a valid `/start <code>` with a PIN, in the chat that sent it.
 * The staff member must type that PIN into the admin to confirm. A confirmation
 * therefore proves the person can READ the chat they are about to bind, instead
 * of trusting an attacker-chosen display name beside a "yes" button. It does not
 * stop an attacker who talks the victim into typing a PIN the attacker relays;
 * it raises "recognise a name" to "carry out an instruction", and removes the
 * case where a distracted click alone binds a stranger.
 *
 * ## Why a short numeric PIN is enough
 *
 * It lives only for the pending window (`PENDING_CONFIRMATION_TTL_MS`, ten
 * minutes), is bound to one binding row, is stored only as a keyed hash, and the
 * number of WRONG answers is counted in the database: after
 * `PIN_MAX_ATTEMPTS` the binding is ended. Six digits against five attempts is a
 * 5-in-a-million guess. The bound is a database counter and not the rate
 * limiter on purpose: the shared limiter fails open when Redis is down.
 */
import { randomInt } from "node:crypto";

import {
  hashesEqual,
  keyedHashCandidates,
  keyedHashPrimary,
  type KeyRing
} from "../../../lib/security/field-encryption";
import { TELEGRAM_PIN_HASH_PURPOSE } from "./telegram-constants";

export const PIN_LENGTH = 6;
/** Wrong answers a pending binding tolerates before it is ended. */
export const PIN_MAX_ATTEMPTS = 5;

const PIN_PATTERN = /^[0-9]{6}$/;

export function generateVerificationPin(): string {
  return String(randomInt(0, 10 ** PIN_LENGTH)).padStart(PIN_LENGTH, "0");
}

export function isWellFormedPin(value: unknown): value is string {
  return typeof value === "string" && PIN_PATTERN.test(value);
}

/**
 * `<keyId>:<hex>`, keyed with the chat-hash ring's active key and bound to the
 * tenant AND the binding id, so a hash copied to another binding verifies nothing.
 */
export function hashVerificationPin(
  pin: string,
  tenantId: string,
  bindingId: string,
  ring: KeyRing
): string {
  return keyedHashPrimary(
    `${bindingId}:${pin}`,
    { purpose: TELEGRAM_PIN_HASH_PURPOSE, tenantId },
    ring
  );
}

/**
 * Constant-time check of a presented PIN against the stored hash, across every
 * ring key (the PIN may have been hashed just before a rotation). A missing
 * stored hash (a row created before the PIN existed) never verifies.
 */
export function verifyVerificationPin(
  presented: string,
  stored: string | null,
  tenantId: string,
  bindingId: string,
  ring: KeyRing
): boolean {
  if (stored === null || !isWellFormedPin(presented)) {
    return false;
  }

  let matched = false;

  for (const candidate of keyedHashCandidates(
    `${bindingId}:${presented}`,
    { purpose: TELEGRAM_PIN_HASH_PURPOSE, tenantId },
    ring
  )) {
    if (hashesEqual(stored, candidate)) {
      matched = true;
    }
  }

  return matched;
}
