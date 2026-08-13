/**
 * The subject-rights surface — ADR-0094 gelombang 2, Issue #557.
 *
 * Resolves a subject's three ids, records every request, and runs the
 * maker/checker erasure. The reading and writing of other modules' tables is
 * `subject-data-executor.ts`; the decisions about WHO may do what, and what the
 * record of it looks like, are here.
 *
 * ## Why the subject is resolved, not supplied
 *
 * A caller names a `tenantUserId` and nothing else. The identity and profile
 * ids are looked up inside the same transaction, under the tenant's own RLS, so
 * a caller cannot hand in an identity from one person and a profile from
 * another and receive a report that mixes two people — a shape that would be
 * indistinguishable from a correct report to whoever signed it.
 */
import type { SubjectIdentifiers } from "../domain/subject-data-plan";

export type SubjectResolution =
  { resolved: true; subject: SubjectIdentifiers } | { resolved: false };

/**
 * One query, one join, one row. `awcms_tenant_users` -> `awcms_identities` ->
 * `profile_id`, all three tenant-scoped, so RLS covers every hop.
 */
export async function resolveSubject(
  tx: Bun.SQL,
  tenantId: string,
  tenantUserId: string
): Promise<SubjectResolution> {
  const rows = (await tx`
    SELECT tu.id AS tenant_user_id, i.id AS identity_id, i.profile_id
    FROM awcms_tenant_users tu
    JOIN awcms_identities i ON i.id = tu.identity_id AND i.tenant_id = tu.tenant_id
    WHERE tu.tenant_id = ${tenantId} AND tu.id = ${tenantUserId}
  `) as {
    tenant_user_id: string;
    identity_id: string;
    profile_id: string;
  }[];

  const row = rows[0];

  if (!row) {
    return { resolved: false };
  }

  return {
    resolved: true,
    subject: {
      tenantId,
      tenantUserId: row.tenant_user_id,
      identityId: row.identity_id,
      profileId: row.profile_id
    }
  };
}

export type SubjectRequestRow = {
  id: string;
  subjectTenantUserId: string;
  requestType: "export" | "erasure";
  status: "disclosed" | "pending_approval" | "rejected" | "completed";
  reason: string;
  requestedBy: string;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  completedAt: string | null;
  tablesAnswered: number | null;
  tablesUnanswered: number | null;
  rowsAffected: number | null;
};

type RawRequestRow = {
  id: string;
  subject_tenant_user_id: string;
  request_type: "export" | "erasure";
  status: SubjectRequestRow["status"];
  reason: string;
  requested_by: string;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_reason: string | null;
  completed_at: string | null;
  tables_answered: number | null;
  tables_unanswered: number | null;
  rows_affected: number | null;
};

function toRequestRow(row: RawRequestRow): SubjectRequestRow {
  return {
    id: row.id,
    subjectTenantUserId: row.subject_tenant_user_id,
    requestType: row.request_type,
    status: row.status,
    reason: row.reason,
    requestedBy: row.requested_by,
    requestedAt: row.requested_at,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    decisionReason: row.decision_reason,
    completedAt: row.completed_at,
    tablesAnswered: row.tables_answered,
    tablesUnanswered: row.tables_unanswered,
    rowsAffected: row.rows_affected
  };
}

const REQUEST_COLUMNS = `id, subject_tenant_user_id, request_type, status, reason,
  requested_by, requested_at::text AS requested_at, decided_by,
  decided_at::text AS decided_at, decision_reason,
  completed_at::text AS completed_at, tables_answered, tables_unanswered,
  rows_affected`;

/** Records that a disclosure HAPPENED. Written in the same transaction as the read. */
export async function recordExportDisclosure(
  tx: Bun.SQL,
  tenantId: string,
  input: {
    subjectTenantUserId: string;
    reason: string;
    requestedBy: string;
    tablesAnswered: number;
    tablesUnanswered: number;
    rowsAffected: number;
    correlationId: string | null;
  }
): Promise<SubjectRequestRow> {
  const rows = (await tx`
    INSERT INTO awcms_subject_requests
      (tenant_id, subject_tenant_user_id, request_type, status, reason,
       requested_by, completed_at, tables_answered, tables_unanswered,
       rows_affected, correlation_id)
    VALUES (
      ${tenantId}, ${input.subjectTenantUserId}, 'export', 'disclosed',
      ${input.reason}, ${input.requestedBy}, now(), ${input.tablesAnswered},
      ${input.tablesUnanswered}, ${input.rowsAffected}, ${input.correlationId}
    )
    RETURNING ${tx.unsafe(REQUEST_COLUMNS)}
  `) as RawRequestRow[];

  return toRequestRow(rows[0]!);
}

/** The MAKER half: records the request and executes nothing. */
export async function createErasureRequest(
  tx: Bun.SQL,
  tenantId: string,
  input: {
    subjectTenantUserId: string;
    reason: string;
    requestedBy: string;
    correlationId: string | null;
  }
): Promise<SubjectRequestRow> {
  const rows = (await tx`
    INSERT INTO awcms_subject_requests
      (tenant_id, subject_tenant_user_id, request_type, status, reason,
       requested_by, correlation_id)
    VALUES (
      ${tenantId}, ${input.subjectTenantUserId}, 'erasure', 'pending_approval',
      ${input.reason}, ${input.requestedBy}, ${input.correlationId}
    )
    RETURNING ${tx.unsafe(REQUEST_COLUMNS)}
  `) as RawRequestRow[];

  return toRequestRow(rows[0]!);
}

export type PendingErasureClaim =
  | { claimed: true; request: SubjectRequestRow }
  | {
      claimed: false;
      reason: "not_found" | "not_pending" | "checker_is_maker";
    };

/**
 * The CHECKER half, as a single conditional UPDATE.
 *
 * `status = 'pending_approval'` in the `WHERE` is what makes two simultaneous
 * approvals settle to one: the second matches no row. Read-then-write would let
 * both pass their own check and both run the erasure — the shape this repo
 * already paid for once, when a login lockout counted K parallel attempts as a
 * single increment while four documents said otherwise.
 *
 * `requested_by <> checker` is in the predicate as well as in the table's CHECK
 * constraint. The constraint is the guarantee; this is what turns a violated
 * guarantee into a 409 the operator can read instead of a 500.
 *
 * `completed_at` uses a SQL `CASE WHEN` rather than a JS ternary that would
 * interpolate a SQL FRAGMENT on one branch and a bound `NULL` on the other.
 * Nothing else in this repo mixes those two, and no test exercises this
 * statement against a real database — "it read fine in the diff" is exactly how
 * four defects once passed thirty-seven gates here. It also keeps `now()` as
 * the DATABASE's clock (the transaction's start instant), which is what every
 * other timestamp on the row uses.
 */
export async function claimPendingErasure(
  tx: Bun.SQL,
  tenantId: string,
  requestId: string,
  checkerTenantUserId: string,
  decision: { approved: boolean; reason: string }
): Promise<PendingErasureClaim> {
  const rows = (await tx`
    UPDATE awcms_subject_requests
    SET status = ${decision.approved ? "completed" : "rejected"},
        decided_by = ${checkerTenantUserId},
        decided_at = now(),
        decision_reason = ${decision.reason},
        completed_at = CASE WHEN ${decision.approved}::boolean THEN now() ELSE NULL END,
        updated_at = now()
    WHERE tenant_id = ${tenantId}
      AND id = ${requestId}
      AND request_type = 'erasure'
      AND status = 'pending_approval'
      AND requested_by <> ${checkerTenantUserId}
    RETURNING ${tx.unsafe(REQUEST_COLUMNS)}
  `) as RawRequestRow[];

  const row = rows[0];

  if (row) {
    return { claimed: true, request: toRequestRow(row) };
  }

  // Nothing matched. Say WHICH of the three reasons it was, because "could not
  // approve" sends an operator to the wrong place for two of them.
  const existing = (await tx`
    SELECT status, requested_by FROM awcms_subject_requests
    WHERE tenant_id = ${tenantId} AND id = ${requestId} AND request_type = 'erasure'
  `) as { status: string; requested_by: string }[];

  const found = existing[0];

  if (!found) {
    return { claimed: false, reason: "not_found" };
  }
  if (found.requested_by === checkerTenantUserId) {
    return { claimed: false, reason: "checker_is_maker" };
  }
  return { claimed: false, reason: "not_pending" };
}

/** Records the row counts an approved erasure actually wrote. */
export async function recordErasureOutcome(
  tx: Bun.SQL,
  tenantId: string,
  requestId: string,
  counts: {
    tablesAnswered: number;
    tablesUnanswered: number;
    rowsAffected: number;
  }
): Promise<void> {
  await tx`
    UPDATE awcms_subject_requests
    SET tables_answered = ${counts.tablesAnswered},
        tables_unanswered = ${counts.tablesUnanswered},
        rows_affected = ${counts.rowsAffected},
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${requestId}
  `;
}

const MAX_LIST_LIMIT = 100;

/** Newest first, bounded. The inbox and the log are the same list, filtered. */
export async function listSubjectRequests(
  tx: Bun.SQL,
  tenantId: string,
  options: { status?: SubjectRequestRow["status"]; limit?: number } = {}
): Promise<SubjectRequestRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), MAX_LIST_LIMIT);
  const status = options.status ?? null;

  const rows = (await tx`
    SELECT ${tx.unsafe(REQUEST_COLUMNS)}
    FROM awcms_subject_requests
    WHERE tenant_id = ${tenantId}
      AND (${status}::text IS NULL OR status = ${status})
    ORDER BY requested_at DESC
    LIMIT ${limit}
  `) as RawRequestRow[];

  return rows.map(toRequestRow);
}
