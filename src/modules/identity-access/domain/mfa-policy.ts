/**
 * Pure MFA decision functions (Issue #184). Same "pure decision, DB does the
 * fetching" shape as `domain/login-policy.ts` — testable without a database.
 *
 * Ported from awcms-mini `domain/mfa-policy.ts` (Issue #589) for the challenge
 * evaluation; the tenant-enforcement enum and session step-up evaluation are
 * new in this base (mini has neither a policy enum nor session assurance).
 */

// --- Login challenge validity (ported from mini) ---------------------------

export type MfaChallengeSnapshot = {
  expiresAt: Date;
  consumedAt: Date | null;
  failedAttempts: number;
};

export type MfaChallengeDenyReason =
  "not_found" | "already_used" | "too_many_attempts" | "expired";

export type MfaChallengeEvaluation =
  { outcome: "valid" } | { outcome: "invalid"; reason: MfaChallengeDenyReason };

export function evaluateMfaChallenge(
  row: MfaChallengeSnapshot | null,
  now: Date,
  maxAttempts: number
): MfaChallengeEvaluation {
  if (!row) {
    return { outcome: "invalid", reason: "not_found" };
  }

  if (row.consumedAt !== null) {
    return { outcome: "invalid", reason: "already_used" };
  }

  if (row.failedAttempts >= maxAttempts) {
    return { outcome: "invalid", reason: "too_many_attempts" };
  }

  if (row.expiresAt.getTime() <= now.getTime()) {
    return { outcome: "invalid", reason: "expired" };
  }

  return { outcome: "valid" };
}

// --- Tenant enforcement policy (new) ---------------------------------------

/**
 * Tenant-level MFA enforcement:
 * - `optional` — MFA is available but never required (safe default).
 * - `required_for_privileged` — required only for identities the application
 *   classifies as privileged (holders of privileged permissions / roles).
 * - `required_for_all` — required for every tenant user.
 */
export type MfaEnforcementLevel =
  "optional" | "required_for_privileged" | "required_for_all";

export const MFA_ENFORCEMENT_LEVELS: readonly MfaEnforcementLevel[] = [
  "optional",
  "required_for_privileged",
  "required_for_all"
];

export function isMfaEnforcementLevel(
  value: unknown
): value is MfaEnforcementLevel {
  return (
    typeof value === "string" &&
    (MFA_ENFORCEMENT_LEVELS as readonly string[]).includes(value)
  );
}

/**
 * Whether MFA is mandatory for a given user under a tenant policy. Pure: the
 * caller resolves `isPrivileged` (e.g. via `isPrivilegedFromPermissionKeys`)
 * and passes it in.
 *
 * Consumed at login AFTER the password check (Issue #184, F1): a valid-password
 * identity that is `required` but has no active factor is issued an
 * enrollment-scoped grant instead of a full session, and the step-up gate reuses
 * the same requirement to demand enrollment before high-risk actions. It is
 * NEVER evaluated at the enumeration boundary — by the time it runs, unknown
 * identifier / locked / wrong password have already collapsed to one response,
 * so it cannot become an account-enumeration oracle.
 */
export function resolveMfaRequirement(input: {
  level: MfaEnforcementLevel;
  isPrivileged: boolean;
}): boolean {
  switch (input.level) {
    case "required_for_all":
      return true;
    case "required_for_privileged":
      return input.isPrivileged;
    case "optional":
    default:
      return false;
  }
}

/**
 * Actions that are purely read-only. Holding ONLY these does not make a user
 * "privileged" for `required_for_privileged`. Everything else (create/update/
 * delete/configure/assign/approve/reset/...) is a write or administrative
 * capability and DOES. Fail-closed by construction: a new action is treated as
 * privileged unless it is explicitly listed here.
 */
const READ_ONLY_ACTIONS = new Set(["read", "analyze", "check"]);

/**
 * Classifies a tenant user as privileged from their granted permission keys
 * (`module_key.activity_code.action`). Privileged = holds at least one
 * permission whose action is not purely read-only. Pure so it is unit-testable.
 */
export function isPrivilegedFromPermissionKeys(
  permissionKeys: Iterable<string>
): boolean {
  for (const key of permissionKeys) {
    const action = key.slice(key.lastIndexOf(".") + 1);
    if (action.length > 0 && !READ_ONLY_ACTIONS.has(action)) {
      return true;
    }
  }
  return false;
}

// --- Session assurance / step-up (new) -------------------------------------

export type SessionAssuranceLevel = "aal1" | "aal2";

export type StepUpSnapshot = {
  assuranceLevel: SessionAssuranceLevel;
  steppedUpAt: Date | null;
};

export type StepUpEvaluation =
  | { satisfied: true }
  | { satisfied: false; reason: "not_stepped_up" | "expired" };

/**
 * Whether a session currently satisfies a step-up requirement for a high-risk
 * action. Requires `aal2` AND a `steppedUpAt` within `ttlSec`. Server-time
 * driven — a session that rose to `aal2` at login but has not re-verified
 * within the window is treated as `expired` and must step up again. A short,
 * server-controlled expiry (never a client flag) is the point.
 */
export function evaluateStepUp(
  snapshot: StepUpSnapshot,
  now: Date,
  ttlSec: number
): StepUpEvaluation {
  if (snapshot.assuranceLevel !== "aal2" || snapshot.steppedUpAt === null) {
    return { satisfied: false, reason: "not_stepped_up" };
  }

  const ageMs = now.getTime() - snapshot.steppedUpAt.getTime();

  if (ageMs > ttlSec * 1000) {
    return { satisfied: false, reason: "expired" };
  }

  return { satisfied: true };
}
