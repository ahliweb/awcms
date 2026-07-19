/**
 * MFA/TOTP application logic (Issue #184). Ported/adapted from awcms-mini
 * `modules/identity-access/application/mfa.ts` (Issue #589) with tables renamed
 * `awcms_mini_*` -> `awcms_*`. New here: `adminResetMfa` and
 * `verifyStepUpFactor` (mini has neither an admin reset nor step-up), and the
 * replay-safe factor verification is refactored into one shared helper
 * (`consumeFactorCredential`) used by both the login challenge and step-up.
 *
 * Every function is fail-closed on a missing/invalid
 * `AUTH_MFA_SECRET_ENCRYPTION_KEY` (`resolveMfaEncryptionKey` returning `null`)
 * — treated as `MFA_MISCONFIGURED`, never as "skip verification". There is no
 * default encryption key: a DB backup alone yields no usable secret.
 */
import {
  base32Encode,
  buildOtpauthUri,
  generateTotpSecret,
  verifyTotpCode
} from "../../../lib/auth/totp";
import {
  decryptMfaSecret,
  encryptMfaSecret,
  resolveMfaEncryptionKey
} from "../../../lib/auth/mfa-secret-crypto";
import {
  resolveTotpDigits,
  resolveTotpPeriodSec,
  resolveTotpIssuer,
  resolveWindowSteps,
  resolveMfaMaxVerifyAttempts,
  resolveMfaLockoutMinutes
} from "../../../lib/auth/mfa-config";
import {
  generateRecoveryCode,
  hashRecoveryCode
} from "../../../lib/auth/mfa-recovery-code";
import {
  generateChallengeToken,
  hashChallengeToken
} from "../../../lib/auth/mfa-challenge-token";
import {
  evaluateMfaChallenge,
  type MfaChallengeDenyReason
} from "../domain/mfa-policy";
import { resolveActiveSession } from "./session-lookup";

const RECOVERY_CODE_COUNT = 10;

async function insertRecoveryCodes(
  tx: Bun.SQL,
  tenantId: string,
  identityId: string,
  factorId: string
): Promise<string[]> {
  const rawCodes: string[] = [];

  for (let i = 0; i < RECOVERY_CODE_COUNT; i += 1) {
    const rawCode = generateRecoveryCode();
    rawCodes.push(rawCode);

    await tx`
      INSERT INTO awcms_identity_mfa_recovery_codes
        (tenant_id, identity_id, factor_id, code_hash)
      VALUES (${tenantId}, ${identityId}, ${factorId}, ${hashRecoveryCode(rawCode)})
    `;
  }

  return rawCodes;
}

export type MfaStatus = {
  enabled: boolean;
  factorType?: "totp";
  activatedAt?: string;
};

export async function getMfaStatus(
  tx: Bun.SQL,
  tenantId: string,
  identityId: string
): Promise<MfaStatus> {
  const rows = (await tx`
    SELECT factor_type, activated_at
    FROM awcms_identity_mfa_factors
    WHERE tenant_id = ${tenantId} AND identity_id = ${identityId} AND status = 'active'
  `) as { factor_type: "totp"; activated_at: Date }[];
  const row = rows[0];

  if (!row) {
    return { enabled: false };
  }

  return {
    enabled: true,
    factorType: row.factor_type,
    activatedAt: new Date(row.activated_at).toISOString()
  };
}

export type StartEnrollmentResult =
  | { ok: true; secretBase32: string; otpauthUri: string }
  | { ok: false; code: "MFA_ALREADY_ACTIVE" | "MFA_MISCONFIGURED" };

/**
 * Generates a fresh secret and stores it as a `pending` factor — unusable for
 * login until confirmed via `verifyTotpEnrollment`. Re-starting enrollment
 * discards any prior pending secret, so only the most recently displayed
 * QR/secret is ever valid to confirm.
 */
export async function startTotpEnrollment(
  tx: Bun.SQL,
  tenantId: string,
  identityId: string,
  loginIdentifier: string,
  env: NodeJS.ProcessEnv,
  now: Date
): Promise<StartEnrollmentResult> {
  const key = resolveMfaEncryptionKey(env);

  if (!key) {
    return { ok: false, code: "MFA_MISCONFIGURED" };
  }

  const activeRows = await tx`
    SELECT id FROM awcms_identity_mfa_factors
    WHERE tenant_id = ${tenantId} AND identity_id = ${identityId} AND status = 'active'
  `;

  if (activeRows.length > 0) {
    return { ok: false, code: "MFA_ALREADY_ACTIVE" };
  }

  await tx`
    DELETE FROM awcms_identity_mfa_factors
    WHERE tenant_id = ${tenantId} AND identity_id = ${identityId} AND status = 'pending'
  `;

  const secret = generateTotpSecret();
  const ciphertext = encryptMfaSecret(secret, key);
  const digits = resolveTotpDigits(env);
  const periodSec = resolveTotpPeriodSec(env);
  const issuer = resolveTotpIssuer(env);

  await tx`
    INSERT INTO awcms_identity_mfa_factors
      (tenant_id, identity_id, factor_type, secret_ciphertext, status, created_at, updated_at)
    VALUES (${tenantId}, ${identityId}, 'totp', ${ciphertext}, 'pending', ${now}, ${now})
  `;

  return {
    ok: true,
    secretBase32: base32Encode(secret),
    otpauthUri: buildOtpauthUri({
      secret,
      issuer,
      accountName: loginIdentifier,
      digits,
      periodSec
    })
  };
}

export type VerifyEnrollmentResult =
  | { ok: true; recoveryCodes: string[] }
  | {
      ok: false;
      code:
        "MFA_ENROLLMENT_NOT_FOUND" | "MFA_INVALID_CODE" | "MFA_MISCONFIGURED";
    };

export async function verifyTotpEnrollment(
  tx: Bun.SQL,
  tenantId: string,
  identityId: string,
  code: string,
  env: NodeJS.ProcessEnv,
  now: Date
): Promise<VerifyEnrollmentResult> {
  const key = resolveMfaEncryptionKey(env);

  if (!key) {
    return { ok: false, code: "MFA_MISCONFIGURED" };
  }

  const rows = (await tx`
    SELECT id, secret_ciphertext
    FROM awcms_identity_mfa_factors
    WHERE tenant_id = ${tenantId} AND identity_id = ${identityId} AND status = 'pending'
  `) as { id: string; secret_ciphertext: string }[];
  const row = rows[0];

  if (!row) {
    return { ok: false, code: "MFA_ENROLLMENT_NOT_FOUND" };
  }

  let matchedStep: number | null;

  try {
    const secret = decryptMfaSecret(row.secret_ciphertext, key);
    matchedStep = verifyTotpCode(secret, code, now.getTime(), {
      periodSec: resolveTotpPeriodSec(env),
      digits: resolveTotpDigits(env),
      windowSteps: resolveWindowSteps(env)
    });
  } catch {
    matchedStep = null;
  }

  if (matchedStep === null) {
    return { ok: false, code: "MFA_INVALID_CODE" };
  }

  await tx`
    UPDATE awcms_identity_mfa_factors
    SET status = 'active', activated_at = ${now}, updated_at = ${now},
        last_used_step = ${matchedStep}
    WHERE id = ${row.id}
  `;

  const recoveryCodes = await insertRecoveryCodes(
    tx,
    tenantId,
    identityId,
    row.id
  );

  return { ok: true, recoveryCodes };
}

export type DisableMfaResult =
  { ok: true } | { ok: false; code: "MFA_NOT_ACTIVE" };

export async function disableMfa(
  tx: Bun.SQL,
  tenantId: string,
  identityId: string,
  now: Date
): Promise<DisableMfaResult> {
  const rows = await tx`
    SELECT id FROM awcms_identity_mfa_factors
    WHERE tenant_id = ${tenantId} AND identity_id = ${identityId} AND status IN ('active', 'pending')
  `;

  if (rows.length === 0) {
    return { ok: false, code: "MFA_NOT_ACTIVE" };
  }

  await tx`
    UPDATE awcms_identity_mfa_factors
    SET status = 'disabled', disabled_at = ${now}, updated_at = ${now}
    WHERE tenant_id = ${tenantId} AND identity_id = ${identityId} AND status IN ('active', 'pending')
  `;

  await tx`
    DELETE FROM awcms_identity_mfa_recovery_codes
    WHERE tenant_id = ${tenantId} AND identity_id = ${identityId}
  `;

  return { ok: true };
}

export type RegenerateRecoveryCodesResult =
  { ok: true; recoveryCodes: string[] } | { ok: false; code: "MFA_NOT_ACTIVE" };

export async function regenerateRecoveryCodes(
  tx: Bun.SQL,
  tenantId: string,
  identityId: string
): Promise<RegenerateRecoveryCodesResult> {
  const rows = (await tx`
    SELECT id FROM awcms_identity_mfa_factors
    WHERE tenant_id = ${tenantId} AND identity_id = ${identityId} AND status = 'active'
  `) as { id: string }[];
  const row = rows[0];

  if (!row) {
    return { ok: false, code: "MFA_NOT_ACTIVE" };
  }

  await tx`
    DELETE FROM awcms_identity_mfa_recovery_codes
    WHERE tenant_id = ${tenantId} AND factor_id = ${row.id}
  `;

  const recoveryCodes = await insertRecoveryCodes(
    tx,
    tenantId,
    identityId,
    row.id
  );

  return { ok: true, recoveryCodes };
}

export type ActiveMfaFactor = {
  id: string;
  secret_ciphertext: string;
  last_used_step: number;
  failed_verify_count: number;
  locked_until: Date | null;
};

/** Used by `login.ts` (and step-up) to fetch the identity's active factor, if any. */
export async function findActiveMfaFactor(
  tx: Bun.SQL,
  tenantId: string,
  identityId: string
): Promise<ActiveMfaFactor | null> {
  const rows = (await tx`
    SELECT id, secret_ciphertext, last_used_step, failed_verify_count, locked_until
    FROM awcms_identity_mfa_factors
    WHERE tenant_id = ${tenantId} AND identity_id = ${identityId} AND status = 'active'
  `) as ActiveMfaFactor[];

  return rows[0] ?? null;
}

export async function createMfaChallenge(
  tx: Bun.SQL,
  tenantId: string,
  identityId: string,
  ttlSec: number,
  now: Date
): Promise<{ token: string; expiresAt: Date }> {
  const rawToken = generateChallengeToken();
  const tokenHash = hashChallengeToken(rawToken);
  const expiresAt = new Date(now.getTime() + ttlSec * 1000);

  await tx`
    INSERT INTO awcms_mfa_challenges (tenant_id, identity_id, challenge_token_hash, purpose, expires_at)
    VALUES (${tenantId}, ${identityId}, ${tokenHash}, 'login', ${expiresAt})
  `;

  return { token: rawToken, expiresAt };
}

/**
 * Issue #184 (F1) — the scoped grant issued at login when a tenant policy
 * REQUIRES MFA but the identity has no factor yet. Reuses the challenge table
 * with `purpose = 'enrollment'`; the raw token authorizes ONLY the enroll
 * endpoints (never a general session) and is consumed when enrollment
 * completes. This makes `required_for_*` genuinely enforced AND self-recoverable
 * (no admin lockout): a required user without a factor can always still enroll.
 */
export async function createEnrollmentGrant(
  tx: Bun.SQL,
  tenantId: string,
  identityId: string,
  ttlSec: number,
  now: Date
): Promise<{ token: string; expiresAt: Date }> {
  const rawToken = generateChallengeToken();
  const tokenHash = hashChallengeToken(rawToken);
  const expiresAt = new Date(now.getTime() + ttlSec * 1000);

  // Discard any prior unconsumed enrollment grant for this identity so only the
  // most recently issued token is usable.
  await tx`
    UPDATE awcms_mfa_challenges SET consumed_at = ${now}
    WHERE tenant_id = ${tenantId} AND identity_id = ${identityId}
      AND purpose = 'enrollment' AND consumed_at IS NULL
  `;

  await tx`
    INSERT INTO awcms_mfa_challenges (tenant_id, identity_id, challenge_token_hash, purpose, expires_at)
    VALUES (${tenantId}, ${identityId}, ${tokenHash}, 'enrollment', ${expiresAt})
  `;

  return { token: rawToken, expiresAt };
}

export type EnrollmentGrant = { challengeId: string; identityId: string };

/**
 * Resolves an unconsumed, unexpired enrollment grant to its identity WITHOUT
 * consuming it (both `enroll/start` and `enroll/verify` need it; only
 * `enroll/verify` consumes it via `consumeEnrollmentGrant`). Returns null for
 * any invalid/expired/consumed/non-enrollment token.
 */
export async function resolveEnrollmentGrant(
  tx: Bun.SQL,
  tenantId: string,
  token: string,
  now: Date
): Promise<EnrollmentGrant | null> {
  const tokenHash = hashChallengeToken(token);
  const rows = (await tx`
    SELECT id, identity_id, expires_at, consumed_at
    FROM awcms_mfa_challenges
    WHERE tenant_id = ${tenantId} AND challenge_token_hash = ${tokenHash}
      AND purpose = 'enrollment'
  `) as {
    id: string;
    identity_id: string;
    expires_at: Date;
    consumed_at: Date | null;
  }[];
  const row = rows[0];

  if (!row) return null;
  if (row.consumed_at !== null) return null;
  if (new Date(row.expires_at).getTime() <= now.getTime()) return null;

  return { challengeId: row.id, identityId: row.identity_id };
}

/** Burns an enrollment grant once enrollment completes so it can never mint a second session. */
export async function consumeEnrollmentGrant(
  tx: Bun.SQL,
  tenantId: string,
  challengeId: string,
  now: Date
): Promise<void> {
  await tx`
    UPDATE awcms_mfa_challenges SET consumed_at = ${now}
    WHERE tenant_id = ${tenantId} AND id = ${challengeId} AND consumed_at IS NULL
  `;
}

export type EnrollAuth = {
  identityId: string;
  viaEnrollment: boolean;
  enrollmentChallengeId: string | null;
};

/**
 * Resolves the identity authorized to run the enroll endpoints, accepting
 * EITHER a valid session OR a valid enrollment grant (Issue #184, F1). A live
 * session takes priority; the enrollment grant is the fallback for an identity
 * that has no session yet because a tenant policy required MFA at login. Returns
 * null when neither authorizes.
 */
export async function resolveEnrollAuth(
  tx: Bun.SQL,
  tenantId: string,
  sessionTokenHash: string | null,
  enrollmentToken: string | null,
  now: Date
): Promise<EnrollAuth | null> {
  if (sessionTokenHash) {
    const session = await resolveActiveSession(
      tx,
      tenantId,
      sessionTokenHash,
      now
    );
    if (session) {
      return {
        identityId: session.identity_id,
        viaEnrollment: false,
        enrollmentChallengeId: null
      };
    }
  }

  if (enrollmentToken) {
    const grant = await resolveEnrollmentGrant(
      tx,
      tenantId,
      enrollmentToken,
      now
    );
    if (grant) {
      return {
        identityId: grant.identityId,
        viaEnrollment: true,
        enrollmentChallengeId: grant.challengeId
      };
    }
  }

  return null;
}

export type FactorCredential = { code?: string; recoveryCode?: string };

type ConsumeFactorResult = { matched: boolean; misconfigured: boolean };

/**
 * Replay-safe verification + consumption of a single credential (TOTP code or
 * recovery code) against an already-fetched active factor. Shared by the login
 * challenge and by step-up so the concurrency-safe compare-and-swap lives in
 * exactly one place.
 *
 * For a TOTP code: accepted only if it matches a step in the window AND that
 * step is strictly greater than `last_used_step`; the advance is a
 * compare-and-swap (`WHERE ... AND last_used_step < ${matchedStep}`), not a
 * blind SET, so two concurrent requests replaying the SAME timestep cannot both
 * win — the loser's UPDATE affects zero rows and is treated as replayed.
 *
 * For a recovery code: consumed by an UPDATE that re-asserts `used_at IS NULL`
 * in the same statement, so two concurrent requests with the same code cannot
 * both consume it.
 */
async function consumeFactorCredential(
  tx: Bun.SQL,
  tenantId: string,
  factor: ActiveMfaFactor,
  credentials: FactorCredential,
  env: NodeJS.ProcessEnv,
  now: Date
): Promise<ConsumeFactorResult> {
  if (credentials.code) {
    const key = resolveMfaEncryptionKey(env);

    if (!key) {
      return { matched: false, misconfigured: true };
    }

    try {
      const secret = decryptMfaSecret(factor.secret_ciphertext, key);
      const matchedStep = verifyTotpCode(
        secret,
        credentials.code,
        now.getTime(),
        {
          periodSec: resolveTotpPeriodSec(env),
          digits: resolveTotpDigits(env),
          windowSteps: resolveWindowSteps(env)
        }
      );

      if (matchedStep !== null && matchedStep > factor.last_used_step) {
        const advancedRows = (await tx`
          UPDATE awcms_identity_mfa_factors
          SET last_used_step = ${matchedStep}, updated_at = ${now}
          WHERE id = ${factor.id} AND last_used_step < ${matchedStep}
          RETURNING id
        `) as { id: string }[];

        return { matched: advancedRows.length > 0, misconfigured: false };
      }

      return { matched: false, misconfigured: false };
    } catch {
      return { matched: false, misconfigured: false };
    }
  }

  if (credentials.recoveryCode) {
    const hash = hashRecoveryCode(credentials.recoveryCode);

    const consumedRows = (await tx`
      UPDATE awcms_identity_mfa_recovery_codes
      SET used_at = ${now}
      WHERE tenant_id = ${tenantId} AND factor_id = ${factor.id}
        AND code_hash = ${hash} AND used_at IS NULL
      RETURNING id
    `) as { id: string }[];

    return { matched: consumedRows.length > 0, misconfigured: false };
  }

  return { matched: false, misconfigured: false };
}

export type FactorVerifyStatus =
  "matched" | "failed" | "locked" | "misconfigured";

/**
 * Wraps `consumeFactorCredential` with the per-factor cumulative failed-verify
 * lockout (Issue #184, F4). Independent of source IP and of any single
 * challenge row, so an attacker who knows the password cannot dodge the bound
 * by minting fresh challenges and rotating IPs. Mirrors the password lockout:
 *
 * - factor already locked (`locked_until > now`) -> `locked`, no verify attempt.
 * - success -> reset `failed_verify_count = 0`, clear `locked_until` -> `matched`.
 * - failure -> increment; once it reaches `AUTH_MFA_MAX_VERIFY_ATTEMPTS`, set
 *   `locked_until = now + AUTH_MFA_LOCKOUT_MINUTES` and reset the counter.
 */
async function verifyFactorWithLockout(
  tx: Bun.SQL,
  tenantId: string,
  factor: ActiveMfaFactor,
  credentials: FactorCredential,
  env: NodeJS.ProcessEnv,
  now: Date
): Promise<FactorVerifyStatus> {
  // Serialize every verify attempt against THIS factor with a row lock: each
  // caller runs in its own transaction, so a second attempt blocks until the
  // first commits, then reads its committed `failed_verify_count`/`locked_until`.
  // Without this the lock-check + increment were a read-modify-write over a
  // stale snapshot (`findActiveMfaFactor`'s unlocked SELECT), which concurrent
  // wrong-code verifies across DISTINCT challenges/IPs could lost-update so the
  // factor never reached the threshold — re-opening the exact cross-challenge/
  // cross-IP brute force this lockout exists to close (auditor HIGH-1 / F4).
  const lockedRows = (await tx`
    SELECT failed_verify_count, locked_until
    FROM awcms_identity_mfa_factors
    WHERE id = ${factor.id}
    FOR UPDATE
  `) as { failed_verify_count: number; locked_until: Date | null }[];
  const current = lockedRows[0];

  if (
    current?.locked_until &&
    new Date(current.locked_until).getTime() > now.getTime()
  ) {
    return "locked";
  }

  const consumed = await consumeFactorCredential(
    tx,
    tenantId,
    factor,
    credentials,
    env,
    now
  );

  if (consumed.misconfigured) {
    // A missing key is an operator error, not a guessing attempt — do not burn
    // an attempt against the lockout counter.
    return "misconfigured";
  }

  if (consumed.matched) {
    await tx`
      UPDATE awcms_identity_mfa_factors
      SET failed_verify_count = 0, locked_until = NULL, updated_at = ${now}
      WHERE id = ${factor.id}
    `;
    return "matched";
  }

  const maxAttempts = resolveMfaMaxVerifyAttempts(env);
  const lockedUntil = new Date(
    now.getTime() + resolveMfaLockoutMinutes(env) * 60_000
  );

  // Increment and conditional lock are computed IN-DB (never a JS
  // read-modify-write), under the row lock held above — mirrors the replay/
  // recovery compare-and-swap. Once the (n+1)-th failure reaches the cap the
  // counter resets and the factor is locked for the cooldown window.
  await tx`
    UPDATE awcms_identity_mfa_factors
    SET failed_verify_count =
          CASE WHEN failed_verify_count + 1 >= ${maxAttempts} THEN 0
               ELSE failed_verify_count + 1 END,
        locked_until =
          CASE WHEN failed_verify_count + 1 >= ${maxAttempts} THEN ${lockedUntil}
               ELSE locked_until END,
        updated_at = ${now}
    WHERE id = ${factor.id}
  `;

  return "failed";
}

export type MfaChallengeFailureCode =
  "MFA_CHALLENGE_INVALID" | "MFA_MISCONFIGURED";

export type VerifyMfaChallengeResult =
  | { ok: true; identityId: string }
  | { ok: false; code: MfaChallengeFailureCode };

/**
 * Verifies a login challenge issued by `createMfaChallenge` against either a
 * TOTP `code` or a `recoveryCode`. Every deny path — challenge not
 * found/expired/already used/too many attempts, wrong code, factor no longer
 * active — collapses to the same generic `MFA_CHALLENGE_INVALID` so this
 * endpoint cannot be used to fingerprint challenge/account state.
 */
export async function verifyMfaChallenge(
  tx: Bun.SQL,
  tenantId: string,
  challengeToken: string,
  credentials: FactorCredential,
  env: NodeJS.ProcessEnv,
  maxAttempts: number,
  now: Date
): Promise<VerifyMfaChallengeResult> {
  const tokenHash = hashChallengeToken(challengeToken);

  // `FOR UPDATE` serializes concurrent verifications of the SAME challenge so
  // the per-challenge `failed_attempts` limit cannot be defeated by racing
  // requests all reading a stale count before any commits.
  const challengeRows = (await tx`
    SELECT id, identity_id, expires_at, consumed_at, failed_attempts
    FROM awcms_mfa_challenges
    WHERE tenant_id = ${tenantId}
      AND challenge_token_hash = ${tokenHash}
      AND purpose = 'login'
    FOR UPDATE
  `) as {
    id: string;
    identity_id: string;
    expires_at: Date;
    consumed_at: Date | null;
    failed_attempts: number;
  }[];
  const challenge = challengeRows[0];

  const evaluation = evaluateMfaChallenge(
    challenge
      ? {
          expiresAt: new Date(challenge.expires_at),
          consumedAt: challenge.consumed_at,
          failedAttempts: challenge.failed_attempts
        }
      : null,
    now,
    maxAttempts
  );

  if (evaluation.outcome === "invalid") {
    return { ok: false, code: "MFA_CHALLENGE_INVALID" };
  }

  const factor = await findActiveMfaFactor(
    tx,
    tenantId,
    challenge!.identity_id
  );

  if (!factor) {
    // MFA was disabled between login and challenge completion — burn the
    // challenge so it can't be retried once a factor exists again.
    await tx`
      UPDATE awcms_mfa_challenges SET consumed_at = ${now} WHERE id = ${challenge!.id}
    `;
    return { ok: false, code: "MFA_CHALLENGE_INVALID" };
  }

  const status = await verifyFactorWithLockout(
    tx,
    tenantId,
    factor,
    credentials,
    env,
    now
  );

  if (status === "misconfigured") {
    return { ok: false, code: "MFA_MISCONFIGURED" };
  }

  if (status !== "matched") {
    // `failed` and `locked` both collapse to the same generic response
    // pre-session (no enumeration/state signal). `locked` did not consume an
    // attempt above, but still counts against this challenge's own cap.
    await tx`
      UPDATE awcms_mfa_challenges
      SET failed_attempts = failed_attempts + 1
      WHERE id = ${challenge!.id}
    `;
    return { ok: false, code: "MFA_CHALLENGE_INVALID" };
  }

  await tx`
    UPDATE awcms_mfa_challenges SET consumed_at = ${now} WHERE id = ${challenge!.id}
  `;

  return { ok: true, identityId: challenge!.identity_id };
}

export type VerifyStepUpResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | "MFA_NOT_ACTIVE"
        | "MFA_INVALID_CODE"
        | "MFA_LOCKED"
        | "MFA_MISCONFIGURED";
    };

/**
 * Verifies a second factor for an already-authenticated identity that is
 * raising its session to `aal2` (step-up). Same replay-safe consumption as the
 * login challenge, but keyed by the session identity rather than a challenge
 * token. Returns a distinguishable `MFA_NOT_ACTIVE`/`MFA_INVALID_CODE` because,
 * unlike the pre-session login boundary, the caller is already authenticated —
 * there is no enumeration surface to protect here.
 */
export async function verifyStepUpFactor(
  tx: Bun.SQL,
  tenantId: string,
  identityId: string,
  credentials: FactorCredential,
  env: NodeJS.ProcessEnv,
  now: Date
): Promise<VerifyStepUpResult> {
  const factor = await findActiveMfaFactor(tx, tenantId, identityId);

  if (!factor) {
    return { ok: false, code: "MFA_NOT_ACTIVE" };
  }

  const status = await verifyFactorWithLockout(
    tx,
    tenantId,
    factor,
    credentials,
    env,
    now
  );

  if (status === "misconfigured") {
    return { ok: false, code: "MFA_MISCONFIGURED" };
  }
  if (status === "locked") {
    return { ok: false, code: "MFA_LOCKED" };
  }
  if (status === "failed") {
    return { ok: false, code: "MFA_INVALID_CODE" };
  }

  return { ok: true };
}

export type AdminResetMfaResult =
  | { ok: true; hadFactor: boolean }
  | { ok: false; code: "MFA_TARGET_NOT_FOUND" };

/**
 * Administratively resets (disables) another identity's MFA factor and deletes
 * its recovery codes. High-risk: the route gates this on a dedicated
 * permission, demands a reason, and audits at `critical`. Self-reset is
 * forbidden at the route (an admin must use self-service disable behind their
 * own already-MFA'd session), so this never becomes a factor-bypass for the
 * caller. Returns `hadFactor: false` when the target had nothing active/pending
 * — the reset is still recorded, but the response tells the operator.
 */
export async function adminResetMfa(
  tx: Bun.SQL,
  tenantId: string,
  targetIdentityId: string,
  now: Date
): Promise<AdminResetMfaResult> {
  const identityRows = (await tx`
    SELECT id FROM awcms_identities
    WHERE tenant_id = ${tenantId} AND id = ${targetIdentityId}
  `) as { id: string }[];

  if (identityRows.length === 0) {
    return { ok: false, code: "MFA_TARGET_NOT_FOUND" };
  }

  const disabledRows = (await tx`
    UPDATE awcms_identity_mfa_factors
    SET status = 'disabled', disabled_at = ${now}, updated_at = ${now}
    WHERE tenant_id = ${tenantId} AND identity_id = ${targetIdentityId}
      AND status IN ('active', 'pending')
    RETURNING id
  `) as { id: string }[];

  await tx`
    DELETE FROM awcms_identity_mfa_recovery_codes
    WHERE tenant_id = ${tenantId} AND identity_id = ${targetIdentityId}
  `;

  return { ok: true, hadFactor: disabledRows.length > 0 };
}

export type { MfaChallengeDenyReason };
