export type IdentityStatus = "active" | "inactive" | "locked";
export type TenantUserStatus = "active" | "inactive";

export function isAccountLocked(lockedUntil: Date | null, now: Date): boolean {
  return lockedUntil !== null && lockedUntil.getTime() > now.getTime();
}

/**
 * The lockout threshold, written once in a form a person can read.
 *
 * Since Issue #483 the login route no longer CALLS this — the comparison is
 * made by the database, in the same statement that does the increment, because
 * a threshold evaluated in JS against a separately-read counter is a threshold
 * evaluated against a stale number. What this function still is: the single
 * readable statement of the rule, and `tests/login-policy.test.ts` pins the
 * route's SQL to the same comparison, so the two cannot say different things.
 *
 * Still called on the MFA-challenge path, which reads and decides under a row
 * lock it already holds.
 */
export function shouldLockAccount(
  failedLoginCount: number,
  maxFailedAttempts: number
): boolean {
  return failedLoginCount >= maxFailedAttempts;
}

export function computeLockedUntil(now: Date, lockoutMinutes: number): Date {
  return new Date(now.getTime() + lockoutMinutes * 60_000);
}

export type LoginIdentitySnapshot = {
  status: IdentityStatus;
  failedLoginCount: number;
  lockedUntil: Date | null;
};

export type LoginAttemptInput = {
  now: Date;
  tenantStatus: string | null;
  identity: LoginIdentitySnapshot | null;
  tenantUserStatus: TenantUserStatus | null;
  passwordMatches: boolean;
  maxFailedAttempts: number;
  lockoutMinutes: number;
};

export type LoginDenyReason =
  "tenant_inactive" | "locked" | "invalid_credentials";

export type LoginAttemptResult =
  | { outcome: "allow" }
  | {
      outcome: "deny";
      reason: LoginDenyReason;
      /**
       * Present when this failure must be COUNTED against a known identity.
       *
       * It carries no number, and that absence is the point (Issue #483). This
       * function used to return `failedLoginCount: identity.failedLoginCount + 1`
       * and the route wrote that absolute value back — a read-modify-write
       * across a READ COMMITTED transaction, so two concurrent failures both
       * read N and both wrote N+1. K parallel attempts cost one increment.
       *
       * The count is now computed by the database, which is the only place that
       * can compute it correctly. What stays here is the DECISION that a
       * failure counts at all, which is genuinely policy — an unknown identity
       * has nothing to count against, and a failure past an existing lock is
       * refused before it gets this far.
       */
      countFailedAttempt?: true;
      /**
       * The timestamp to apply IF — and only if — the database's incremented
       * count reaches `maxFailedAttempts`. Computed here because it is a
       * function of policy and the clock, not of the counter; applied
       * conditionally there because only the database knows the counter.
       */
      lockoutCandidateAt?: Date;
    };

export function evaluateLoginAttempt(
  input: LoginAttemptInput
): LoginAttemptResult {
  if (input.tenantStatus !== "active") {
    return { outcome: "deny", reason: "tenant_inactive" };
  }

  if (
    input.identity &&
    (input.identity.status === "locked" ||
      isAccountLocked(input.identity.lockedUntil, input.now))
  ) {
    return { outcome: "deny", reason: "locked" };
  }

  const isValid =
    input.identity !== null &&
    input.identity.status === "active" &&
    input.tenantUserStatus === "active" &&
    input.passwordMatches;

  if (isValid) {
    return { outcome: "allow" };
  }

  if (!input.identity) {
    return { outcome: "deny", reason: "invalid_credentials" };
  }

  return {
    outcome: "deny",
    reason: "invalid_credentials",
    countFailedAttempt: true,
    lockoutCandidateAt: computeLockedUntil(input.now, input.lockoutMinutes)
  };
}
