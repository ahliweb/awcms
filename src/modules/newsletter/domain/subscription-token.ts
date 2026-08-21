import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Confirmation and unsubscribe tokens (ADR-0103).
 *
 * ## Both are bearer credentials
 *
 * Whoever holds a confirmation token can confirm a subscription; whoever holds
 * an unsubscribe token can end one. Neither is guessable and neither is stored
 * in the clear — the same posture session tokens have here, and for the same
 * reason: a database read must not hand over the ability to act as somebody.
 *
 * ## Why SHA-256 and not a password hash
 *
 * A password is low-entropy and chosen by a human, so it needs a slow hash to
 * survive an offline attack. These are 256 bits from `randomBytes`, so there is
 * nothing to grind — a slow hash would only make the anonymous confirm endpoint
 * a cheap way to consume CPU. Same reasoning `session-token.ts` records.
 *
 * ## Why the comparison is constant-time
 *
 * The lookup is by hash, so the database does the matching and a timing signal
 * would leak nothing useful. `tokensMatch` exists for the paths that compare a
 * fetched hash in application code, where an early-exit `===` on a bearer
 * credential is the habit worth not forming.
 *
 * Pure module: no database, no I/O beyond the platform CSPRNG.
 */

/** 32 bytes, base64url — 256 bits of entropy in a link that survives an email client. */
export function generateSubscriptionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSubscriptionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Constant-time comparison of two token HASHES.
 *
 * Length-mismatched inputs answer `false` without calling `timingSafeEqual`,
 * which throws on unequal lengths — and the length of a hash is not a secret.
 */
export function tokensMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}

/**
 * A token as it arrives from a request.
 *
 * Bounded before it is hashed: hashing is cheap but not free, and an anonymous
 * endpoint that will hash whatever it is handed is an anonymous endpoint that
 * will hash a megabyte. The ceiling is generous against the 43-character tokens
 * this module issues, so a legitimate link can never hit it.
 */
export const MAX_SUBSCRIPTION_TOKEN_LENGTH = 200;

export function isWellFormedSubscriptionToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_SUBSCRIPTION_TOKEN_LENGTH &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}
