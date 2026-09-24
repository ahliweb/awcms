/**
 * `POST /api/v1/omes/worker/result` ingestion (ahliweb/omes#199).
 *
 * Correlated by `(tenant_id, server_id, idempotency_key)` — NOT the wire
 * `job_id`, which `worker-result.request.schema.json` requires but is the
 * WORKER's own local job-store id (see `sql/159`'s header for why: the
 * `operation-request` schema a poll response's `job` object must conform to
 * has no `job_id` property at all). `idempotency_key` is the one identifier
 * both sides agree on — AWCMS minted it at job-promotion time and handed it
 * to the worker in the poll response; the worker echoes it back unchanged.
 *
 * Idempotent by the same `(tenant_id, server_id, idempotency_key)` via a
 * single `INSERT ... ON CONFLICT DO NOTHING RETURNING id` — same
 * rows-returned-decides pattern as `worker-nonce-store.ts` and the shared
 * idempotency store, for the same reason (this driver's SQLSTATE is on
 * `error.errno`, not `error.code`, so catching "23505" is dead code).
 *
 * A 2xx from this endpoint is NEVER "the job succeeded". Every row this
 * writes is stamped `source = 'worker_reported'` / `reconciled = false` at
 * the schema level (sql/159's CHECK + DEFAULT) — this file never sets
 * `reconciled = true`, because nothing in this issue's scope independently
 * confirms host state. `awcms_omes_jobs.state`/`.result` ARE updated (that
 * table is this module's operational queue bookkeeping — cancel/retry logic
 * in #198's `job-directory.ts` depends on jobs reaching a terminal state),
 * but the redacted evidence that lands in the audit projection explicitly
 * carries `source: "worker_reported"` and `reconciled: false` so no report
 * or admin screen reading `awcms_omes_audit_projections` can present a
 * worker's self-report as confirmed success.
 */
import { redactSensitiveAttributes } from "../../_shared/redaction";

export type WorkerResultInput = {
  tenantId: string;
  serverId: string;
  workerId: string;
  workerJobId: string;
  correlationId: string;
  idempotencyKey: string;
  operation: string;
  state: "succeeded" | "failed" | "rejected";
  startedAt: string;
  completedAt: string;
  evidence: Record<string, unknown>;
  error?: { code: string; message: string };
};

export type IngestResultOutcome =
  | { outcome: "recorded"; reconciled: boolean }
  | { outcome: "duplicate_ignored"; reconciled: boolean }
  | { outcome: "unknown_job" };

const JOB_STATE_FOR_REPORTED: Record<WorkerResultInput["state"], string> = {
  succeeded: "completed",
  failed: "failed",
  rejected: "failed"
};

export async function ingestWorkerResult(
  tx: Bun.SQL,
  input: WorkerResultInput,
  now: Date
): Promise<IngestResultOutcome> {
  const jobRows = (await tx`
    SELECT id FROM awcms_omes_jobs
    WHERE tenant_id = ${input.tenantId} AND server_id = ${input.serverId}
      AND idempotency_key = ${input.idempotencyKey}
  `) as { id: string }[];

  if (!jobRows[0]) {
    return { outcome: "unknown_job" };
  }

  const redactedEvidence = redactSensitiveAttributes(input.evidence) ?? {};
  const redactedError = input.error
    ? (redactSensitiveAttributes(input.error) as { code: string; message: string })
    : null;

  const insertedRows = (await tx`
    INSERT INTO awcms_omes_worker_results
      (tenant_id, server_id, worker_id, worker_job_id, correlation_id, idempotency_key,
       operation, reported_state, started_at, completed_at, evidence, error)
    VALUES (
      ${input.tenantId}, ${input.serverId}, ${input.workerId}, ${input.workerJobId},
      ${input.correlationId}, ${input.idempotencyKey}, ${input.operation}, ${input.state},
      ${input.startedAt}, ${input.completedAt}, ${redactedEvidence}::jsonb,
      ${redactedError}::jsonb
    )
    ON CONFLICT (tenant_id, server_id, idempotency_key) DO NOTHING
    RETURNING id, reconciled
  `) as { id: string; reconciled: boolean }[];
  const inserted = insertedRows[0];

  if (!inserted) {
    // Duplicate delivery of the SAME idempotency_key — the original
    // recorded row's reconciled flag is what actually reflects reality;
    // re-derive it rather than assuming false.
    const existingRows = (await tx`
      SELECT reconciled FROM awcms_omes_worker_results
      WHERE tenant_id = ${input.tenantId} AND server_id = ${input.serverId}
        AND idempotency_key = ${input.idempotencyKey}
    `) as { reconciled: boolean }[];

    return {
      outcome: "duplicate_ignored",
      reconciled: existingRows[0]?.reconciled ?? false
    };
  }

  // Queue bookkeeping — only ever transitions a `leased`/`running` job, so a
  // duplicate or late-arriving result for an already-terminal job cannot
  // resurrect or re-terminate it.
  await tx`
    UPDATE awcms_omes_jobs
    SET state = ${JOB_STATE_FOR_REPORTED[input.state]},
        result = ${redactedEvidence}::jsonb,
        updated_at = now()
    WHERE tenant_id = ${input.tenantId} AND server_id = ${input.serverId}
      AND idempotency_key = ${input.idempotencyKey} AND state IN ('leased', 'running')
  `;

  await tx`
    INSERT INTO awcms_omes_audit_projections
      (tenant_id, server_id, source_event_id, event_type, evidence, recorded_at)
    VALUES (
      ${input.tenantId}, ${input.serverId}, ${`result:${input.idempotencyKey}`},
      'worker_result_reported',
      ${{
        workerJobId: input.workerJobId,
        idempotencyKey: input.idempotencyKey,
        operation: input.operation,
        reportedState: input.state,
        source: "worker_reported",
        reconciled: false,
        evidence: redactedEvidence,
        error: redactedError
      }}::jsonb,
      ${now}
    )
    ON CONFLICT (tenant_id, server_id, source_event_id) DO NOTHING
  `;

  return { outcome: "recorded", reconciled: inserted.reconciled };
}
