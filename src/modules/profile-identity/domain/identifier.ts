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

/** Never returns the raw value — keeps only the last 4 characters visible. */
export function maskIdentifierValue(normalizedValue: string): string {
  if (normalizedValue.length <= 4) {
    return (
      "*".repeat(Math.max(normalizedValue.length - 1, 0)) +
      normalizedValue.slice(-1)
    );
  }

  return "*".repeat(normalizedValue.length - 4) + normalizedValue.slice(-4);
}
