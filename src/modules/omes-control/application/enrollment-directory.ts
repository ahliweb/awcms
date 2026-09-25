/**
 * Fleet-wide read-side query for the `/admin/omes/enrollments` screen, Issue
 * ahliweb/omes#233. `enrollment-management.ts` (Issue ahliweb/omes#198) only
 * ever operates on ONE server's enrollments at a time (issue/revoke); this
 * file adds the list-across-the-fleet query the management screen needs
 * without touching that write-side module at all — same reuse discipline
 * `server-directory.ts`/`health-directory.ts` already established for their
 * own read/write split.
 *
 * Sanitized exactly like `fetchServerDetail`'s enrollment evidence
 * (`server-directory.ts`): an enrolled worker's public key is reduced to a
 * SHA-256 fingerprint (`fingerprintPublicKey`, exported from that file so
 * both call sites hash identically), never the raw key material. The raw
 * one-time enrollment challenge itself is never read back here at all —
 * `awcms_omes_enrollments` only ever stores `enrollment_challenge_hash`
 * (sql/158); there is no column this query — or any query — could select it
 * from even by mistake.
 */
import {
  keysetCursorCreatedAtSql,
  encodeKeysetCursor,
  type KeysetCursor
} from "../../_shared/keyset-pagination";
import { fingerprintPublicKey } from "./server-directory";

export type EnrollmentSummary = {
  id: string;
  serverRowId: string;
  serverId: string;
  hostname: string;
  workerId: string;
  status: string;
  publicKeyFingerprint: string | null;
  challengeExpiresAt: string | null;
  enrolledAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

type EnrollmentRow = {
  id: string;
  server_row_id: string;
  server_id: string;
  hostname: string;
  worker_id: string;
  status: string;
  public_key: string | null;
  challenge_expires_at: Date | null;
  enrolled_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
  created_at_cursor: string;
};

export type EnrollmentListPage = {
  enrollments: EnrollmentSummary[];
  nextCursor: string | null;
};

export const ENROLLMENT_LIST_LIMIT = 100;

function toSummary(row: EnrollmentRow): EnrollmentSummary {
  return {
    id: row.id,
    serverRowId: row.server_row_id,
    serverId: row.server_id,
    hostname: row.hostname,
    workerId: row.worker_id,
    status: row.status,
    publicKeyFingerprint: row.public_key
      ? fingerprintPublicKey(row.public_key)
      : null,
    challengeExpiresAt: row.challenge_expires_at?.toISOString() ?? null,
    enrolledAt: row.enrolled_at?.toISOString() ?? null,
    revokedAt: row.revoked_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString()
  };
}

/**
 * Every enrollment row across the tenant's whole fleet, newest first, joined
 * to `awcms_omes_servers` for the hostname and the server's ROW id (what
 * `issueEnrollmentChallengeForServer`/`revokeEnrollment` key on, distinct
 * from the text `server_id` natural key `awcms_omes_enrollments` itself
 * stores). The join is scoped by `(tenant_id, server_id)` on both sides —
 * belt-and-suspenders on top of `FORCE ROW LEVEL SECURITY` (sql/154), the
 * same double-scoping every other `omes_control` directory query in this
 * module already does.
 */
export async function fetchEnrollments(
  tx: Bun.SQL,
  tenantId: string,
  options: { status?: string; cursor?: KeysetCursor } = {}
): Promise<EnrollmentListPage> {
  const cursorCreatedAt = options.cursor?.createdAt ?? null;
  const cursorId = options.cursor?.id ?? null;
  const statusFilter = options.status ?? null;

  const rows = (await tx`
    SELECT
      e.id AS id,
      s.id AS server_row_id,
      e.server_id AS server_id,
      s.hostname AS hostname,
      e.worker_id AS worker_id,
      e.status AS status,
      e.public_key AS public_key,
      e.challenge_expires_at AS challenge_expires_at,
      e.enrolled_at AS enrolled_at,
      e.revoked_at AS revoked_at,
      e.created_at AS created_at,
      ${tx.unsafe(keysetCursorCreatedAtSql("e"))} AS created_at_cursor
    FROM awcms_omes_enrollments e
    JOIN awcms_omes_servers s
      ON s.tenant_id = e.tenant_id AND s.server_id = e.server_id
    WHERE e.tenant_id = ${tenantId}
      AND (${statusFilter}::text IS NULL OR e.status = ${statusFilter})
      AND (
        ${cursorCreatedAt}::timestamptz IS NULL
        OR (e.created_at, e.id) < (${cursorCreatedAt}, ${cursorId})
      )
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT ${ENROLLMENT_LIST_LIMIT}
  `) as EnrollmentRow[];

  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === ENROLLMENT_LIST_LIMIT && last
      ? encodeKeysetCursor(last.created_at_cursor, last.id)
      : null;

  return {
    enrollments: rows.map(toSummary),
    nextCursor
  };
}
