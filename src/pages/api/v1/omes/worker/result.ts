/**
 * `POST /api/v1/omes/worker/result` — ahliweb/omes#199.
 *
 * Session-UNauthenticated. `worker-result.request` carries no `nonce`/
 * `timestamp` field (unlike `worker-poll.request`), so replay protection
 * here is entirely header-based: `X-Omes-Nonce` / `X-Omes-Timestamp` /
 * `X-Omes-Worker-Signature`. `verifyWorkerEnvelope` (the ADR-0063
 * chokepoint) runs first; `ingestWorkerResult` only ever runs for an
 * already-verified envelope.
 *
 * See `application/worker-result-ingestion.ts`'s header for why this is
 * correlated by `idempotency_key`, never a wire `job_id` — that field no
 * longer exists on `worker-result.request` at all (issue ahliweb/omes#221,
 * re-vendored alongside ahliweb/omes#232): `additionalProperties: false`
 * means a request that still carries one is rejected by
 * `validateOmesContractText` before this handler does anything else.
 *
 * The RESPONSE schema (`worker-result.response`, unchanged) still requires a
 * `job_id` field. On `recorded`/`duplicate_ignored` this is the SERVER's own
 * `awcms_omes_jobs.id` — `ingestWorkerResult` already resolved that row to
 * do the update, so it is real, not a placeholder. On `rejected` (including
 * the `unknown_job` outcome folded into it, per this route's own
 * never-distinguish-the-cause discipline) the response instead emits the
 * fixed literal `"unknown"` — deliberately, not an oversight: echoing a
 * resolved job id on a REJECTED response would let an attacker who knows a
 * `(tenant, server)` pair but not a worker's real signing key use this
 * endpoint as an oracle for "does a job matching this idempotency_key
 * exist", one bit of information cheaper than actually leasing it.
 */
import type { APIRoute } from "astro";

import { jsonResponse } from "../../../../../modules/_shared/api-response";
import {
  InvalidWorkerTenantIdError,
  runWorkerTenantWork
} from "../../../../../modules/omes-control/application/worker-route-runner";
import {
  readCappedText,
  BODY_SIZE_TIER_BYTES
} from "../../../../../lib/security/request-body-limit";
import {
  checkSharedRateLimit,
  resolveClientIp
} from "../../../../../lib/security/rate-limit";
import { validateOmesContractText } from "../../../../../modules/omes-control/domain/contracts";
import { verifyWorkerEnvelope } from "../../../../../modules/omes-control/application/worker-envelope-guard";
import { ingestWorkerResult } from "../../../../../modules/omes-control/application/worker-result-ingestion";

const RATE_LIMIT = { maxAttempts: 60, windowMs: 60_000 };
/**
 * CONFIRMED LOW (independent review of PR #823): see `enroll.ts`'s matching
 * comment — the limit above is keyed on the ATTACKER-CLAIMED, unverified
 * (tenant, worker) pair. This per-source-IP limit is the actual
 * aggregate-volume bound.
 */
const IP_RATE_LIMIT = { maxAttempts: 300, windowMs: 60_000 };
const PATH = "/api/v1/omes/worker/result";

type ResultBody = {
  tenant_id?: unknown;
  server_id?: unknown;
  worker_id?: unknown;
  correlation_id?: unknown;
  idempotency_key?: unknown;
  operation?: unknown;
  state?: unknown;
  started_at?: unknown;
  completed_at?: unknown;
  evidence?: unknown;
  error?: unknown;
};

function rejected(now: Date): Response {
  return jsonResponse(
    {
      job_id: "unknown",
      status: "rejected",
      reconciled: false,
      recorded_at: now.toISOString()
    },
    { status: 200 }
  );
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const bodyRead = await readCappedText(request, BODY_SIZE_TIER_BYTES.default);
  const now = new Date();

  if (bodyRead.tooLarge) {
    return rejected(now);
  }

  const ipRateLimit = await checkSharedRateLimit(
    `omes-worker-result-ip:${resolveClientIp(request, clientAddress)}`,
    IP_RATE_LIMIT
  );

  if (!ipRateLimit.allowed) {
    return jsonResponse(
      {
        job_id: "unknown",
        status: "rejected",
        reconciled: false,
        recorded_at: now.toISOString()
      },
      {
        status: 429,
        headers: { "retry-after": String(ipRateLimit.retryAfterSec) }
      }
    );
  }

  let parsed: ResultBody;

  try {
    parsed = JSON.parse(bodyRead.text) as ResultBody;
  } catch {
    return rejected(now);
  }

  const tenantId = typeof parsed.tenant_id === "string" ? parsed.tenant_id : "";
  const workerId = typeof parsed.worker_id === "string" ? parsed.worker_id : "";

  const rateLimit = await checkSharedRateLimit(
    `omes-worker-result:${tenantId || "unknown"}:${workerId || "unknown"}`,
    RATE_LIMIT
  );

  if (!rateLimit.allowed) {
    return jsonResponse(
      {
        job_id: "unknown",
        status: "rejected",
        reconciled: false,
        recorded_at: now.toISOString()
      },
      {
        status: 429,
        headers: { "retry-after": String(rateLimit.retryAfterSec) }
      }
    );
  }

  const contractErrors = await validateOmesContractText(
    "worker-result.request",
    bodyRead.text,
    { version: request.headers.get("x-omes-contract-version") ?? undefined }
  ).catch(() => ["unsupported_contract_version"]);

  if (contractErrors.length > 0 || !tenantId) {
    return rejected(now);
  }

  let result;

  try {
    result = await runWorkerTenantWork(tenantId, async (tx) => {
      const verification = await verifyWorkerEnvelope(
        tx,
        {
          route: "result",
          method: "POST",
          path: PATH,
          tenantId: parsed.tenant_id,
          serverId: parsed.server_id,
          workerId: parsed.worker_id,
          timestamp: request.headers.get("x-omes-timestamp"),
          nonce: request.headers.get("x-omes-nonce"),
          rawBody: bodyRead.text,
          signatureHeader: request.headers.get("x-omes-worker-signature")
        },
        now
      );

      if (!verification.ok) {
        return { kind: "denied" as const };
      }

      const outcome = await ingestWorkerResult(
        tx,
        {
          tenantId: verification.tenantId,
          serverId: verification.serverId,
          workerId: verification.workerId,
          correlationId: String(parsed.correlation_id),
          idempotencyKey: String(parsed.idempotency_key),
          operation: String(parsed.operation),
          state: parsed.state as "succeeded" | "failed" | "rejected",
          startedAt: String(parsed.started_at),
          completedAt: String(parsed.completed_at),
          evidence: (parsed.evidence ?? {}) as Record<string, unknown>,
          error: parsed.error as { code: string; message: string } | undefined
        },
        now
      );

      return { kind: "ingested" as const, outcome };
    });
  } catch (error) {
    if (error instanceof InvalidWorkerTenantIdError) {
      return rejected(now);
    }
    throw error;
  }

  if (result instanceof Response) {
    return result;
  }

  if (result.kind === "denied") {
    return rejected(now);
  }

  const { outcome } = result;

  if (outcome.outcome === "unknown_job") {
    return rejected(now);
  }

  return jsonResponse(
    {
      job_id: outcome.jobId,
      status: outcome.outcome === "recorded" ? "recorded" : "duplicate_ignored",
      reconciled: outcome.reconciled,
      recorded_at: now.toISOString()
    },
    { status: 200 }
  );
};
