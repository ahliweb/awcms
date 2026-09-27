/**
 * `POST /api/v1/omes/worker/result` ingestion (ahliweb/omes#199).
 *
 * Correlated by `(tenant_id, server_id, idempotency_key)` — NOT a wire
 * `job_id`. `idempotency_key` is the one identifier both sides agree on —
 * AWCMS minted it at job-promotion time and handed it to the worker in the
 * poll response; the worker echoes it back unchanged. `worker-result.
 * request.schema.json` no longer HAS a `job_id` property at all (issue
 * ahliweb/omes#221, re-vendored alongside ahliweb/omes#232) — the field was
 * in practice a client-invented opaque string this repo could never
 * validate, and `additionalProperties: false` now rejects a request that
 * still carries one before this function is ever called. `workerJobId` is
 * therefore optional here and `sql/162` made the column nullable to match;
 * a `null` value simply means "no wire value was ever provided", not a data
 * quality problem.
 *
 * The RESPONSE'S `job_id` field (still required by the unchanged
 * `worker-result.response.schema.json`) is satisfied by the SERVER's own
 * `awcms_omes_jobs.id` — resolved here as `jobId` and returned on both
 * `recorded` and `duplicate_ignored`, never a client-supplied value. See
 * `pages/api/v1/omes/worker/result.ts`'s own header for why the `rejected`/
 * `unknown_job` paths deliberately do NOT do the same (disclosing a
 * resolved job id there would be an oracle).
 *
 * Idempotent by the same `(tenant_id, server_id, idempotency_key)` via a
 * single `INSERT ... ON CONFLICT DO NOTHING RETURNING id` — same
 * rows-returned-decides pattern as `worker-nonce-store.ts` and the shared
 * idempotency store, for the same reason (this driver's SQLSTATE is on
 * `error.errno`, not `error.code`, so catching "23505" is dead code).
 *
 * ## Bound to the LEASING worker, not just tenant+server+key (CONFIRMED
 * MEDIUM, independent review of PR #823)
 *
 * `sql/154` makes `worker_id` unique only per `(tenant_id, worker_id)` —
 * `server_id` is NOT part of that uniqueness, so two enrolled workers can
 * legitimately point at the same `server_id` (a key-rotation window, or two
 * worker processes on one host). Correlating a result by
 * `(tenant_id, server_id, idempotency_key)` alone — the envelope-verified
 * scope, which does correctly stop cross-TENANT substitution — would still
 * let any co-enrolled worker for that `(tenant, server)` submit a
 * correctly-signed result for a job it never leased, as long as it knows
 * (or guesses) the `idempotency_key`. Every read and write here additionally
 * requires `leased_by = ` the verified worker identity: a non-leasing
 * worker gets the same `unknown_job` outcome as a nonexistent job — never
 * distinguished, so this is not a new oracle.
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
  /** No longer present on the wire (issue ahliweb/omes#221) — always `undefined` today; kept optional rather than removed so a historical caller/column value is not implied to be an error. */
  workerJobId?: string;
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
  | { outcome: "recorded"; reconciled: boolean; jobId: string }
  | { outcome: "duplicate_ignored"; reconciled: boolean; jobId: string }
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
      AND idempotency_key = ${input.idempotencyKey} AND leased_by = ${input.workerId}
  `) as { id: string }[];

  if (!jobRows[0]) {
    return { outcome: "unknown_job" };
  }

  const jobId = jobRows[0].id;

  const redactedEvidence = redactSensitiveAttributes(input.evidence) ?? {};
  const redactedError = input.error
    ? (redactSensitiveAttributes(input.error) as {
        code: string;
        message: string;
      })
    : null;

  const insertedRows = (await tx`
    INSERT INTO awcms_omes_worker_results
      (tenant_id, server_id, worker_id, worker_job_id, correlation_id, idempotency_key,
       operation, reported_state, started_at, completed_at, evidence, error)
    VALUES (
      ${input.tenantId}, ${input.serverId}, ${input.workerId},
      ${input.workerJobId ?? null},
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
      reconciled: existingRows[0]?.reconciled ?? false,
      jobId
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
      AND idempotency_key = ${input.idempotencyKey} AND leased_by = ${input.workerId}
      AND state IN ('leased', 'running')
  `;

  await tx`
    INSERT INTO awcms_omes_audit_projections
      (tenant_id, server_id, source_event_id, event_type, evidence, recorded_at)
    VALUES (
      ${input.tenantId}, ${input.serverId}, ${`result:${input.idempotencyKey}`},
      'worker_result_reported',
      ${{
        workerJobId: input.workerJobId ?? null,
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

  return { outcome: "recorded", reconciled: inserted.reconciled, jobId };
}
