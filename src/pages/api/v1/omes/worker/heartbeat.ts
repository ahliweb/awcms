/**
 * `POST /api/v1/omes/worker/heartbeat` — ahliweb/omes#199.
 *
 * Session-UNauthenticated, header-based replay protection (same shape as
 * `/worker/result` — `worker-heartbeat.request` has a `timestamp` field but
 * no `nonce`, so `X-Omes-Nonce` is still required as a header). A failed
 * envelope check answers the pinned contract's own `re-enroll_required`
 * status — see `poll.ts`'s header for why that is the right neutral
 * response shape here, not an HTTP error.
 *
 * Never infers "healthy" from a missing/failed heartbeat: staleness is
 * computed on READ (`domain/staleness.ts`, #198) from `last_heartbeat_at`'s
 * age, so an attacker who can suppress heartbeats (or simply a host that is
 * down) makes the server look INCREASINGLY stale over time, never
 * "healthy by default" — this endpoint only ever writes evidence for a
 * report that successfully authenticated.
 */
import type { APIRoute } from "astro";

import { jsonResponse } from "../../../../../modules/_shared/api-response";
import { runWorkerTenantWork } from "../../../../../modules/omes-control/application/worker-route-runner";
import {
  readCappedText,
  BODY_SIZE_TIER_BYTES
} from "../../../../../lib/security/request-body-limit";
import { checkSharedRateLimit } from "../../../../../lib/security/rate-limit";
import { validateOmesContractText } from "../../../../../modules/omes-control/domain/contracts";
import { verifyWorkerEnvelope } from "../../../../../modules/omes-control/application/worker-envelope-guard";
import { ingestWorkerHeartbeat } from "../../../../../modules/omes-control/application/worker-heartbeat-ingestion";

const RATE_LIMIT = { maxAttempts: 30, windowMs: 60_000 };
const HEARTBEAT_INTERVAL_SECONDS = 60;
const PATH = "/api/v1/omes/worker/heartbeat";

type HeartbeatBody = {
  tenant_id?: unknown;
  server_id?: unknown;
  worker_id?: unknown;
  timestamp?: unknown;
  status?: unknown;
  omes_version?: unknown;
  contract_version?: unknown;
  capability_registry_digest?: unknown;
  platform?: unknown;
  uptime_seconds?: unknown;
  last_reconciliation_at?: unknown;
};

function reEnrollRequired(serverId: string): Response {
  return jsonResponse(
    {
      status: "re-enroll_required",
      server_id: serverId || "unknown",
      received_at: new Date().toISOString(),
      next_heartbeat_seconds: HEARTBEAT_INTERVAL_SECONDS
    },
    { status: 200 }
  );
}

export const POST: APIRoute = async ({ request }) => {
  const bodyRead = await readCappedText(request, BODY_SIZE_TIER_BYTES.default);

  if (bodyRead.tooLarge) {
    return jsonResponse({ status: "re-enroll_required" }, { status: 413 });
  }

  let parsed: HeartbeatBody;

  try {
    parsed = JSON.parse(bodyRead.text) as HeartbeatBody;
  } catch {
    return reEnrollRequired("unknown");
  }

  const tenantId = typeof parsed.tenant_id === "string" ? parsed.tenant_id : "";
  const serverId = typeof parsed.server_id === "string" ? parsed.server_id : "";
  const workerId = typeof parsed.worker_id === "string" ? parsed.worker_id : "";

  const rateLimit = await checkSharedRateLimit(
    `omes-worker-heartbeat:${tenantId || "unknown"}:${workerId || "unknown"}`,
    RATE_LIMIT
  );

  if (!rateLimit.allowed) {
    return jsonResponse(
      { status: "re-enroll_required" },
      {
        status: 429,
        headers: { "retry-after": String(rateLimit.retryAfterSec) }
      }
    );
  }

  const contractErrors = await validateOmesContractText(
    "worker-heartbeat.request",
    bodyRead.text,
    { version: request.headers.get("x-omes-contract-version") ?? undefined }
  ).catch(() => ["unsupported_contract_version"]);

  if (contractErrors.length > 0 || !tenantId) {
    return reEnrollRequired(serverId);
  }

  const now = new Date();
  const result = await runWorkerTenantWork(tenantId, async (tx) => {
    const verification = await verifyWorkerEnvelope(
      tx,
      {
        route: "heartbeat",
        method: "POST",
        path: PATH,
        tenantId: parsed.tenant_id,
        serverId: parsed.server_id,
        workerId: parsed.worker_id,
        timestamp: parsed.timestamp,
        nonce: request.headers.get("x-omes-nonce"),
        rawBody: bodyRead.text,
        signatureHeader: request.headers.get("x-omes-worker-signature")
      },
      now
    );

    if (!verification.ok) {
      return { kind: "denied" as const };
    }

    const platform = (parsed.platform ?? {}) as {
      os?: string;
      version?: string;
      arch?: string;
    };

    const outcome = await ingestWorkerHeartbeat(
      tx,
      {
        tenantId: verification.tenantId,
        serverId: verification.serverId,
        reportedStatus: parsed.status as "healthy" | "degraded" | "maintenance",
        omesVersion: String(parsed.omes_version ?? ""),
        contractVersion: String(parsed.contract_version ?? ""),
        capabilityRegistryDigest: String(
          parsed.capability_registry_digest ?? ""
        ),
        platform: {
          os: String(platform.os ?? ""),
          version: String(platform.version ?? ""),
          arch: String(platform.arch ?? "")
        },
        uptimeSeconds: Number(parsed.uptime_seconds ?? 0),
        lastReconciliationAt:
          typeof parsed.last_reconciliation_at === "string"
            ? parsed.last_reconciliation_at
            : undefined
      },
      now
    );

    return { kind: "ingested" as const, outcome };
  });

  if (result instanceof Response) {
    return result;
  }

  if (result.kind === "denied") {
    return reEnrollRequired(serverId);
  }

  if (result.outcome.outcome !== "acknowledged") {
    return reEnrollRequired(serverId);
  }

  return jsonResponse(
    {
      status: "acknowledged",
      server_id: serverId,
      received_at: now.toISOString(),
      next_heartbeat_seconds: HEARTBEAT_INTERVAL_SECONDS
    },
    { status: 200 }
  );
};
