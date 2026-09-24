/**
 * `POST /api/v1/omes/worker/poll` — ahliweb/omes#199.
 *
 * Session-UNauthenticated. `nonce`/`timestamp` are carried in the pinned
 * `worker-poll.request` body (its schema already commits to that shape);
 * the Ed25519 signature over the canonical envelope travels in
 * `X-Omes-Worker-Signature` (see `domain/worker-identity.ts` for why it
 * cannot be a body field). `verifyWorkerEnvelope` — the ADR-0063 chokepoint
 * — runs FIRST, inside the same transaction as everything else, before any
 * job-queue promotion/lease or nonce persistence becomes visible.
 *
 * A failed envelope check answers with the pinned contract's own
 * `re-enroll_required` status rather than an HTTP error — this is the wire
 * shape the real OMES worker (`lib/omes/py/jobs/worker.py`) already parses
 * without special-casing, and it never distinguishes WHY re-enrollment is
 * required (wrong tenant, expired signature window, replay, revoked
 * identity, unknown worker — all fold to the same response).
 */
import type { APIRoute } from "astro";

import { jsonResponse } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import {
  readCappedText,
  BODY_SIZE_TIER_BYTES
} from "../../../../../lib/security/request-body-limit";
import { checkSharedRateLimit } from "../../../../../lib/security/rate-limit";
import { validateOmesContractText } from "../../../../../modules/omes-control/domain/contracts";
import { verifyWorkerEnvelope } from "../../../../../modules/omes-control/application/worker-envelope-guard";
import {
  leaseNextQueuedJob,
  promoteNextApprovedOperation
} from "../../../../../modules/omes-control/application/worker-job-queue";

const RATE_LIMIT = { maxAttempts: 120, windowMs: 60_000 };
const POLL_INTERVAL_SECONDS = 10;
const PATH = "/api/v1/omes/worker/poll";

type PollBody = {
  tenant_id?: unknown;
  server_id?: unknown;
  worker_id?: unknown;
  nonce?: unknown;
  timestamp?: unknown;
};

function reEnrollRequired(tenantId: string, serverId: string): Response {
  return jsonResponse(
    {
      status: "re-enroll_required",
      server_id: serverId || "unknown",
      tenant_id: tenantId || "unknown",
      poll_interval_seconds: POLL_INTERVAL_SECONDS
    },
    { status: 200 }
  );
}

export const POST: APIRoute = async ({ request }) => {
  const bodyRead = await readCappedText(request, BODY_SIZE_TIER_BYTES.default);

  if (bodyRead.tooLarge) {
    return jsonResponse({ status: "re-enroll_required" }, { status: 413 });
  }

  let parsed: PollBody;

  try {
    parsed = JSON.parse(bodyRead.text) as PollBody;
  } catch {
    return reEnrollRequired("unknown", "unknown");
  }

  const tenantId = typeof parsed.tenant_id === "string" ? parsed.tenant_id : "";
  const serverId = typeof parsed.server_id === "string" ? parsed.server_id : "";
  const workerId = typeof parsed.worker_id === "string" ? parsed.worker_id : "";

  const rateLimit = await checkSharedRateLimit(
    `omes-worker-poll:${tenantId || "unknown"}:${workerId || "unknown"}`,
    RATE_LIMIT
  );

  if (!rateLimit.allowed) {
    return jsonResponse(
      { status: "re-enroll_required" },
      { status: 429, headers: { "retry-after": String(rateLimit.retryAfterSec) } }
    );
  }

  const contractErrors = await validateOmesContractText(
    "worker-poll.request",
    bodyRead.text
  ).catch(() => ["unsupported_contract_version"]);

  if (contractErrors.length > 0 || !tenantId) {
    return reEnrollRequired(tenantId, serverId);
  }

  const now = new Date();
  const sql = getDatabaseClient();

  const result = await withTenant(sql, tenantId, async (tx) => {
    const verification = await verifyWorkerEnvelope(
      tx,
      {
        route: "poll",
        method: "POST",
        path: PATH,
        tenantId: parsed.tenant_id,
        serverId: parsed.server_id,
        workerId: parsed.worker_id,
        timestamp: parsed.timestamp,
        nonce: parsed.nonce,
        rawBody: bodyRead.text,
        signatureHeader: request.headers.get("x-omes-worker-signature")
      },
      now
    );

    if (!verification.ok) {
      return { kind: "denied" as const };
    }

    // Best-effort: promote at most one approved-but-not-yet-jobbed operation
    // request into the queue before attempting to lease. A promotion
    // failure here is not this poll's identity/security concern — swallow
    // and fall through to "nothing to lease" rather than turning a queue
    // bookkeeping hiccup into a re-enroll signal.
    await promoteNextApprovedOperation(tx, verification.tenantId, verification.serverId).catch(
      () => null
    );

    const leased = await leaseNextQueuedJob(
      tx,
      verification.tenantId,
      verification.serverId,
      verification.workerId,
      now
    );

    return { kind: "ok" as const, leased };
  });

  if (result instanceof Response) {
    return result;
  }

  if (result.kind === "denied") {
    return reEnrollRequired(tenantId, serverId);
  }

  if (!result.leased) {
    return jsonResponse(
      {
        status: "idle",
        server_id: serverId,
        tenant_id: tenantId,
        poll_interval_seconds: POLL_INTERVAL_SECONDS
      },
      { status: 200 }
    );
  }

  const job = result.leased;

  return jsonResponse(
    {
      status: "job_available",
      server_id: serverId,
      tenant_id: tenantId,
      poll_interval_seconds: POLL_INTERVAL_SECONDS,
      // Conforms EXACTLY to the pinned `operation-request.schema.json`
      // (additionalProperties: false — no `job_id` property exists on this
      // schema; see worker-result-ingestion.ts's header for why the
      // durable cross-system handle is `idempotency_key`, not a job id).
      job: {
        tenant_id: tenantId,
        correlation_id: job.correlationId,
        idempotency_key: job.idempotencyKey,
        actor: { type: "service", id: "control-center" },
        operation: job.operation,
        target: { server_id: serverId },
        permission: {
          granted: true,
          policy_id: "omes_control.safe_operation_allowlist"
        },
        ...(Object.keys(job.parameters).length > 0
          ? { parameters: job.parameters }
          : {})
      }
    },
    { status: 200 }
  );
};
