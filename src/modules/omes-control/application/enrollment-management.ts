/**
 * Enrollment challenge issuance/revocation, Issue ahliweb/omes#198. Guarded
 * by `omes_control.enrollments.manage`. The RAW challenge is returned to the
 * caller exactly once (the response of `issueEnrollmentChallenge`'s route) —
 * only its sha256 hash is ever persisted (sql/157).
 */
import {
  issueEnrollmentChallenge as mintChallenge,
  type EnrollmentChallenge
} from "../domain/server-registration";

export type IssueChallengeOutcome =
  | {
      outcome: "issued";
      workerId: string;
      rawChallenge: string;
      expiresAt: string;
    }
  | { outcome: "server_not_found" }
  | { outcome: "server_not_eligible"; status: string };

/**
 * A server is eligible for a NEW challenge only while `offline`
 * (freshly registered, never enrolled) — an `online`/`degraded`/
 * `maintenance` server already has a live worker, and re-issuing a
 * challenge for one would let an operator silently mint a second worker
 * identity for the same host. A `decommissioned` server is never eligible.
 */
const ELIGIBLE_STATUSES = new Set(["offline"]);

export async function issueEnrollmentChallengeForServer(
  tx: Bun.SQL,
  tenantId: string,
  serverRowId: string,
  now: Date
): Promise<IssueChallengeOutcome> {
  const serverRows = (await tx`
    SELECT server_id, status FROM awcms_omes_servers
    WHERE tenant_id = ${tenantId} AND id = ${serverRowId}
  `) as { server_id: string; status: string }[];
  const server = serverRows[0];

  if (!server) {
    return { outcome: "server_not_found" };
  }

  if (!ELIGIBLE_STATUSES.has(server.status)) {
    return { outcome: "server_not_eligible", status: server.status };
  }

  // Supersede every still-live PENDING challenge for this server before
  // minting a new one — without this, re-issuing (e.g. because an operator
  // lost the first raw value, or a worker never showed up) leaves several
  // valid, unexpired challenges outstanding for the same server under
  // DIFFERENT worker_ids, any one of which a worker could still present.
  // `awcms_omes_enrollments` has no uniqueness constraint on
  // `(tenant_id, server_id)` for `pending` rows (only `(tenant_id,
  // worker_id)` is unique, and worker_id is freshly minted per issuance),
  // so this is the only thing that keeps "one live challenge per server"
  // true. `enrolled`/`revoked` rows are untouched — only `pending` is ever
  // superseded here.
  await tx`
    UPDATE awcms_omes_enrollments
    SET status = 'expired', updated_at = now()
    WHERE tenant_id = ${tenantId} AND server_id = ${server.server_id} AND status = 'pending'
  `;

  const challenge: EnrollmentChallenge = mintChallenge(now);

  await tx`
    INSERT INTO awcms_omes_enrollments
      (tenant_id, server_id, worker_id, status, enrollment_challenge_hash, challenge_expires_at)
    VALUES (
      ${tenantId}, ${server.server_id}, ${challenge.workerId}, 'pending',
      ${challenge.challengeHash}, ${challenge.expiresAt}
    )
  `;

  return {
    outcome: "issued",
    workerId: challenge.workerId,
    rawChallenge: challenge.rawChallenge,
    expiresAt: challenge.expiresAt.toISOString()
  };
}

export type RevokeEnrollmentOutcome =
  | { outcome: "revoked" }
  | { outcome: "not_found" }
  | { outcome: "already_revoked" };

export async function revokeEnrollment(
  tx: Bun.SQL,
  tenantId: string,
  serverRowId: string,
  workerId: string,
  now: Date
): Promise<RevokeEnrollmentOutcome> {
  const serverRows = (await tx`
    SELECT server_id FROM awcms_omes_servers
    WHERE tenant_id = ${tenantId} AND id = ${serverRowId}
  `) as { server_id: string }[];
  const server = serverRows[0];

  if (!server) {
    return { outcome: "not_found" };
  }

  const existingRows = (await tx`
    SELECT status FROM awcms_omes_enrollments
    WHERE tenant_id = ${tenantId} AND server_id = ${server.server_id} AND worker_id = ${workerId}
  `) as { status: string }[];
  const existing = existingRows[0];

  if (!existing) {
    return { outcome: "not_found" };
  }

  if (existing.status === "revoked") {
    return { outcome: "already_revoked" };
  }

  await tx`
    UPDATE awcms_omes_enrollments
    SET status = 'revoked', revoked_at = ${now}, updated_at = now()
    WHERE tenant_id = ${tenantId} AND server_id = ${server.server_id} AND worker_id = ${workerId}
  `;

  return { outcome: "revoked" };
}
