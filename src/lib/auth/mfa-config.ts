/**
 * MFA/TOTP config gate (Issue #184, epic ERP-readiness enterprise auth #177).
 * Adapted from awcms-mini `src/lib/auth/mfa-config.ts` (Issue #589).
 *
 * ADAPTATION vs mini: mini gates MFA behind a "full-online security" flag
 * (`isFullOnlineSecurityActive`, Issue #587) AND `AUTH_MFA_ENABLED`. This base
 * has NO full-online gate (that epic is not ported here), so the feature
 * switch is `AUTH_MFA_ENABLED` alone. Crucially, `isMfaFeatureEnabled` gates
 * only the *enrollment* surface (start/verify enrollment) — the login
 * challenge, self-service disable, and step-up are driven by database state
 * (an active factor row), never by this flag, so turning the flag off can
 * never let an already-enrolled identity bypass its second factor.
 */

const DEFAULT_TOTP_ISSUER = "AWCMS";
const DEFAULT_TOTP_PERIOD_SEC = 30;
const DEFAULT_TOTP_DIGITS = 6;
const DEFAULT_CHALLENGE_TTL_SEC = 300;
const DEFAULT_STEPUP_TTL_SEC = 300;
const DEFAULT_WINDOW_STEPS = 1;
const MAX_WINDOW_STEPS = 10;
const DEFAULT_MFA_RATE_LIMIT_MAX = 5;
const DEFAULT_MFA_RATE_LIMIT_WINDOW_SEC = 300;
const DEFAULT_MFA_MAX_VERIFY_ATTEMPTS = 5;
const DEFAULT_MFA_LOCKOUT_MINUTES = 15;
const KNOWN_TOTP_DIGITS = [6, 8] as const;

/**
 * Env vars required only when `AUTH_MFA_ENABLED=true`
 * (`scripts/validate-env.ts` and `scripts/security-readiness.ts`). Only the
 * encryption key needs its own dedicated required-var check — the TOTP
 * issuer/period/digits/TTL/rate-limit vars all have safe defaults below and
 * are never required. There is no default encryption key by design.
 */
export const AUTH_MFA_REQUIRED_WHEN_ENABLED = [
  "AUTH_MFA_SECRET_ENCRYPTION_KEY"
] as const;

/**
 * The feature switch for the MFA *enrollment* surface. When `false` (the
 * default), `POST /auth/mfa/totp/enroll/start` and `.../enroll/verify` refuse
 * with `403 MFA_DISABLED` and no new factor can be created — but login
 * challenge/disable/step-up still honor any factor that already exists.
 */
export function isMfaFeatureEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.AUTH_MFA_ENABLED === "true";
}

export function resolveTotpIssuer(
  env: NodeJS.ProcessEnv = process.env
): string {
  const raw = env.AUTH_MFA_TOTP_ISSUER?.trim();

  return raw && raw.length > 0 ? raw : DEFAULT_TOTP_ISSUER;
}

export function resolveTotpPeriodSec(
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = Number(env.AUTH_MFA_TOTP_PERIOD_SEC);

  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TOTP_PERIOD_SEC;
}

export function resolveTotpDigits(
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = Number(env.AUTH_MFA_TOTP_DIGITS);

  return (KNOWN_TOTP_DIGITS as readonly number[]).includes(raw)
    ? raw
    : DEFAULT_TOTP_DIGITS;
}

/**
 * Clock-drift tolerance, bounded to `[0, MAX_WINDOW_STEPS]`. A value outside
 * the safe range (or non-numeric) falls back to the default rather than
 * widening the replay/guess surface — an operator cannot silently set an
 * unbounded window.
 */
export function resolveWindowSteps(
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = Number(env.AUTH_MFA_TOTP_WINDOW_STEPS);

  if (!Number.isFinite(raw) || !Number.isInteger(raw) || raw < 0) {
    return DEFAULT_WINDOW_STEPS;
  }

  return Math.min(raw, MAX_WINDOW_STEPS);
}

export function resolveChallengeTtlSec(
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = Number(env.AUTH_MFA_CHALLENGE_TTL_SEC);

  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CHALLENGE_TTL_SEC;
}

/**
 * How long an `aal2` step-up stays fresh before a high-risk action must
 * re-verify. Server-controlled and short — never a client flag. Bounded > 0
 * (a non-positive/NaN value would make every step-up instantly stale).
 */
export function resolveStepUpTtlSec(
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = Number(env.AUTH_MFA_STEPUP_TTL_SEC);

  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_STEPUP_TTL_SEC;
}

/**
 * Source-scoped verification rate limit for the challenge/step-up endpoints.
 * Also doubles as the per-challenge `failed_attempts` cap, bounding a
 * distributed attacker rotating source IPs against one stolen challenge token.
 */
export function resolveMfaRateLimitMax(
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = Number(env.AUTH_MFA_RATE_LIMIT_MAX);

  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MFA_RATE_LIMIT_MAX;
}

export function resolveMfaRateLimitWindowSec(
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = Number(env.AUTH_MFA_RATE_LIMIT_WINDOW_SEC);

  return Number.isFinite(raw) && raw > 0
    ? raw
    : DEFAULT_MFA_RATE_LIMIT_WINDOW_SEC;
}

/**
 * Per-factor cumulative failed-verify lockout (Issue #184, F4) — independent of
 * source IP and challenge rotation. A non-positive/NaN value falls back to the
 * default rather than disabling the lockout (the same fail-closed reasoning as
 * `parsePositiveIntEnv` in `login-policy.ts`).
 */
export function resolveMfaMaxVerifyAttempts(
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = Number(env.AUTH_MFA_MAX_VERIFY_ATTEMPTS);

  return Number.isFinite(raw) && Number.isInteger(raw) && raw > 0
    ? raw
    : DEFAULT_MFA_MAX_VERIFY_ATTEMPTS;
}

export function resolveMfaLockoutMinutes(
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = Number(env.AUTH_MFA_LOCKOUT_MINUTES);

  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MFA_LOCKOUT_MINUTES;
}
