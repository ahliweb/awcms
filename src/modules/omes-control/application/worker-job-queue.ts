/**
 * Job-queue promotion and leasing for `POST /api/v1/omes/worker/poll`
 * (ahliweb/omes#199).
 *
 * `operation-submission.ts` (#198) only ever leaves an allowlisted operation
 * as an `awcms_omes_operation_requests` row with `status = 'approved'` — its
 * own header says the pull worker is "the only reader that turns an approved
 * row into real host work" but #198 never itself wrote an
 * `awcms_omes_jobs` row. This file is that promotion: it is the first thing
 * IN THIS ISSUE'S scope that makes an approved operation request pollable at
 * all, so a poll response can ever carry `status: "job_available"`.
 *
 * Both steps run in the caller's transaction and are each individually
 * concurrency-safe:
 *   1. `promoteNextApprovedOperation` — `FOR UPDATE SKIP LOCKED` claims at
 *      most one not-yet-promoted `approved` operation_request for this
 *      tenant+server, and inserts exactly one `awcms_omes_jobs` row for it.
 *      The `awcms_omes_jobs_operation_request_unique_idx` partial unique
 *      index (sql/159) is the DB-level backstop if two application
 *      processes ever raced past the `SKIP LOCKED` claim (they cannot, on
 *      one Postgres instance, but this is not this module's only future
 *      deployment topology).
 *   2. `leaseNextQueuedJob` — the same `FOR UPDATE SKIP LOCKED` pattern
 *      leases the oldest `queued` job for this tenant+server to this poll's
 *      worker identity, so two concurrent pollers for the SAME server never
 *      lease the same job (each `SKIP LOCKED`s past whatever the other
 *      already claimed).
 */

export const JOB_LEASE_SECONDS = 120;

export type PromotedJob = {
  jobId: string;
};

export async function promoteNextApprovedOperation(
  tx: Bun.SQL,
  tenantId: string,
  serverId: string
): Promise<PromotedJob | null> {
  const rows = (await tx`
    WITH candidate AS (
      SELECT id, request_id, server_id, operation, parameters
      FROM awcms_omes_operation_requests
      WHERE tenant_id = ${tenantId}
        AND server_id = ${serverId}
        AND status = 'approved'
        AND NOT EXISTS (
          SELECT 1 FROM awcms_omes_jobs j
          WHERE j.operation_request_id = awcms_omes_operation_requests.id
        )
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    INSERT INTO awcms_omes_jobs
      (tenant_id, job_id, operation_request_id, server_id, operation, state, target, payload)
    SELECT
      ${tenantId}, 'job_' || replace(gen_random_uuid()::text, '-', ''), id, server_id,
      operation, 'queued', jsonb_build_object('server_id', server_id), COALESCE(parameters, '{}'::jsonb)
    FROM candidate
    RETURNING job_id
  `) as { job_id: string }[];
  const row = rows[0];

  return row ? { jobId: row.job_id } : null;
}

export type LeasedJob = {
  id: string;
  jobId: string;
  operation: string;
  correlationId: string;
  idempotencyKey: string;
  parameters: Record<string, unknown>;
};

export async function leaseNextQueuedJob(
  tx: Bun.SQL,
  tenantId: string,
  serverId: string,
  workerId: string,
  now: Date
): Promise<LeasedJob | null> {
  const leasedUntil = new Date(now.getTime() + JOB_LEASE_SECONDS * 1000);

  const rows = (await tx`
    WITH candidate AS (
      SELECT id FROM awcms_omes_jobs
      WHERE tenant_id = ${tenantId} AND server_id = ${serverId} AND state = 'queued'
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE awcms_omes_jobs j
    SET state = 'leased', leased_by = ${workerId}, leased_until = ${leasedUntil}, updated_at = now()
    FROM candidate
    WHERE j.id = candidate.id
    RETURNING j.id, j.job_id, j.operation, j.payload,
      COALESCE(j.operation_request_id::text, j.job_id) AS correlation_id
  `) as {
    id: string;
    job_id: string;
    operation: string;
    payload: Record<string, unknown>;
    correlation_id: string;
  }[];
  const row = rows[0];

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    jobId: row.job_id,
    operation: row.operation,
    correlationId: row.correlation_id,
    idempotencyKey: `idem_${row.job_id}`,
    parameters: row.payload ?? {}
  };
}
