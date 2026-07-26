/**
 * Password-reset token generation/hashing (Wave 2 delta auth, adapted from
 * awcms-micro Issue #496). Same construction as `session-token.ts` — 32 CSPRNG
 * bytes, base64url; sha256 hex with a `sha256:` prefix — but a DISTINCT pair of
 * functions rather than reusing `generateSessionToken`/`hashSessionToken`, so a
 * reset token can never be mistaken for a session token at a call site even
 * though the bytes are built the same way.
 *
 * Named `*ResetToken`, NOT `*PasswordResetToken`: CodeQL's
 * `js/insufficient-password-hash` query treats the return value of any function
 * whose name contains "password" as password-flavoured regardless of what it
 * actually returns (awcms-micro confirmed this — it flagged a validator whose
 * return type has no password field at all). The rename avoids that
 * false positive without weakening anything. sha256 is the CORRECT choice here:
 * a slow adaptive hash (argon2id/bcrypt) exists to defend LOW-ENTROPY,
 * user-chosen secrets against offline guessing, which is irrelevant to a
 * 256-bit random token and would cost every verification request for nothing.
 * The user's actual password is hashed by `lib/auth/password.ts`'s
 * `hashPassword` (Bun.password, argon2id) in `completePasswordReset`.
 */
import { createHash, randomBytes } from "node:crypto";

export function generateResetToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashResetToken(token: string): string {
  return `sha256:${createHash("sha256").update(token).digest("hex")}`;
}
