/**
 * Phone-number handling for `whatsapp_delivery` (Issue #963, ADR-0133 section
 * 5.6): normalise to E.164, keyed-hash for lookups, mask for display. Pure.
 *
 * The raw number is stored in exactly one column (`awcms_whatsapp_messages.
 * recipient`) because no adapter can deliver to a hash. Everything else —
 * suppression, consent, rate limits, logs, audit rows, events, list responses —
 * uses the hash or the masked form.
 */
import { createHmac } from "node:crypto";

import {
  parseKeyRing,
  type KeyRingKey,
  type KeyRingResult
} from "../../../lib/security/field-encryption";

const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

export type NormalizedPhone =
  { valid: true; e164: string } | { valid: false; reason: string };

/**
 * Accepts `+628123456789`, `00628123456789`, and (only when a default country
 * code is configured) a national `08123456789`. Spaces, dashes, dots and
 * parentheses are stripped. Anything else is refused rather than guessed:
 * delivering to a mis-parsed number is a message to a stranger.
 */
export function normalizePhoneNumber(
  raw: string,
  defaultCountryCode?: string
): NormalizedPhone {
  if (typeof raw !== "string") {
    return { valid: false, reason: "Phone number must be a string." };
  }

  const stripped = raw.trim().replace(/[\s().-]/g, "");

  if (!/^\+?\d+$/.test(stripped)) {
    return {
      valid: false,
      reason: "Phone number contains invalid characters."
    };
  }

  let candidate: string;

  if (stripped.startsWith("+")) {
    candidate = stripped;
  } else if (stripped.startsWith("00")) {
    candidate = `+${stripped.slice(2)}`;
  } else if (stripped.startsWith("0") && defaultCountryCode) {
    candidate = `+${defaultCountryCode}${stripped.slice(1)}`;
  } else {
    return {
      valid: false,
      reason:
        "Phone number must start with + or 00 and a country code (no default country is configured)."
    };
  }

  return E164_PATTERN.test(candidate)
    ? { valid: true, e164: candidate }
    : { valid: false, reason: "Phone number is not a valid E.164 number." };
}

/**
 * The recipient-hash key ring (Issue #963 security audit F1).
 *
 * The hash of a phone number is a lookup key for consent, suppression, rate
 * limits and duplicate detection, and the consent and suppression tables store
 * NOTHING ELSE about the recipient. A hash salted only with the (non-secret)
 * tenant id is a dictionary lookup away from the number: the number space is a
 * few hundred million values and the masked form leaks the last four digits, so
 * the whole table can be inverted in about a millisecond per row. Those rows
 * hold no plaintext, so the weakness could never be migrated away later.
 *
 * The hash is therefore a keyed HMAC-SHA256 under a SECRET ring
 * (`WHATSAPP_RECIPIENT_HASH_KEYS`, `keyId:base64` pairs separated by commas, the
 * shape ADR-0137 section 2 gives for key rings): the FIRST key writes, ALL keys
 * are read, and the key id is stored inside the value (`k1:<hex>`), so a
 * database copy is self-describing and rotation needs no schema change. There is
 * no default and no fallback: with no usable ring, enqueue and the consent and
 * suppression endpoints refuse (fail closed). A key id can never be retired
 * while any consent or suppression row (or retained backup) still carries it,
 * because those rows hold no plaintext to re-hash from.
 */
export type RecipientHashKey = KeyRingKey;

export type RecipientKeyRing = KeyRingResult;

/** The parsing and its rules live in the shared helper (ADR-0137, Issue #986); only the variable name is WhatsApp's. */
export function parseRecipientHashKeys(
  env: NodeJS.ProcessEnv = process.env
): RecipientKeyRing {
  // The literal `env.NAME` read stays here: the job env allow-list scanner
  // finds variables by that spelling, and a dynamic lookup would drop it.
  return parseKeyRing(
    env.WHATSAPP_RECIPIENT_HASH_KEYS,
    "WHATSAPP_RECIPIENT_HASH_KEYS"
  );
}

/** What a caller keeps for one recipient: the hash new rows are WRITTEN under, and every hash an existing row may carry. */
export type RecipientHashes = { primary: string; all: string[] };

/**
 * `HMAC-SHA256(key, tenantId 0x00 "whatsapp:recipient" 0x00 e164)`, hex,
 * prefixed with the key id. Binding the tenant id means the same number in two
 * tenants gives unrelated hashes; the key is what stops anyone holding only the
 * table from confirming a number.
 */
export function hashRecipient(
  tenantId: string,
  e164: string,
  key: RecipientHashKey
): string {
  const mac = createHmac("sha256", key.key)
    .update(tenantId)
    .update("\u0000")
    .update("whatsapp:recipient")
    .update("\u0000")
    .update(e164)
    .digest("hex");

  return `${key.id}:${mac}`;
}

export function buildRecipientHashes(
  tenantId: string,
  e164: string,
  ring: Extract<RecipientKeyRing, { ok: true }>
): RecipientHashes {
  const all = ring.keys.map((key) => hashRecipient(tenantId, e164, key));

  return { primary: all[0]!, all };
}

/**
 * The form a hash list takes in a query: `recipient_hash = ANY(
 * string_to_array(${text}, ','))`. A Bun.SQL array binding arrives as comma-
 * joined text (22P02) and cannot carry NULL, so the list is passed as one text
 * value; hashes are `keyId:hex` and can never contain a comma.
 */
export function hashListParam(hashes: RecipientHashes): string {
  return hashes.all.join(",");
}

/** Keeps the last four digits; never returns the raw value. */
export function maskRecipient(e164: string): string {
  const digits = e164.replace(/\D/g, "");

  if (digits.length <= 4) {
    return "*".repeat(digits.length);
  }

  return `+${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
}
