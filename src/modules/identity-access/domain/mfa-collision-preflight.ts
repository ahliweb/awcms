/**
 * Census of which MFA authenticators `sql/114` will keep and which it will
 * disable — ADR-0087, Gelombang 7 PR 7.3 of Issue #423.
 *
 * Pure. The script that feeds it reads the database; every rule here is a
 * function of the rows, so the whole prediction is testable without one.
 *
 * ## Why a census instead of a migration that refuses
 *
 * `sql/112` aborts on an identifier collision, and that is right there: two
 * addresses differing only in case are possibly two PEOPLE, and merging them
 * cannot be undone. The situation here is the opposite. One human enrolled in
 * three tenants holds three TOTP secrets because this product told them to, and
 * a factor-per-human table can keep exactly one. Refusing to deploy over a state
 * the product itself manufactures is a gate pointed at the wrong thing.
 *
 * So the migration proceeds and this reports, BEFORE the window, exactly who
 * loses which authenticator. The failure this avoids is not data loss — the
 * losing rows are disabled, never deleted, and their owner can re-enrol — it is
 * a person discovering at 09:00 that the app on their phone no longer opens
 * their account, with nobody able to say why.
 *
 * ## The prediction must be the migration's rule, not a second opinion
 *
 * `rankFactors` implements `ORDER BY last_used_step DESC, activated_at DESC
 * NULLS LAST, id` — the same three keys, in the same order, as `sql/114` §3a. A
 * census that ranks even slightly differently is worse than none: it would name
 * the wrong survivor and be believed. `tests/mfa-collision-preflight.test.ts`
 * pins the two against each other by reading the migration's text.
 *
 * `last_used_step` leads because it is a TOTP step number and therefore
 * comparable ACROSS factors: the highest one identifies the authenticator most
 * recently used to actually log in, which is the app on the phone the person
 * still has. Ranking by `activated_at` would pick the newest enrolment, which
 * may well be the device that was replaced.
 */

/** One live (`pending` or `active`) factor, joined to the human who owns it. */
export type MfaCollisionFactor = {
  factorId: string;
  /** `null` when the identity was never linked — see `unlinked_factor`. */
  principalId: string | null;
  identityId: string;
  tenantId: string;
  tenantCode: string;
  factorType: string;
  status: string;
  lastUsedStep: number;
  activatedAt: Date | null;
};

/** One factor's fate under the migration, in the order the census printed it. */
export type MfaFactorFate = {
  factorId: string;
  tenantCode: string;
  status: string;
  lastUsedStep: number;
  activatedAt: Date | null;
};

export type MfaCollisionFinding =
  /**
   * One human holds more than one live factor. The migration keeps `survivor`
   * and lands every entry of `disabled` as `status = 'disabled'`.
   */
  | {
      kind: "multi_factor_principal";
      principalId: string;
      factorType: string;
      survivor: MfaFactorFate;
      disabled: readonly MfaFactorFate[];
    }
  /**
   * A live factor on an identity with no `principal_id`. It is NOT carried over
   * at all — `sql/114` §3a reads `WHERE i.principal_id IS NOT NULL` — so this
   * person's second factor silently stops existing rather than merely losing a
   * duplicate.
   *
   * It should be empty: `sql/112` linked every identity that existed, and
   * ADR-0086 taught all four identity writers to link at creation. A non-empty
   * list therefore means a FIFTH writer exists somewhere, which is worth knowing
   * for more reasons than this migration — an unlinked identity also counts no
   * failed logins.
   */
  | {
      kind: "unlinked_factor";
      factorId: string;
      identityId: string;
      tenantId: string;
      tenantCode: string;
      status: string;
    };

export type MfaCollisionReport = {
  factorsScanned: number;
  /** Humans who hold at least one live factor — the row count after migration. */
  principalsWithFactor: number;
  /** How many live factors will be disabled by the single-factor rule. */
  factorsThatWouldBeDisabled: number;
  findings: readonly MfaCollisionFinding[];
  /** True when no human loses an authenticator and nothing is left behind. */
  clear: boolean;
};

/**
 * `sql/114` §3a's `ORDER BY`, as data.
 *
 * Exported so the test can assert the migration still spells it this way rather
 * than trusting a comment — the ordering is the entire behavioural contract of
 * this module, and it lives in two files.
 */
export const SURVIVOR_ORDER_KEYS = [
  "last_used_step DESC",
  "activated_at DESC NULLS LAST",
  "id"
] as const;

/**
 * Highest `last_used_step` first, then latest `activated_at` (nulls last), then
 * `id` as the tiebreak that makes the result deterministic rather than
 * whatever the planner returned.
 */
export function rankFactors(
  factors: readonly MfaCollisionFactor[]
): MfaCollisionFactor[] {
  return [...factors].sort((left, right) => {
    if (left.lastUsedStep !== right.lastUsedStep) {
      return right.lastUsedStep - left.lastUsedStep;
    }

    const leftAt = left.activatedAt?.getTime() ?? null;
    const rightAt = right.activatedAt?.getTime() ?? null;

    // NULLS LAST, both directions, before comparing two real timestamps.
    if (leftAt === null && rightAt !== null) return 1;
    if (rightAt === null && leftAt !== null) return -1;
    if (leftAt !== null && rightAt !== null && leftAt !== rightAt) {
      return rightAt - leftAt;
    }

    return left.factorId < right.factorId
      ? -1
      : left.factorId > right.factorId
        ? 1
        : 0;
  });
}

function toFate(factor: MfaCollisionFactor): MfaFactorFate {
  return {
    factorId: factor.factorId,
    tenantCode: factor.tenantCode,
    status: factor.status,
    lastUsedStep: factor.lastUsedStep,
    activatedAt: factor.activatedAt
  };
}

/**
 * Classifies every live factor in the installation.
 *
 * Grouping is `(principal_id, factor_type)` — the same partition as the
 * migration's window function, and the same columns as the partial unique index
 * the result has to satisfy. Grouping by principal alone would under-report the
 * day a second factor type is added: two factors of DIFFERENT types are not a
 * collision and must not be reported as one.
 */
export function runMfaCollisionPreflight(
  factors: readonly MfaCollisionFactor[]
): MfaCollisionReport {
  const byPrincipal = new Map<string, MfaCollisionFactor[]>();
  const findings: MfaCollisionFinding[] = [];

  for (const factor of factors) {
    if (!factor.principalId) {
      findings.push({
        kind: "unlinked_factor",
        factorId: factor.factorId,
        identityId: factor.identityId,
        tenantId: factor.tenantId,
        tenantCode: factor.tenantCode,
        status: factor.status
      });

      continue;
    }

    const key = `${factor.principalId} ${factor.factorType}`;
    const group = byPrincipal.get(key);

    if (group) group.push(factor);
    else byPrincipal.set(key, [factor]);
  }

  let factorsThatWouldBeDisabled = 0;

  for (const group of byPrincipal.values()) {
    if (group.length < 2) continue;

    const ranked = rankFactors(group);
    const [survivor, ...losers] = ranked;

    factorsThatWouldBeDisabled += losers.length;

    findings.push({
      kind: "multi_factor_principal",
      principalId: survivor!.principalId!,
      factorType: survivor!.factorType,
      survivor: toFate(survivor!),
      disabled: losers.map(toFate)
    });
  }

  return {
    factorsScanned: factors.length,
    principalsWithFactor: new Set(
      [...byPrincipal.values()].map((group) => group[0]!.principalId)
    ).size,
    factorsThatWouldBeDisabled,
    findings,
    clear: findings.length === 0
  };
}
