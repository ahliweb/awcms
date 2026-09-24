/**
 * Worker-side enrollment redemption, `POST /api/v1/omes/worker/enroll`
 * (ahliweb/omes#199). Pairs with `application/enrollment-management.ts`
 * (#198), which mints the challenge an OPERATOR issues; this file is where
 * the WORKER redeems it.
 *
 * ## Genuinely single-use redemption
 *
 * `SELECT ... FOR UPDATE` on the exact row, inside the caller's transaction,
 * THEN an `UPDATE` of that same locked row in the same transaction. This is
 * real DB-level compare-and-set, not a read-then-write race in application
 * code: a second, concurrent redemption attempt's own `SELECT ... FOR
 * UPDATE` blocks on the first transaction's row lock until that transaction
 * commits or rolls back, then re-reads the now-committed row — under READ
 * COMMITTED (Postgres's default, and what `withTenant` uses) a blocked
 * locking read re-fetches the latest committed version once unblocked. So
 * the loser always observes `status <> 'pending'` and is refused; there is
 * no window where both readers see `pending`.
 * `tests/integration/omes-control-worker.integration.test.ts`'s
 * `challenge redemption is genuinely single-use under a real race` exercises
 * this with two concurrent connections and asserts on the row count in
 * `awcms_omes_enrollments` with `status = 'enrolled'` for the worker (must
 * be exactly one), not merely on the HTTP status the loser received.
 *
 * ## Proof of possession
 *
 * The presented `public_key` is only trusted once the worker demonstrates it
 * controls the matching private key: `enrollmentSignatureBase64` must verify
 * as a valid Ed25519 signature, under that same public key, over the raw
 * `enrollment_challenge` string. Without this, an on-path attacker who
 * observes (but cannot itself redeem) a challenge value could not enroll a
 * public key of its own choosing merely by relaying the challenge — it would
 * also need the private key it claims to hold, which by construction it does
 * not have if this is the legitimate worker's freshly generated keypair.
 */
import {
  hashEnrollmentChallenge
} from "../domain/server-registration";
import { verifyEd25519Signature } from "../domain/worker-identity";

export type RedeemChallengeInput = {
  tenantId: string;
  serverId: string;
  rawChallenge: string;
  publicKeyPem: string;
  enrollmentSignatureBase64: string;
};

export type RedeemChallengeOutcome =
  | { outcome: "enrolled"; workerId: string; enrolledAt: string }
  | { outcome: "token_expired" }
  | { outcome: "rejected" };

type EnrollmentRow = {
  id: string;
  worker_id: string;
  status: string;
  challenge_expires_at: Date | null;
};

export async function redeemEnrollmentChallenge(
  tx: Bun.SQL,
  input: RedeemChallengeInput,
  now: Date
): Promise<RedeemChallengeOutcome> {
  // Proof-of-possession is checked BEFORE any database work: it is pure
  // input validation (the presented key and signature are both in the
  // request itself), so failing it here costs nothing and never touches a
  // row that could act as an existence oracle.
  const signatureValid = verifyEd25519Signature(
    input.publicKeyPem,
    input.rawChallenge,
    input.enrollmentSignatureBase64
  );

  if (!signatureValid) {
    return { outcome: "rejected" };
  }

  const challengeHash = hashEnrollmentChallenge(input.rawChallenge);

  // Scoped by (tenant_id, server_id, enrollment_challenge_hash): finding the
  // matching row requires already knowing the raw challenge value (its hash
  // is unforgeable-in-practice from anything shorter), so this lookup is not
  // a meaningful probe surface — equivalent to the existing session-token-
  // hash lookup pattern (`hashSessionToken`) elsewhere in this codebase.
  const rows = (await tx`
    SELECT id, worker_id, status, challenge_expires_at
    FROM awcms_omes_enrollments
    WHERE tenant_id = ${input.tenantId}
      AND server_id = ${input.serverId}
      AND enrollment_challenge_hash = ${challengeHash}
    FOR UPDATE
  `) as EnrollmentRow[];
  const row = rows[0];

  if (!row) {
    return { outcome: "rejected" };
  }

  if (row.status !== "pending") {
    // Already enrolled, revoked, or superseded/expired by a later challenge
    // issuance — never distinguished further in the response (fail-closed,
    // no existence/state leak).
    return { outcome: "rejected" };
  }

  const expired =
    !row.challenge_expires_at || row.challenge_expires_at.getTime() <= now.getTime();

  if (expired) {
    await tx`
      UPDATE awcms_omes_enrollments
      SET status = 'expired', updated_at = now()
      WHERE tenant_id = ${input.tenantId} AND id = ${row.id} AND status = 'pending'
    `;

    return { outcome: "token_expired" };
  }

  const updatedRows = (await tx`
    UPDATE awcms_omes_enrollments
    SET status = 'enrolled',
        public_key = ${input.publicKeyPem},
        enrolled_at = ${now},
        updated_at = now()
    WHERE tenant_id = ${input.tenantId} AND id = ${row.id} AND status = 'pending'
    RETURNING worker_id, enrolled_at
  `) as { worker_id: string; enrolled_at: Date }[];
  const updated = updatedRows[0];

  if (!updated) {
    // Lost the lock race in the narrow window above (defensive: should be
    // unreachable given the row is already FOR-UPDATE-locked by this same
    // transaction, but never assume a mutation succeeded without checking
    // its own RETURNING).
    return { outcome: "rejected" };
  }

  return {
    outcome: "enrolled",
    workerId: updated.worker_id,
    enrolledAt: updated.enrolled_at.toISOString()
  };
}

export type RevokedIdentityCheckResult = "revoked" | "unknown" | "active";

/** Used by poll/result/heartbeat to fail closed on a revoked worker identity. */
export async function checkWorkerEnrollmentStatus(
  tx: Bun.SQL,
  tenantId: string,
  serverId: string,
  workerId: string
): Promise<{ status: RevokedIdentityCheckResult; publicKeyPem: string | null }> {
  const rows = (await tx`
    SELECT status, public_key FROM awcms_omes_enrollments
    WHERE tenant_id = ${tenantId} AND server_id = ${serverId} AND worker_id = ${workerId}
  `) as { status: string; public_key: string | null }[];
  const row = rows[0];

  if (!row) {
    return { status: "unknown", publicKeyPem: null };
  }

  if (row.status === "revoked" || row.status === "expired") {
    return { status: "revoked", publicKeyPem: null };
  }

  if (row.status !== "enrolled" || !row.public_key) {
    return { status: "unknown", publicKeyPem: null };
  }

  return { status: "active", publicKeyPem: row.public_key };
}
