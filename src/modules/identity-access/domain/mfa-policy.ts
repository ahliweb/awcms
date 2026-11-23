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

/**
 * How a session reached `aal2` — `awcms_sessions.stepped_up_method`, matching
 * `sql/443`'s CHECK exactly (ADR-0168 A2). A recovery code is phishable and is
 * recorded separately so a passkey-required gate can refuse it (ADR-0168 §8).
 */
export type StepUpMethod = "totp" | "recovery_code" | "passkey";

/**
 * What raised a session to `aal2`. A passkey proof names its credential; the
 * others carry nothing more, so the shape mirrors the `sql/443` biconditional
 * (`stepped_up_passkey_id` NOT NULL exactly when the method is `passkey`).
 *
 * The `passkey` arm exists for the type to match the column, but nothing can
 * produce one yet: the credential table does not exist in this slice and
 * `awcms_sessions_passkey_step_up_unavailable` refuses the value at INSERT.
 */
export type StepUpProof =
  | { method: "totp" | "recovery_code" }
  | { method: "passkey"; passkeyId: string };

/**
 * The assurance a session is minted at. `aal2` cannot be stated without saying
 * how it was reached — the compiler makes every issuer name the proof, the way
 * `SessionIssueContext.originAuth` has no default (Issue #1405, ADR-0168 A2).
 */
export type SessionAssuranceGrant =
  { level: "aal1" } | { level: "aal2"; proof: StepUpProof };

/** The two `sql/443` columns written for a grant, in one place. */
export function stepUpColumns(grant: SessionAssuranceGrant): {
  method: StepUpMethod | null;
  passkeyId: string | null;
} {
  if (grant.level === "aal1") return { method: null, passkeyId: null };

  return {
    method: grant.proof.method,
    passkeyId: grant.proof.method === "passkey" ? grant.proof.passkeyId : null
  };
}

/**
 * Reads the `sql/443` columns back into a proof, or `null` for an `aal1` row.
 * Fails closed: an `aal2` row whose method is missing or unknown — which the
 * CHECK forbids, so only a hand-edited row or a future value can produce it —
 * yields `null`, the same answer as no step-up at all.
 */
export function stepUpProofFromColumns(
  assuranceLevel: SessionAssuranceLevel,
  method: string | null,
  passkeyId: string | null
): StepUpProof | null {
  if (assuranceLevel !== "aal2") return null;
  if (method === "totp" || method === "recovery_code") return { method };
  if (method === "passkey" && passkeyId) return { method, passkeyId };

  return null;
}

/**
 * The grant a stored assurance justifies: `aal2` only when the level is `aal2`
 * AND a proof was recovered for it. An `aal2` row whose proof cannot be read
 * yields `aal1` — a carried assurance (a handoff) never rises above what can be
 * shown, the same rule ADR-0050 applies to the level itself.
 */
export function assuranceGrantOf(
  assuranceLevel: SessionAssuranceLevel,
  proof: StepUpProof | null
): SessionAssuranceGrant {
  return assuranceLevel === "aal2" && proof
    ? { level: "aal2", proof }
    : { level: "aal1" };
}

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
