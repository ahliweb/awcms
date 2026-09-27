/**
 * `POST /api/v1/omes/worker/hermes-orchestration-event` (Issue
 * ahliweb/omes#246, OMES issue #183, ADR-0028).
 *
 * Session-UNauthenticated, same Ed25519-envelope authentication chokepoint
 * as `/worker/{poll,result,heartbeat,ai-privacy-posture,
 * hermes-orchestration-tree}` (`verifyWorkerEnvelope`,
 * `route: "hermes-orchestration-event"`). Wraps OMES's
 * `hermes-orchestration-event` projection schema in the same small
 * AWCMS-owned envelope, carrying the worker-identity fields plus an
 * `event` object that MUST independently validate against the vendored
 * schema.
 *
 * A redelivered event (the pull worker's outbox is at-least-once) is
 * answered the same `acknowledged` response as a first delivery —
 * `ingestOrchestrationEvent`'s `ON CONFLICT DO NOTHING` makes this
 * idempotent at the database layer, so this route does not need to (and
 * must not) distinguish a duplicate from a fresh insert in its response.
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
import { ingestOrchestrationEvent } from "../../../../../modules/omes-control/application/hermes-orchestration-ingestion";

const RATE_LIMIT = { maxAttempts: 120, windowMs: 60_000 };
const IP_RATE_LIMIT = { maxAttempts: 600, windowMs: 60_000 };
const PATH = "/api/v1/omes/worker/hermes-orchestration-event";

type EventBody = {
  tenant_id?: unknown;
  server_id?: unknown;
  worker_id?: unknown;
  nonce?: unknown;
  timestamp?: unknown;
  event?: unknown;
};

function rejected(): Response {
  return jsonResponse({ status: "rejected" }, { status: 200 });
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const bodyRead = await readCappedText(request, BODY_SIZE_TIER_BYTES.default);

  if (bodyRead.tooLarge) {
    return jsonResponse({ status: "rejected" }, { status: 413 });
  }

  const ipRateLimit = await checkSharedRateLimit(
    `omes-worker-hermes-event-ip:${resolveClientIp(request, clientAddress)}`,
    IP_RATE_LIMIT
  );

  if (!ipRateLimit.allowed) {
    return jsonResponse(
      { status: "rejected" },
      {
        status: 429,
        headers: { "retry-after": String(ipRateLimit.retryAfterSec) }
      }
    );
  }

  let parsed: EventBody;

  try {
    parsed = JSON.parse(bodyRead.text) as EventBody;
  } catch {
    return rejected();
  }

  const tenantId = typeof parsed.tenant_id === "string" ? parsed.tenant_id : "";
  const serverId = typeof parsed.server_id === "string" ? parsed.server_id : "";
  const workerId = typeof parsed.worker_id === "string" ? parsed.worker_id : "";

  const rateLimit = await checkSharedRateLimit(
    `omes-worker-hermes-event:${tenantId || "unknown"}:${workerId || "unknown"}`,
    RATE_LIMIT
  );

  if (!rateLimit.allowed) {
    return jsonResponse(
      { status: "rejected" },
      {
        status: 429,
        headers: { "retry-after": String(rateLimit.retryAfterSec) }
      }
    );
  }

  if (
    !tenantId ||
    typeof parsed.event !== "object" ||
    parsed.event === null ||
    Array.isArray(parsed.event)
  ) {
    return rejected();
  }

  const eventText = JSON.stringify(parsed.event);
  const contractErrors = await validateOmesContractText(
    "hermes-orchestration-event",
    eventText,
    { version: request.headers.get("x-omes-contract-version") ?? undefined }
  ).catch(() => ["unsupported_contract_version"]);

  if (contractErrors.length > 0) {
    return rejected();
  }

  const event = parsed.event as Record<string, unknown>;

  // The event's own tenant_id/server_id must agree with the worker
  // envelope's authenticated tenant_id/server_id — same cross-check as the
  // tree route and ai-privacy-posture.ts.
  if (event.tenant_id !== tenantId || event.server_id !== serverId) {
    return rejected();
  }

  const now = new Date();
  let result;

  try {
    result = await runWorkerTenantWork(tenantId, async (tx) => {
      const verification = await verifyWorkerEnvelope(
        tx,
        {
          route: "hermes-orchestration-event",
          method: "POST",
          path: PATH,
          tenantId: parsed.tenant_id,
          serverId: parsed.server_id,
          workerId: parsed.worker_id,
          timestamp: parsed.timestamp,
          nonce: request.headers.get("x-omes-nonce") ?? parsed.nonce,
          rawBody: bodyRead.text,
          signatureHeader: request.headers.get("x-omes-worker-signature")
        },
        now
      );

      if (!verification.ok) {
        return { kind: "denied" as const };
      }

      const outcome = await ingestOrchestrationEvent(tx, {
        tenantId: verification.tenantId,
        correlationId: crypto.randomUUID(),
        eventType: String(event.event_type ?? "subagent_step"),
        serverId: verification.serverId,
        sessionId: String(event.session_id ?? ""),
        turnId: typeof event.turn_id === "string" ? event.turn_id : undefined,
        subagentId: String(event.subagent_id ?? ""),
        parentSubagentId:
          typeof event.parent_subagent_id === "string"
            ? event.parent_subagent_id
            : null,
        role: typeof event.role === "string" ? event.role : undefined,
        goal: typeof event.goal === "string" ? event.goal : undefined,
        state: String(event.state ?? "UNKNOWN"),
        stepNumber:
          typeof event.step_number === "number" ? event.step_number : undefined,
        activeTool:
          typeof event.active_tool === "string" ? event.active_tool : undefined,
        summary: typeof event.summary === "string" ? event.summary : undefined,
        hermesVersion: String(event.hermes_version ?? "unknown"),
        eventTimestamp: String(event.timestamp ?? now.toISOString())
      });

      return { kind: "ingested" as const, outcome };
    });
  } catch (error) {
    if (error instanceof InvalidWorkerTenantIdError) {
      return rejected();
    }
    throw error;
  }

  if (result instanceof Response) {
    return result;
  }

  if (
    result.kind === "denied" ||
    result.outcome.outcome === "rejected_disallowed_field"
  ) {
    return rejected();
  }

  return jsonResponse(
    { status: "acknowledged", received_at: now.toISOString() },
    { status: 200 }
  );
};
