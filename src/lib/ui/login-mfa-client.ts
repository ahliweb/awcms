/**
 * Pure helpers for the `/login` second-factor step (Issue #1365).
 *
 * `POST /api/v1/auth/login` answers `401 MFA_REQUIRED` — and only after the
 * password was correct — with the challenge token in `error.details`. The page
 * then posts that token plus a TOTP (or recovery) code to
 * `POST /api/v1/auth/mfa/totp/verify`.
 *
 * ## Anti-oracle (the reason these are separate, tiny functions)
 *
 * The page must never reconstruct WHY a step failed:
 *
 * - After the password step it distinguishes exactly two outcomes: `success`,
 *   and the code `MFA_REQUIRED` (with the token beside it). EVERY other body —
 *   whatever `error.code` or `message` it carries — is the same generic
 *   failure. `MFA_ENROLLMENT_REQUIRED`, `RATE_LIMITED`, `INVALID_CREDENTIALS`
 *   are deliberately not branched on.
 * - After the verify step it reads `success` and nothing else. A wrong code, an
 *   expired challenge, a spent challenge and an exhausted attempt budget are one
 *   answer; the page returns to the password step from its own clock and
 *   counter, rendered from server configuration, never from a refusal reason.
 *
 * The token lives in the caller's script memory only: this module neither
 * stores nor returns it anywhere but to that caller.
 */

export type LoginOutcome =
  | { kind: "success" }
  | { kind: "mfa"; challengeToken: string }
  | { kind: "failed" };

/** Reads ONLY `success`, `error.code` and `error.details.mfaChallengeToken`. */
export function readLoginOutcome(ok: boolean, payload: unknown): LoginOutcome {
  if (!payload || typeof payload !== "object") return { kind: "failed" };
  const body = payload as {
    success?: unknown;
    error?: { code?: unknown; details?: { mfaChallengeToken?: unknown } };
  };

  if (ok && body.success === true) return { kind: "success" };

  if (!ok && body.success === false && body.error?.code === "MFA_REQUIRED") {
    const token = body.error.details?.mfaChallengeToken;
    if (typeof token === "string" && token.length > 0) {
      return { kind: "mfa", challengeToken: token };
    }
  }
  return { kind: "failed" };
}

/** Reads ONLY `success` — nothing else in the body is consulted. */
export function readVerifySuccess(ok: boolean, payload: unknown): boolean {
  if (!ok || !payload || typeof payload !== "object") return false;
  return (payload as { success?: unknown }).success === true;
}

/** The verify request body: the code, or the recovery code, never both. */
export function buildVerifyBody(
  challengeToken: string,
  value: string,
  recovery: boolean
): Record<string, string> {
  const trimmed = value.trim();
  return recovery
    ? { mfaChallengeToken: challengeToken, recoveryCode: trimmed }
    : {
        mfaChallengeToken: challengeToken,
        code: trimmed.replace(/\s+/g, "")
      };
}

/** A 6-digit TOTP code (spaces tolerated, as authenticator apps group digits). */
export function isPlausibleTotpCode(value: string): boolean {
  return /^\d{6}$/.test(value.replace(/\s+/g, ""));
}

/**
 * Tracks one challenge's budget from server configuration. `exhausted()` is
 * true once the page should drop back to the password step: the attempt cap is
 * spent or the challenge lifetime has elapsed on the page's own clock.
 */
export function createChallengeBudget(
  ttlSec: number,
  maxAttempts: number,
  now: () => number = Date.now
) {
  const startedAt = now();
  let attempts = 0;
  return {
    recordFailure(): void {
      attempts += 1;
    },
    exhausted(): boolean {
      return attempts >= maxAttempts || now() - startedAt >= ttlSec * 1000;
    }
  };
}
