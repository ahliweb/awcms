/**
 * Invitation token generation/hashing (Gelombang 4 PR 4.1 of Issue #423,
 * ADR-0082). Same construction as `session-token.ts` and `reset-token.ts` — 32
 * CSPRNG bytes, base64url; sha256 hex with a `sha256:` prefix — but a DISTINCT
 * pair of functions rather than reusing either, so an invitation token can
 * never be mistaken for a session or reset token at a call site even though the
 * bytes are built the same way. `reset-token.ts` set that precedent explicitly;
 * this is the fifth pair to follow it.
 *
 * Named `*InviteToken`, NOT `*InvitationPasswordToken` or anything containing
 * "password": CodeQL's `js/insufficient-password-hash` query treats the return
 * value of any function whose name contains "password" as password-flavoured
 * regardless of what it actually returns. Nothing here is close to that word
 * today, and the naming rule is restated so the next token file inherits it
 * rather than rediscovering it.
 *
 * sha256 is the CORRECT choice here, and the reasoning is `reset-token.ts`'s: a
 * slow adaptive hash (argon2id/bcrypt) exists to defend LOW-ENTROPY,
 * user-chosen secrets against offline guessing, which is irrelevant to a
 * 256-bit random token and would cost every verification request for nothing.
 * The password the invitee chooses on acceptance is hashed by
 * `lib/auth/password.ts`'s `hashPassword` (Bun.password, argon2id).
 *
 * The raw token is returned to the caller exactly once, at issue and at resend,
 * and is never stored: `awcms_invitations.token_hash` holds only the value
 * `hashInviteToken` produces. Resend overwrites that column in place, which is
 * what invalidates the previous link.
 */
import { createHash, randomBytes } from "node:crypto";

export function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashInviteToken(token: string): string {
  return `sha256:${createHash("sha256").update(token).digest("hex")}`;
}
