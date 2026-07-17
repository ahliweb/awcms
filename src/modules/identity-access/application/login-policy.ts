import { verifyPassword } from "../../../lib/auth/password";
import { log } from "../../../lib/logging/logger";
import type { LoginDenyReason } from "../domain/login-policy";

/**
 * Application-layer companion to `../domain/login-policy.ts` (Issue #147).
 *
 * The domain module stays a pure decision function over already-resolved
 * inputs. This module owns the parts of the login policy that depend on the
 * *environment* and on infrastructure primitives — env-sourced thresholds,
 * the constant-time password comparison, and the response shape each deny
 * reason maps to — so `src/pages/api/v1/auth/login.ts` stays a thin route and
 * every one of those rules is unit-testable without a database.
 */

/**
 * Issue #147 §4 — `Number(process.env.X ?? 5)` only falls back on
 * undefined/null, never on a non-numeric string: `AUTH_LOGIN_MAX_ATTEMPTS=5x`
 * silently yields `NaN`, and `failedLoginCount >= NaN` is always `false`, so
 * the account lockout is disabled *entirely and silently* — unlimited
 * brute-force per account, with nothing anywhere saying so. `AUTH_SESSION_TTL_MIN`
 * as `NaN` likewise produces an Invalid Date `expires_at`.
 *
 * Every value this parses is a security threshold, so a value that is not a
 * usable positive integer is treated as absent: fall back to the documented
 * default and say so loudly, rather than propagate `NaN` into a comparison
 * that fails open. `0` and negatives are rejected as well as `NaN` — a
 * `maxFailedAttempts` of `0` would lock every account on its first attempt,
 * and a TTL of `0` mints already-expired sessions.
 */
export function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];

  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }

  const parsed = Number(raw);

  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    warnOnce(name, raw, fallback);
    return fallback;
  }

  return parsed;
}

/**
 * The warning is deduplicated per `name=value` because `resolveLoginPolicyConfig`
 * runs on every request to a public, unauthenticated endpoint: a per-request
 * warning would be a free log-volume amplifier for an attacker, and repeating
 * a message about a value that cannot change mid-process adds nothing.
 */
const warnedEnvValues = new Set<string>();

function warnOnce(name: string, raw: string, fallback: number): void {
  const dedupeKey = `${name}=${raw}`;

  if (warnedEnvValues.has(dedupeKey)) {
    return;
  }

  warnedEnvValues.add(dedupeKey);

  // `value` is echoed deliberately: these are operator-set numeric thresholds,
  // never secrets, and the malformed value is the whole point of the message.
  log("warning", "identity_access.login_policy.invalid_env_value", {
    moduleKey: "identity_access",
    envVar: name,
    value: raw,
    fallback,
    reason: "not a positive integer — falling back to the default"
  });
}

/** Test-only: clears the warn-once memory so tests don't bleed into each other. */
export function resetLoginPolicyEnvWarningsForTests(): void {
  warnedEnvValues.clear();
}

export const DEFAULT_MAX_FAILED_ATTEMPTS = 5;
export const DEFAULT_LOCKOUT_MINUTES = 15;
export const DEFAULT_SESSION_TTL_MIN = 120;
export const DEFAULT_RATE_LIMIT_MAX_ATTEMPTS = 20;
export const DEFAULT_RATE_LIMIT_WINDOW_SEC = 60;

export type LoginPolicyConfig = {
  maxFailedAttempts: number;
  lockoutMinutes: number;
  sessionTtlMin: number;
  rateLimitMaxAttempts: number;
  rateLimitWindowSec: number;
};

/**
 * Read per request rather than frozen at module load: `process.env` mutated by
 * a test (or by a process manager between requests) must take effect, and the
 * cost is a handful of `Number()` calls against an argon2id verify.
 */
export function resolveLoginPolicyConfig(): LoginPolicyConfig {
  return {
    maxFailedAttempts: parsePositiveIntEnv(
      "AUTH_LOGIN_MAX_ATTEMPTS",
      DEFAULT_MAX_FAILED_ATTEMPTS
    ),
    lockoutMinutes: DEFAULT_LOCKOUT_MINUTES,
    sessionTtlMin: parsePositiveIntEnv(
      "AUTH_SESSION_TTL_MIN",
      DEFAULT_SESSION_TTL_MIN
    ),
    rateLimitMaxAttempts: parsePositiveIntEnv(
      "AUTH_LOGIN_RATE_LIMIT_MAX",
      DEFAULT_RATE_LIMIT_MAX_ATTEMPTS
    ),
    rateLimitWindowSec: parsePositiveIntEnv(
      "AUTH_LOGIN_RATE_LIMIT_WINDOW_SEC",
      DEFAULT_RATE_LIMIT_WINDOW_SEC
    )
  };
}

/**
 * Issue #147 §1 — a constant argon2id hash of a passphrase no caller can
 * supply, verified against when the identifier resolves to no row.
 *
 * Without it, an unknown `loginIdentifier` skips the hash entirely (~0 ms)
 * while a known one pays argon2id m=64MB (~75 ms on the reference machine).
 * That gap is an order of magnitude — measurable over a network with no
 * statistics worth the name — and it maps a tenant's entire user list without
 * ever incrementing a single `failed_login_count`, so the lockout never fires
 * and nothing is audited as suspicious.
 *
 * Hardcoded rather than computed at boot so the parameters can never drift
 * from the ones a stored hash actually uses (`Bun.password.hash` defaults:
 * argon2id, v=19, m=65536, t=2, p=1 — identical to what `hashPassword` in
 * `src/lib/auth/password.ts` produces for a real credential, which is what
 * makes the two paths cost the same). Publishing this value in a public repo
 * is harmless by construction: it is a hash of a fixed string, guards no
 * account, and the whole point is that verifying against it always fails.
 */
const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=65536,t=2,p=1$fAIgqqjVoZBKo7AapSk97pzZqFCHVRUTya6jaASyLOw$kFemlPB6L4uhLJ3ls01XPHGygkLkkcKpvCgL9KA07gQ";

/**
 * `true` only when `passwordHash` exists and matches. When it is `undefined`
 * (no identity for this identifier), the verify still runs — against
 * `DUMMY_PASSWORD_HASH` — and its result is discarded, so both branches cost
 * one argon2id verify.
 *
 * This equalizes the dominant term, not the whole request: the surrounding
 * `SELECT`s still differ slightly between a hit and a miss. Closing the
 * ~75 ms → ~0 ms cliff is what takes the signal below the noise of a network
 * round trip; a residual sub-millisecond difference is not a practical oracle.
 */
export async function verifyPasswordOrDummy(
  password: string,
  passwordHash: string | undefined
): Promise<boolean> {
  if (passwordHash === undefined) {
    await verifyPassword(password, DUMMY_PASSWORD_HASH);
    return false;
  }

  return verifyPassword(password, passwordHash);
}

export type LoginDenyResponse = {
  status: number;
  code: string;
  message: string;
};

/**
 * Issue #147 §2 — the response for `locked` is deliberately byte-identical to
 * the one for `invalid_credentials`.
 *
 * `"Account is temporarily locked."` is reachable only once the identifier has
 * resolved to a real row, so answering it told any unauthenticated caller that
 * the account exists — a user-enumeration oracle that needs no valid password
 * and, unlike the timing one above, no measurement at all. Its only cost is
 * that a locked-out legitimate user is not told *why* they are being refused
 * by the API; that explanation belongs in a channel that has already
 * authenticated the user (e.g. the lockout notice on password reset), not in
 * an unauthenticated 401.
 *
 * `tenant_inactive` stays distinguishable on purpose: the tenant is named in
 * the request header by the caller, so its status leaks nothing about *which
 * identities exist* — and collapsing it would leave a misconfigured tenant's
 * users with an unactionable "invalid credentials" they can never resolve by
 * retyping a password.
 */
export function resolveLoginDenyResponse(
  reason: LoginDenyReason
): LoginDenyResponse {
  if (reason === "tenant_inactive") {
    return {
      status: 403,
      code: "ACCESS_DENIED",
      message: "Tenant is not active."
    };
  }

  return {
    status: 401,
    code: "AUTH_INVALID_CREDENTIALS",
    message: "Invalid login identifier or password."
  };
}
