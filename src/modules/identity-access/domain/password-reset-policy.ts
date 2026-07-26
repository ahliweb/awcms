/**
 * Pure reset-token validity evaluation (Wave 2 delta auth, adapted from
 * awcms-micro Issue #496). Same "pure decision, the caller does the fetching"
 * shape as `login-policy.ts`'s `evaluateLoginAttempt` — testable with no
 * database.
 *
 * The order of the checks is deliberate: `already_used` is decided BEFORE
 * `expired`, so a token that was redeemed and has since aged out still reports
 * the reason that actually describes it. Only the audit log ever sees these
 * reasons — the endpoint collapses all three into one generic response, so no
 * unauthenticated caller can use them to fingerprint token state.
 */
/**
 * Whether a `login_identifier` can be mailed at all.
 *
 * `awcms_identities.login_identifier` is plain `text` with no format check
 * (sql/004) — it is normally an email address, but nothing in the schema says
 * so. Sending a reset link to a non-address would enqueue an undeliverable row
 * into the email outbox for the dispatcher to fail on, so the request path
 * treats a non-mailable identifier as simply ineligible, indistinguishably from
 * an unknown one.
 *
 * The shape test is deliberately the same one `maskIdentifierValue` uses to
 * pick its email branch (an `@` with a non-empty local part) rather than a
 * stricter RFC-ish pattern: this decides "is it worth queueing", not "is it
 * valid", and a stricter rule here would silently lock real users out of
 * recovery over an address their own tenant accepted at sign-up.
 */
export function isMailableLoginIdentifier(loginIdentifier: string): boolean {
  const trimmed = loginIdentifier.trim();
  const atIndex = trimmed.indexOf("@");

  return atIndex > 0 && atIndex < trimmed.length - 1;
}

export type PasswordResetTokenSnapshot = {
  expiresAt: Date;
  usedAt: Date | null;
};

export type PasswordResetDenyReason = "not_found" | "expired" | "already_used";

export type PasswordResetTokenEvaluation =
  | { outcome: "valid" }
  | { outcome: "invalid"; reason: PasswordResetDenyReason };

export function evaluatePasswordResetToken(
  row: PasswordResetTokenSnapshot | null,
  now: Date
): PasswordResetTokenEvaluation {
  if (!row) {
    return { outcome: "invalid", reason: "not_found" };
  }

  if (row.usedAt !== null) {
    return { outcome: "invalid", reason: "already_used" };
  }

  // `<=`, not `<`: a token whose expiry instant is exactly now is spent.
  if (row.expiresAt.getTime() <= now.getTime()) {
    return { outcome: "invalid", reason: "expired" };
  }

  return { outcome: "valid" };
}
