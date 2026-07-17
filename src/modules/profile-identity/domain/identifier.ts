import { createHash } from "node:crypto";

export const IDENTIFIER_TYPES = [
  "email",
  "phone",
  "whatsapp",
  "national_id",
  "tax_id",
  "external_code",
  "other"
] as const;
export type IdentifierType = (typeof IDENTIFIER_TYPES)[number];

/** Normalizes a raw identifier value so the same real-world value always hashes/dedupes to the same key. */
export function normalizeIdentifierValue(
  type: IdentifierType,
  rawValue: string
): string {
  const trimmed = rawValue.trim();

  if (type === "email") {
    return trimmed.toLowerCase();
  }

  if (type === "phone" || type === "whatsapp") {
    return trimmed.replace(/[^\d+]/g, "");
  }

  return trimmed;
}

export function hashIdentifierValue(normalizedValue: string): string {
  return createHash("sha256").update(normalizedValue).digest("hex");
}

/**
 * Never returns the raw value. Two shapes (Issue #144, ported from
 * awcms-mini's `maskIdentifier`):
 * - Email-shaped values (an `@` with a non-empty local part) keep the domain
 *   and the local part's first character visible: `budi.santoso@example.com`
 *   -> `b***********@example.com`. The generic tail mask turns every address
 *   into the same unreadable star run ending in `.com`, which defeats the
 *   whole point of the `masked_value`/`to_address_masked` columns: they exist
 *   so an admin can tell recipients apart in the email outbox/suppression
 *   lists (doc 04 §Alur perlindungan data sensitif — masked value is the
 *   display projection, the raw value stays behind access control).
 * - Everything else (phone, NIK, tax id, external code, ...) keeps only the
 *   last 4 characters, and nothing at all when the value is that short — a
 *   4-character value has no non-leaking tail to show.
 *
 * The email branch is detected from the value itself rather than from an
 * `identifierType` argument, so every existing call site keeps working
 * unchanged (the email module masks addresses it never stores as profile
 * identifiers, and has no `IdentifierType` to pass).
 */
export function maskIdentifierValue(normalizedValue: string): string {
  const atIndex = normalizedValue.indexOf("@");

  if (atIndex > 0) {
    const localPart = normalizedValue.slice(0, atIndex);
    const domainPart = normalizedValue.slice(atIndex);

    // `Math.max(..., 1)` keeps a single-character local part from being
    // published verbatim as `a@example.com`.
    return `${localPart[0]}${"*".repeat(Math.max(localPart.length - 1, 1))}${domainPart}`;
  }

  return maskTail(normalizedValue);
}

function maskTail(value: string, visibleTailLength = 4): string {
  if (value.length <= visibleTailLength) {
    return "*".repeat(value.length);
  }

  return `${"*".repeat(value.length - visibleTailLength)}${value.slice(-visibleTailLength)}`;
}
