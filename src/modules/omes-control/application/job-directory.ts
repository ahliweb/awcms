/**
 * Read/cancel queries for `GET /api/v1/omes/jobs` and
 * `POST /api/v1/omes/jobs/{id}/cancel`, Issue ahliweb/omes#198.
 *
 * `target`/`payload`/`result` are redacted defense-in-depth (they are
 * populated by the OMES pull worker bridge, ahliweb/omes#199, out of scope
 * here — this module only ever READS them, and never trusts them to already
 * be clean before they reach a response body).
 */
import {
  keysetCursorCreatedAtSql,
  encodeKeysetCursor,
  type KeysetCursor
} from "../../_shared/keyset-pagination";
import { redactSensitiveAttributes } from "../../_shared/redaction";

export type JobSummary = {
  id: string;
  jobId: string;
  operationRequestId: string | null;
  serverId: string;
  operation: string;
  state: string;
  target: unknown;
  payload: unknown;
  result: unknown;
  leasedBy: string | null;
  leasedUntil: string | null;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
};

type JobRow = {
  id: string;
  job_id: string;
  operation_request_id: string | null;
  server_id: string;
  operation: string;
  state: string;
  target: Record<string, unknown>;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  leased_by: string | null;
  leased_until: Date | null;
  retry_count: number | string;
  created_at: Date;
  updated_at: Date;
  created_at_cursor: string;
};

export type JobListPage = {
  jobs: JobSummary[];
  nextCursor: string | null;
};

export const JOB_LIST_LIMIT = 100;

function toSummary(row: JobRow): JobSummary {
  return {
    id: row.id,
    jobId: row.job_id,
    operationRequestId: row.operation_request_id,
    serverId: row.server_id,
    operation: row.operation,
    state: row.state,
    target: redactSensitiveAttributes(row.target) ?? {},
    payload: redactSensitiveAttributes(row.payload) ?? {},
    result: row.result ? (redactSensitiveAttributes(row.result) ?? null) : null,
    leasedBy: row.leased_by,
    leasedUntil: row.leased_until?.toISOString() ?? null,
    retryCount: Number(row.retry_count),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

export async function fetchJobs(
  tx: Bun.SQL,
  tenantId: string,
  options: { state?: string; serverId?: string; cursor?: KeysetCursor } = {}
): Promise<JobListPage> {
  const cursorCreatedAt = options.cursor?.createdAt ?? null;
  const cursorId = options.cursor?.id ?? null;
  const stateFilter = options.state ?? null;
  const serverIdFilter = options.serverId ?? null;

  const rows = (await tx`
    SELECT id, job_id, operation_request_id, server_id, operation, state,
           target, payload, result, leased_by, leased_until, retry_count,
           created_at, updated_at,
           ${tx.unsafe(keysetCursorCreatedAtSql())} AS created_at_cursor
    FROM awcms_omes_jobs
    WHERE tenant_id = ${tenantId}
      AND (${stateFilter}::text IS NULL OR state = ${stateFilter})
      AND (${serverIdFilter}::text IS NULL OR server_id = ${serverIdFilter})
      AND (
        ${cursorCreatedAt}::timestamptz IS NULL
        OR (created_at, id) < (${cursorCreatedAt}, ${cursorId})
      )
    ORDER BY created_at DESC, id DESC
    LIMIT ${JOB_LIST_LIMIT}
  `) as JobRow[];

  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === JOB_LIST_LIMIT && last
      ? encodeKeysetCursor(last.created_at_cursor, last.id)
      : null;

  return { jobs: rows.map(toSummary), nextCursor };
}

export async function fetchJobDetail(
  tx: Bun.SQL,
  tenantId: string,
  id: string
): Promise<JobSummary | null> {
  const rows = (await tx`
    SELECT id, job_id, operation_request_id, server_id, operation, state,
           target, payload, result, leased_by, leased_until, retry_count,
           created_at, updated_at, '' AS created_at_cursor
    FROM awcms_omes_jobs
    WHERE tenant_id = ${tenantId} AND id = ${id}
  `) as JobRow[];
  const row = rows[0];

  return row ? toSummary(row) : null;
}

export type RetryJobOutcome =
  | { outcome: "requeued"; job: JobSummary }
  | { outcome: "not_found" }
  | { outcome: "not_retryable"; currentState: string };

/**
 * `POST /api/v1/omes/jobs/{id}/approve` (Issue ahliweb/omes#198) — guarded
 * by `omes_control.jobs.approve` ("Approve mutating or high-risk OMES
 * jobs"). Only a TERMINAL `failed` job may be requeued: the job's
 * underlying `operation_request` already passed the safe-operation or
 * destructive-workflow gate before this job row ever existed (see
 * `application/operation-submission.ts`), so this is not a second,
 * independent approval authority — it is an operator's explicit decision to
 * give an already-approved intent one more attempt after a worker-side
 * failure, incrementing `retry_count` so the audit trail shows it was
 * retried rather than freshly queued.
 */
export async function retryFailedJob(
  tx: Bun.SQL,
  tenantId: string,
  id: string
): Promise<RetryJobOutcome> {
  const existingRows = (await tx`
    SELECT state FROM awcms_omes_jobs
    WHERE tenant_id = ${tenantId} AND id = ${id}
  `) as { state: string }[];
  const existing = existingRows[0];

  if (!existing) {
    return { outcome: "not_found" };
  }

  if (existing.state !== "failed") {
    return { outcome: "not_retryable", currentState: existing.state };
  }

  const updatedRows = (await tx`
    UPDATE awcms_omes_jobs
    SET state = 'queued', retry_count = retry_count + 1, leased_by = NULL,
        leased_until = NULL, updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id} AND state = 'failed'
    RETURNING id, job_id, operation_request_id, server_id, operation, state,
      target, payload, result, leased_by, leased_until, retry_count,
      created_at, updated_at, '' AS created_at_cursor
  `) as JobRow[];
  const updated = updatedRows[0];

  if (!updated) {
    return { outcome: "not_retryable", currentState: "unknown" };
  }

  return { outcome: "requeued", job: toSummary(updated) };
}

export type CancelJobOutcome =
  | { outcome: "cancelled"; job: JobSummary }
  | { outcome: "not_found" }
  | { outcome: "not_cancellable"; currentState: string };

/**
 * Only a `queued` job may be cancelled here (issue #198 scope: "Cancel of
 * queued jobs guarded by jobs.cancel"). A `leased`/`running` job is already
 * in flight on a worker this endpoint has no channel to reach — AWCMS never
 * talks to a host directly — so cancelling those is left to OMES's own job
 * runner (ahliweb/omes#199+), not claimed here.
 */
export async function cancelQueuedJob(
  tx: Bun.SQL,
  tenantId: string,
  id: string
): Promise<CancelJobOutcome> {
  const existingRows = (await tx`
    SELECT state FROM awcms_omes_jobs
    WHERE tenant_id = ${tenantId} AND id = ${id}
  `) as { state: string }[];
  const existing = existingRows[0];

  if (!existing) {
    return { outcome: "not_found" };
  }

  if (existing.state !== "queued") {
    return { outcome: "not_cancellable", currentState: existing.state };
  }

  const updatedRows = (await tx`
    UPDATE awcms_omes_jobs
    SET state = 'cancelled', updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id} AND state = 'queued'
    RETURNING id, job_id, operation_request_id, server_id, operation, state,
      target, payload, result, leased_by, leased_until, retry_count,
      created_at, updated_at, '' AS created_at_cursor
  `) as JobRow[];
  const updated = updatedRows[0];

  // Lost a race against a concurrent lease between the SELECT and UPDATE.
  if (!updated) {
    return { outcome: "not_cancellable", currentState: "leased" };
  }

  return { outcome: "cancelled", job: toSummary(updated) };
}
