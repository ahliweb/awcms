/**
 * MFA challenge / step-up token generation and hashing (Issue #184) — ported
 * from awcms-mini `src/lib/auth/mfa-challenge-token.ts` (Issue #589). Same
 * shape as `session-token.ts` (32 random bytes, base64url; sha256 hex with a
 * `sha256:` prefix), a distinct pair of functions so a challenge token can
 * never be confused with a session token at a call site even though the
 * construction is identical. Only the hash is ever persisted.
 */
import { createHash, randomBytes } from "node:crypto";

export function generateChallengeToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashChallengeToken(token: string): string {
  return `sha256:${createHash("sha256").update(token).digest("hex")}`;
}
