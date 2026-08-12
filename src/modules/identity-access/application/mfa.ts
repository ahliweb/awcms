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
import { linkIdentityToPrincipal } from "./principal-store";
import * as factorStore from "./principal-mfa-store";

const RECOVERY_CODE_COUNT = 10;

/**
 * ADR-0087 — the identity → principal hop every function below makes.
 *
 * The MFA factor belongs to the HUMAN since `sql/114`, but this module's exported
 * signatures deliberately still take `(tenantId, identityId)`: the HTTP surface is
 * tenant-scoped by design — you act as a member of a tenant — and only the
 * STORAGE went global. Keeping the seam here rather than in nine route files is
 * what let PR 7.3 move the tables without touching a single endpoint.
 *
 * `null` means the identity has no principal yet, which for every READ path means
 * exactly "no factor": a principal-scoped row cannot exist for a human the row
 * cannot name. Enrollment is the one path that must not accept that answer, and
 * it uses `requirePrincipalIdForEnrollment` instead.
 *
 * ## The tenant predicate stays, and it is not redundant
 *
 * `awcms_identities` is FORCE RLS, so under `withTenant` the `tenant_id =` clause
 * below can never change a result. It is written anyway because THIS is the hop
 * where a tenant-scoped id becomes the address of a GLOBAL row: every query that
 * followed it used to carry `tenant_id` itself, and dropping the predicate here
 * would move the whole module's tenant boundary onto a session GUC set by
 * somebody else. `adminResetMfa` takes its identity id from a request body, and
 * anything not routed through `withTenant` (a job, a test connecting as the
 * migration owner) has no policy standing behind it at all.
 */
async function readPrincipalId(
  tx: Bun.SQL,
  tenantId: string,
  identityId: string
): Promise<string | null> {
  const rows = (await tx`
    SELECT principal_id FROM awcms_identities
    WHERE tenant_id = ${tenantId} AND id = ${identityId}
  `) as { principal_id: string | null }[];

  return rows[0]?.principal_id ?? null;
}

/**
 * The enrollment path's variant: it LINKS an unlinked identity rather than
 * failing.
 *
 * Every identity writer is supposed to call `linkIdentityToPrincipal` already
 * (ADR-0085), so reaching the fallback means one of them was missed. Refusing to
 * enrol would turn that omission into "this person can never turn on MFA", which
 * is a security control silently withheld from exactly the accounts written by
 * the path nobody audited. Linking here is idempotent and uses the same writer,
 * so it converges on the row the missed caller should have made.
 */
async function requirePrincipalIdForEnrollment(
  tx: Bun.SQL,
  tenantId: string,
  identityId: string
): Promise<string | null> {
  const existing = await readPrincipalId(tx, tenantId, identityId);
  if (existing) return existing;

  const rows = (await tx`
    SELECT login_identifier FROM awcms_identities
    WHERE tenant_id = ${tenantId} AND id = ${identityId}
  `) as { login_identifier: string }[];

  const loginIdentifier = rows[0]?.login_identifier;
  if (!loginIdentifier) return null;

  return linkIdentityToPrincipal(tx, identityId, loginIdentifier);
}

async function insertRecoveryCodes(
  tx: Bun.SQL,
  principalId: string,
  factorId: string
): Promise<string[]> {
  const rawCodes: string[] = [];

  for (let i = 0; i < RECOVERY_CODE_COUNT; i += 1) {
    const rawCode = generateRecoveryCode();
    rawCodes.push(rawCode);

    await factorStore.insertRecoveryCodeHash(
      tx,
      principalId,
      factorId,
      hashRecoveryCode(rawCode)
    );
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
  const principalId = await readPrincipalId(tx, tenantId, identityId);

  if (!principalId) return { enabled: false };

  const factor = await factorStore.findActiveFactorSummary(tx, principalId);

  if (!factor) {
    return { enabled: false };
  }

  return {
    enabled: true,
    factorType: factor.factorType,
    activatedAt: factor.activatedAt
      ? new Date(factor.activatedAt).toISOString()
      : undefined
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

  const principalId = await requirePrincipalIdForEnrollment(
    tx,
    tenantId,
    identityId
  );

  // No identity row for this tenant+id. Reported as misconfigured rather than
  // "already active": the caller proved a session or an enrollment grant to get
  // here, so an absent identity is a server-side inconsistency, not a user error.
  if (!principalId) {
    return { ok: false, code: "MFA_MISCONFIGURED" };
  }

  if (await factorStore.findActiveFactorSummary(tx, principalId)) {
    return { ok: false, code: "MFA_ALREADY_ACTIVE" };
  }

  await factorStore.deletePendingFactors(tx, principalId);

  const secret = generateTotpSecret();
  const ciphertext = encryptMfaSecret(secret, key);
  const digits = resolveTotpDigits(env);
  const periodSec = resolveTotpPeriodSec(env);
  const issuer = resolveTotpIssuer(env);

  await factorStore.insertPendingFactor(tx, principalId, ciphertext, now);

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

  const principalId = await readPrincipalId(tx, tenantId, identityId);

  if (!principalId) {
    return { ok: false, code: "MFA_ENROLLMENT_NOT_FOUND" };
  }

  const row = await factorStore.findPendingFactor(tx, principalId);

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

  await factorStore.activateFactor(tx, row.id, matchedStep, now);

  const recoveryCodes = await insertRecoveryCodes(tx, principalId, row.id);

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
  const principalId = await readPrincipalId(tx, tenantId, identityId);

  if (!principalId) {
    return { ok: false, code: "MFA_NOT_ACTIVE" };
  }

  const live = await factorStore.findLiveFactorIds(tx, principalId);

  if (live.length === 0) {
    return { ok: false, code: "MFA_NOT_ACTIVE" };
  }

  // `null`: nobody ordered this. Self-service disable is the person acting on
  // their own factor, and stamping the tenant they happened to be signed into
  // would read, later, like an administrative reset that never happened.
  await factorStore.disableLiveFactors(tx, principalId, now, null);
  await factorStore.deleteRecoveryCodesForPrincipal(tx, principalId);

  return { ok: true };
}

export type RegenerateRecoveryCodesResult =
  { ok: true; recoveryCodes: string[] } | { ok: false; code: "MFA_NOT_ACTIVE" };

export async function regenerateRecoveryCodes(
  tx: Bun.SQL,
  tenantId: string,
  identityId: string
): Promise<RegenerateRecoveryCodesResult> {
  const principalId = await readPrincipalId(tx, tenantId, identityId);

  if (!principalId) {
    return { ok: false, code: "MFA_NOT_ACTIVE" };
  }

  const factor = await factorStore.findActiveFactorSummary(tx, principalId);

  if (!factor) {
    return { ok: false, code: "MFA_NOT_ACTIVE" };
  }

  await factorStore.deleteRecoveryCodesForFactor(tx, factor.id);

  const recoveryCodes = await insertRecoveryCodes(tx, principalId, factor.id);

  return { ok: true, recoveryCodes };
}

/**
 * Re-exported so `login.ts` and the verify routes keep one name for the shape.
 * Since ADR-0087 it is the PRINCIPAL's factor — the same human authenticates in
 * every tenant they belong to with one enrolment.
 */
export type ActiveMfaFactor = factorStore.PrincipalFactor;

/**
 * The active factor for whoever this identity is, or `null`.
 *
 * Still keyed by `(tenantId, identityId)` at this boundary even though the row it
 * returns is principal-scoped: callers hold an identity, and resolving the human
 * is this module's job rather than every route's.
 */
export async function findActiveMfaFactor(
  tx: Bun.SQL,
  tenantId: string,
  identityId: string
): Promise<ActiveMfaFactor | null> {
  const principalId = await readPrincipalId(tx, tenantId, identityId);

  if (!principalId) return null;

  return factorStore.findActiveFactor(tx, principalId);
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
  principalId: string,
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
        const advanced = await factorStore.advanceLastUsedStep(
          tx,
          factor.id,
          matchedStep,
          now
        );

        return { matched: advanced, misconfigured: false };
      }

      return { matched: false, misconfigured: false };
    } catch {
      return { matched: false, misconfigured: false };
    }
  }

  if (credentials.recoveryCode) {
    const consumed = await factorStore.consumeRecoveryCode(
      tx,
      principalId,
      factor.id,
      hashRecoveryCode(credentials.recoveryCode),
      now
    );

    return { matched: consumed, misconfigured: false };
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
  principalId: string,
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
  const current = await factorStore.lockFactorForVerify(tx, factor.id);

  if (
    current?.locked_until &&
    new Date(current.locked_until).getTime() > now.getTime()
  ) {
    return "locked";
  }

  const consumed = await consumeFactorCredential(
    tx,
    principalId,
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
    await factorStore.clearFactorFailures(tx, factor.id, now);
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
  await factorStore.recordFactorVerifyFailure(
    tx,
    factor.id,
    maxAttempts,
    lockedUntil,
    now
  );

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

  // Resolved once and reused for the verification below, rather than calling
  // `findActiveMfaFactor` and then resolving the human again for the credential
  // consumption: two hops would be two chances to disagree about who this is.
  const principalId = await readPrincipalId(
    tx,
    tenantId,
    challenge!.identity_id
  );
  const factor = principalId
    ? await factorStore.findActiveFactor(tx, principalId)
    : null;

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
    principalId!,
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
  const principalId = await readPrincipalId(tx, tenantId, identityId);
  const factor = principalId
    ? await factorStore.findActiveFactor(tx, principalId)
    : null;

  if (!factor) {
    return { ok: false, code: "MFA_NOT_ACTIVE" };
  }

  const status = await verifyFactorWithLockout(
    tx,
    principalId!,
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
  | {
      ok: true;
      hadFactor: boolean;
      /**
       * Whether this reset took away something whose effect leaves the acting
       * tenant. True exactly when a factor was really revoked, because since
       * ADR-0087 the revoked row IS the human's only authenticator.
       *
       * It is a statement about KIND, not a count, and deliberately not a list:
       * enumerating the other tenants a person works in would be a cross-tenant
       * membership oracle handed to whoever holds `mfa_admin.reset`. Whether
       * other tenants exist is therefore left undetermined — the audit row says
       * the action reached outside, never where to.
       *
       * Returned rather than audited here because writing an audit row is the
       * route's job (this module takes no `correlationId`), and it is a separate
       * field from `hadFactor` because knowing that a factor is principal-scoped
       * is this module's knowledge, not the route's.
       */
      crossTenantReach: boolean;
    }
  | { ok: false; code: "MFA_TARGET_NOT_FOUND" };

/**
 * Administratively resets (disables) another human's MFA factor and deletes
 * their recovery codes.
 *
 * High-risk: the route gates this on a dedicated permission, demands a reason,
 * and audits at `critical`. Self-reset is forbidden at the route (an admin must
 * use self-service disable behind their own already-MFA'd session), so this never
 * becomes a factor-bypass for the caller. Returns `hadFactor: false` when the
 * target had nothing active/pending — the reset is still recorded, but the
 * response tells the operator.
 *
 * ## Since ADR-0087 this reaches OUTSIDE the acting tenant
 *
 * The factor belongs to the human, so disabling it removes the second factor the
 * same person uses in every other tenant they belong to. This is the only place
 * in the repo where a tenant admin's action changes state another tenant depends
 * on, and it is deliberate rather than incidental: an operator recovering a
 * locked-out colleague must be able to actually recover them.
 *
 * What makes it defensible is that it cannot happen quietly — but the trace is
 * `crossTenantReach` on the acting tenant's audit row plus `disabled_by_tenant_id`
 * on the global factor row, NOT an audit row in each tenant reached. The first
 * edition of ADR-0087 asked for the latter and it cannot be built: enumerating
 * `awcms_identities WHERE principal_id = … AND tenant_id <> …` returns zero rows
 * forever under FORCE RLS, so the code would be green and blind, and writing an
 * audit row with another tenant's id is refused by that table's policy too. The
 * only ways through are `SECURITY DEFINER` or a request-time `NO FORCE` toggle,
 * and the list itself would be a cross-tenant membership oracle. See the ADR.
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

  const principalId = await readPrincipalId(tx, tenantId, targetIdentityId);

  // An unlinked identity cannot hold a principal-scoped factor, so there is
  // nothing to disable and nothing to reach. Reported as a successful reset with
  // `hadFactor: false` — the same answer the pre-ADR-0087 path gave for a target
  // with no factor, so the route's contract does not change.
  if (!principalId) {
    return { ok: true, hadFactor: false, crossTenantReach: false };
  }

  // The acting tenant is stamped on the row itself. It is the one place the
  // reach survives without a tenant writing into another tenant's log, and it is
  // what answers "why did my MFA disappear" for the person who lost it.
  const disabled = await factorStore.disableLiveFactors(
    tx,
    principalId,
    now,
    tenantId
  );

  await factorStore.deleteRecoveryCodesForPrincipal(tx, principalId);

  const hadFactor = disabled.length > 0;

  return {
    ok: true,
    hadFactor,
    // Only claim reach when something was actually taken away. A reset against a
    // target who had no factor changes nothing anywhere, and a `critical` audit
    // row announcing cross-tenant reach for it would be noise that trains
    // readers to ignore the signal.
    crossTenantReach: hadFactor
  };
}

export type { MfaChallengeDenyReason };
