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
 * - After the password step it distinguishes exactly three outcomes: `success`,
 *   and the codes `MFA_REQUIRED` and `MFA_ENROLLMENT_REQUIRED` (each with its
 *   token beside it). EVERY other body — whatever `error.code` or `message` it
 *   carries — is the same generic failure. `RATE_LIMITED` and
 *   `INVALID_CREDENTIALS` are deliberately not branched on.
 * - After the verify step it reads `success` and nothing else. A wrong code, an
 *   expired challenge, a spent challenge and an exhausted attempt budget are one
 *   answer; the page returns to the password step from its own clock and
 *   counter, rendered from server configuration, never from a refusal reason.
 *
 * ## Enrolment step (Issue #1425)
 *
 * `MFA_ENROLLMENT_REQUIRED` starts a pre-session enrolment: `enroll/start`
 * (answers the secret and otpauth URI), then `enroll/verify` with a code
 * (answers the recovery codes and, via cookies, the `aal2` session). The token
 * travels in `X-AWCMS-MFA-Enrollment-Token` and, like the challenge token,
 * lives in the caller's script memory only. Neither step's refusal reason is
 * read: a failed start, or an expired grant, is the same return to the
 * password step.
 *
 * The token lives in the caller's script memory only: this module neither
 * stores nor returns it anywhere but to that caller.
 */

export type LoginOutcome =
  | { kind: "success" }
  | { kind: "mfa"; challengeToken: string }
  | { kind: "enrol"; enrolmentToken: string }
  | { kind: "failed" };

/** Reads ONLY `success`, `error.code` and `error.details.mfaChallengeToken`. */
export function readLoginOutcome(ok: boolean, payload: unknown): LoginOutcome {
  if (!payload || typeof payload !== "object") return { kind: "failed" };
  const body = payload as {
    success?: unknown;
    error?: {
      code?: unknown;
      details?: { mfaChallengeToken?: unknown; mfaEnrollmentToken?: unknown };
    };
  };

  if (ok && body.success === true) return { kind: "success" };

  if (!ok && body.success === false && body.error?.code === "MFA_REQUIRED") {
    const token = body.error.details?.mfaChallengeToken;
    if (typeof token === "string" && token.length > 0) {
      return { kind: "mfa", challengeToken: token };
    }
  }

  // Issue #1425: a password-verified user with no factor yet, on a tenant whose
  // policy requires one, gets a grant that only `enroll/start`/`enroll/verify`
  // accept. Same shape as the challenge: the code, and the token beside it.
  if (
    !ok &&
    body.success === false &&
    body.error?.code === "MFA_ENROLLMENT_REQUIRED"
  ) {
    const token = body.error.details?.mfaEnrollmentToken;
    if (typeof token === "string" && token.length > 0) {
      return { kind: "enrol", enrolmentToken: token };
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

const ENROLMENT_TOKEN_HEADER = "X-AWCMS-MFA-Enrollment-Token";

/** Headers for `enroll/start` and `enroll/verify` before any session exists. */
export function buildEnrolHeaders(
  tenantId: string,
  enrolmentToken: string
): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-AWCMS-Tenant-ID": tenantId,
    [ENROLMENT_TOKEN_HEADER]: enrolmentToken
  };
}

/** The enrolment secret, shown only as a QR and a manual key. */
export type EnrolStart = { secret: string; otpauthUri: string };

/** Reads ONLY `success`, `data.secret` and `data.otpauthUri`. */
export function readEnrolStart(
  ok: boolean,
  payload: unknown
): EnrolStart | null {
  if (!ok || !payload || typeof payload !== "object") return null;
  const body = payload as {
    success?: unknown;
    data?: { secret?: unknown; otpauthUri?: unknown };
  };
  if (body.success !== true) return null;
  const secret = body.data?.secret;
  const otpauthUri = body.data?.otpauthUri;
  if (typeof secret !== "string" || secret.length === 0) return null;
  if (typeof otpauthUri !== "string" || otpauthUri.length === 0) return null;
  return { secret, otpauthUri };
}

/**
 * Reads ONLY `success` and `data.recoveryCodes`. `null` means "not accepted";
 * success without a usable list is success with no codes to show (the session
 * exists either way), never a failure.
 */
export function readEnrolVerify(
  ok: boolean,
  payload: unknown
): { recoveryCodes: string[] } | null {
  if (!ok || !payload || typeof payload !== "object") return null;
  const body = payload as {
    success?: unknown;
    data?: { recoveryCodes?: unknown };
  };
  if (body.success !== true) return null;
  const codes = body.data?.recoveryCodes;
  return {
    recoveryCodes: Array.isArray(codes)
      ? codes.filter((code): code is string => typeof code === "string")
      : []
  };
}

/** The `enroll/verify` request body. */
export function buildEnrolVerifyBody(value: string): { code: string } {
  return { code: value.replace(/\s+/g, "") };
}
