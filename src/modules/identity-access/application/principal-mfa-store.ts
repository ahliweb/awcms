/**
 * The ONLY file that reads or writes `awcms_principal_mfa_factors` and
 * `awcms_principal_mfa_recovery_codes` — ADR-0087, Gelombang 7 PR 7.3 of Issue
 * #423.
 *
 * That exclusivity is enforced, not agreed: `bun run identity:principal-access:check`
 * guards both tables the same way it guards `awcms_principals`, because both are
 * GLOBAL and RLS-free and therefore have no policy standing between a careless
 * query and every human in the installation. **RLS bounds which ROWS a query may
 * see; that gate bounds which CALL SITES may issue one at all.**
 *
 * ## The projection invariant
 *
 * `secret_ciphertext` is returned by exactly one shape — `PrincipalFactor`, used
 * by the verification path — and by nothing else. `PrincipalFactorSummary`, what
 * every status/enumeration caller gets, does not carry the field at all. The
 * ordinary way to ask "does this person have MFA" therefore cannot accidentally
 * put an encrypted secret into a response body.
 *
 * ## Every query binds to one row
 *
 * Keyed on `id =`, `principal_id =`, or (for codes) `factor_id =`. There is no
 * listing, no search, no `LIKE`, and no pagination: a scannable MFA table tells
 * an attacker who has a second factor and who does not, which is a targeting
 * list.
 *
 * ## Holding a factor grants NOTHING
 *
 * Same boundary as ADR-0085. Nothing here resolves a permission, a role, or a
 * tenant membership. A factor proves the human is who they say; what they may do
 * is still decided by `awcms_tenant_users` under FORCE RLS, through the
 * chokepoint. The factor is global; the requirement to present one stays a
 * tenant's own policy.
 */

/** What the verification path needs. The ONLY shape carrying the ciphertext. */
export type PrincipalFactor = {
  id: string;
  secret_ciphertext: string;
  last_used_step: number;
  failed_verify_count: number;
  locked_until: Date | null;
};

/** What every other reader gets. Deliberately WITHOUT `secret_ciphertext`. */
export type PrincipalFactorSummary = {
  id: string;
  factorType: "totp";
  activatedAt: Date | null;
};

/** The principal's active factor, or `null`. Keyed on `principal_id =`. */
export async function findActiveFactor(
  tx: Bun.SQL,
  principalId: string
): Promise<PrincipalFactor | null> {
  const rows = (await tx`
    SELECT id, secret_ciphertext, last_used_step, failed_verify_count, locked_until
    FROM awcms_principal_mfa_factors
    WHERE principal_id = ${principalId} AND status = 'active'
  `) as PrincipalFactor[];

  return rows[0] ?? null;
}

/** Keyed on `principal_id =`. Carries no ciphertext — see the header. */
export async function findActiveFactorSummary(
  tx: Bun.SQL,
  principalId: string
): Promise<PrincipalFactorSummary | null> {
  const rows = (await tx`
    SELECT id, factor_type, activated_at
    FROM awcms_principal_mfa_factors
    WHERE principal_id = ${principalId} AND status = 'active'
  `) as { id: string; factor_type: "totp"; activated_at: Date | null }[];

  const row = rows[0];

  return row
    ? { id: row.id, factorType: row.factor_type, activatedAt: row.activated_at }
    : null;
}

/** The pending (not yet confirmed) factor. Keyed on `principal_id =`. */
export async function findPendingFactor(
  tx: Bun.SQL,
  principalId: string
): Promise<{ id: string; secret_ciphertext: string } | null> {
  const rows = (await tx`
    SELECT id, secret_ciphertext
    FROM awcms_principal_mfa_factors
    WHERE principal_id = ${principalId} AND status = 'pending'
  `) as { id: string; secret_ciphertext: string }[];

  return rows[0] ?? null;
}

/** Ids of every factor that is not yet disabled. Keyed on `principal_id =`. */
export async function findLiveFactorIds(
  tx: Bun.SQL,
  principalId: string
): Promise<string[]> {
  const rows = (await tx`
    SELECT id FROM awcms_principal_mfa_factors
    WHERE principal_id = ${principalId} AND status IN ('active', 'pending')
  `) as { id: string }[];

  return rows.map((row) => row.id);
}

/**
 * Discards any prior pending secret so only the most recently displayed QR can
 * be confirmed. Keyed on `principal_id =`.
 */
export async function deletePendingFactors(
  tx: Bun.SQL,
  principalId: string
): Promise<void> {
  await tx`
    DELETE FROM awcms_principal_mfa_factors
    WHERE principal_id = ${principalId} AND status = 'pending'
  `;
}

export async function insertPendingFactor(
  tx: Bun.SQL,
  principalId: string,
  ciphertext: string,
  now: Date
): Promise<void> {
  await tx`
    INSERT INTO awcms_principal_mfa_factors
      (principal_id, factor_type, secret_ciphertext, status, created_at, updated_at)
    VALUES (${principalId}, 'totp', ${ciphertext}, 'pending', ${now}, ${now})
  `;
}

/**
 * Promotes a confirmed pending factor to active, seeding the replay guard with
 * the step that confirmed it.
 *
 * Seeding `last_used_step` is not bookkeeping: without it the very code the user
 * just typed to enrol would still be accepted by the login path inside the same
 * time window. Keyed on `id =`.
 */
export async function activateFactor(
  tx: Bun.SQL,
  factorId: string,
  matchedStep: number,
  now: Date
): Promise<void> {
  await tx`
    UPDATE awcms_principal_mfa_factors
    SET status = 'active', activated_at = ${now}, updated_at = ${now},
        last_used_step = ${matchedStep}
    WHERE id = ${factorId}
  `;
}

/**
 * Disables every live factor for the human and reports which ones it disabled.
 *
 * Returns the ids rather than a count because the administrative reset path
 * audits what it touched, and "how many" is not something an operator reading
 * the log later can act on. Keyed on `principal_id =`.
 *
 * `disabledByTenantId` is the tenant that ORDERED an administrative reset, and
 * `null` when nobody did — a self-service disable (the `sql/114` backfill is the
 * other writer of a `null` here, standing down the factors that lost the
 * single-factor rule). It is written here rather than audited
 * elsewhere because this row is the only artefact that outlives the acting
 * tenant's log and stays on the side of the human who lost the factor —
 * ADR-0087, where writing an audit row into the reached tenants was found to be
 * both impossible under FORCE RLS and undesirable as a membership oracle.
 */
export async function disableLiveFactors(
  tx: Bun.SQL,
  principalId: string,
  now: Date,
  disabledByTenantId: string | null
): Promise<string[]> {
  const rows = (await tx`
    UPDATE awcms_principal_mfa_factors
    SET status = 'disabled', disabled_at = ${now}, updated_at = ${now},
        disabled_by_tenant_id = ${disabledByTenantId}
    WHERE principal_id = ${principalId} AND status IN ('active', 'pending')
    RETURNING id
  `) as { id: string }[];

  return rows.map((row) => row.id);
}

/**
 * Advances the replay guard, as a compare-and-swap rather than a blind SET.
 *
 * Two concurrent requests replaying the SAME timestep cannot both win: the
 * loser's UPDATE matches zero rows and its `false` return is treated as a
 * replay. This is `sql/024`'s guarantee carried over unchanged — the move to the
 * principal must not quietly turn a CAS into a write. Keyed on `id =`.
 */
export async function advanceLastUsedStep(
  tx: Bun.SQL,
  factorId: string,
  matchedStep: number,
  now: Date
): Promise<boolean> {
  const rows = (await tx`
    UPDATE awcms_principal_mfa_factors
    SET last_used_step = ${matchedStep}, updated_at = ${now}
    WHERE id = ${factorId} AND last_used_step < ${matchedStep}
    RETURNING id
  `) as { id: string }[];

  return rows.length > 0;
}

/**
 * Takes the row lock every verify attempt against this factor serializes on.
 *
 * Without it the lock-check and the increment are a read-modify-write over a
 * stale snapshot, and concurrent wrong-code verifies across distinct
 * challenges/IPs lost-update so the factor never reaches the threshold —
 * re-opening the exact cross-challenge brute force the lockout exists to close
 * (ADR-0027 auditor HIGH-1 / F4). Keyed on `id =`.
 */
export async function lockFactorForVerify(
  tx: Bun.SQL,
  factorId: string
): Promise<{ failed_verify_count: number; locked_until: Date | null } | null> {
  const rows = (await tx`
    SELECT failed_verify_count, locked_until
    FROM awcms_principal_mfa_factors
    WHERE id = ${factorId}
    FOR UPDATE
  `) as { failed_verify_count: number; locked_until: Date | null }[];

  return rows[0] ?? null;
}

/** A successful verify clears the cumulative lockout. Keyed on `id =`. */
export async function clearFactorFailures(
  tx: Bun.SQL,
  factorId: string,
  now: Date
): Promise<void> {
  await tx`
    UPDATE awcms_principal_mfa_factors
    SET failed_verify_count = 0, locked_until = NULL, updated_at = ${now}
    WHERE id = ${factorId}
  `;
}

/**
 * Increments the cumulative failure counter and locks the factor at the cap.
 *
 * Both are expressions evaluated by PostgreSQL against the current row, under
 * the lock `lockFactorForVerify` holds — never a JS read-modify-write. Keyed on
 * `id =`.
 */
export async function recordFactorVerifyFailure(
  tx: Bun.SQL,
  factorId: string,
  maxAttempts: number,
  lockedUntil: Date,
  now: Date
): Promise<void> {
  await tx`
    UPDATE awcms_principal_mfa_factors
    SET failed_verify_count =
          CASE WHEN failed_verify_count + 1 >= ${maxAttempts} THEN 0
               ELSE failed_verify_count + 1 END,
        locked_until =
          CASE WHEN failed_verify_count + 1 >= ${maxAttempts} THEN ${lockedUntil}
               ELSE locked_until END,
        updated_at = ${now}
    WHERE id = ${factorId}
  `;
}

export async function insertRecoveryCodeHash(
  tx: Bun.SQL,
  principalId: string,
  factorId: string,
  codeHash: string
): Promise<void> {
  await tx`
    INSERT INTO awcms_principal_mfa_recovery_codes
      (principal_id, factor_id, code_hash)
    VALUES (${principalId}, ${factorId}, ${codeHash})
  `;
}

/** Keyed on `principal_id =`. */
export async function deleteRecoveryCodesForPrincipal(
  tx: Bun.SQL,
  principalId: string
): Promise<void> {
  await tx`
    DELETE FROM awcms_principal_mfa_recovery_codes
    WHERE principal_id = ${principalId}
  `;
}

/** Keyed on `factor_id =`. */
export async function deleteRecoveryCodesForFactor(
  tx: Bun.SQL,
  factorId: string
): Promise<void> {
  await tx`
    DELETE FROM awcms_principal_mfa_recovery_codes
    WHERE factor_id = ${factorId}
  `;
}

/**
 * Spends one recovery code, re-asserting `used_at IS NULL` in the same statement
 * so two concurrent requests with the same code cannot both consume it. Keyed on
 * `principal_id =` and `factor_id =`.
 */
export async function consumeRecoveryCode(
  tx: Bun.SQL,
  principalId: string,
  factorId: string,
  codeHash: string,
  now: Date
): Promise<boolean> {
  const rows = (await tx`
    UPDATE awcms_principal_mfa_recovery_codes
    SET used_at = ${now}
    WHERE principal_id = ${principalId} AND factor_id = ${factorId}
      AND code_hash = ${codeHash} AND used_at IS NULL
    RETURNING id
  `) as { id: string }[];

  return rows.length > 0;
}
