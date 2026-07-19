/**
 * MFA recovery codes (Issue #184) — ported from awcms-mini
 * `src/lib/auth/mfa-recovery-code.ts` (Issue #589). Single-use backup codes
 * shown once (enrollment-verify and regenerate), stored hash-only (never a
 * reversible form, unlike the TOTP secret itself — a recovery code never needs
 * to be recovered/displayed again after its one-time reveal, so a one-way hash
 * is correct here, same as session tokens).
 *
 * Named `*RecoveryCode`, not `*Password...` — avoids the CodeQL
 * `js/insufficient-password-hash` false positive: a fast sha256 hash is
 * correct for an 8-char CSPRNG-derived code, not a user-chosen password.
 */
import { createHash, randomBytes } from "node:crypto";
import { base32Encode } from "./totp";

/** `XXXX-XXXX` — 8 base32 chars (40 bits of entropy) from 5 random bytes, formatted for easy manual transcription. */
export function generateRecoveryCode(): string {
  const encoded = base32Encode(randomBytes(5));

  return `${encoded.slice(0, 4)}-${encoded.slice(4, 8)}`;
}

/** Normalizes (uppercase, strip non-alphanumerics) before hashing so a code is recognized whether or not the user retypes the dash/case exactly as shown. */
export function hashRecoveryCode(code: string): string {
  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, "");

  return `sha256:${createHash("sha256").update(normalized).digest("hex")}`;
}
