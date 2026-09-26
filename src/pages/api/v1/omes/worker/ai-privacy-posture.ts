/**
 * `POST /api/v1/omes/worker/ai-privacy-posture` (Issue ahliweb/omes#232,
 * OMES issue #217, ADR-0029).
 *
 * Session-UNauthenticated, same Ed25519-envelope authentication chokepoint
 * as `/worker/{poll,result,heartbeat}` (`verifyWorkerEnvelope`,
 * `route: "ai-privacy-posture"` — see `domain/worker-identity.ts`). OMES's
 * `contracts/control-center/v1/ai-privacy-posture-view.schema.json` is a
 * PROJECTION shape (tenant_id/correlation_id/target/... — no worker
 * envelope fields), so this route wraps it in a small AWCMS-owned envelope
 * carrying the worker-identity fields (`tenant_id`/`server_id`/`worker_id`/
 * `nonce`/`timestamp`, the same fields `worker-heartbeat.request` carries)
 * plus a `posture` object that MUST independently validate against the
 * vendored `ai-privacy-posture-view` schema — `additionalProperties: false`
 * throughout that schema makes a prompt/transcript/credential-shaped field
 * structurally impossible to pass. `findDisallowedEvidenceKeys`
 * (`domain/ai-privacy.ts`) is a second, independent runtime scan of
 * `posture.latest_decision`, run inside `ingestAiPrivacyPosture`.
 *
 * A failed envelope OR schema check answers a neutral `rejected` status
 * (never a distinguishing error) — same "a failure at any step returns the
 * identical response" discipline `worker-envelope-guard.ts` documents for
 * poll/result/heartbeat.
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
import { ingestAiPrivacyPosture } from "../../../../../modules/omes-control/application/ai-privacy-ingestion";

const RATE_LIMIT = { maxAttempts: 30, windowMs: 60_000 };
const IP_RATE_LIMIT = { maxAttempts: 300, windowMs: 60_000 };
const PATH = "/api/v1/omes/worker/ai-privacy-posture";

type PostureBody = {
  tenant_id?: unknown;
  server_id?: unknown;
  worker_id?: unknown;
  nonce?: unknown;
  timestamp?: unknown;
  posture?: unknown;
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
    `omes-worker-ai-privacy-posture-ip:${resolveClientIp(request, clientAddress)}`,
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

  let parsed: PostureBody;

  try {
    parsed = JSON.parse(bodyRead.text) as PostureBody;
  } catch {
    return rejected();
  }

  const tenantId = typeof parsed.tenant_id === "string" ? parsed.tenant_id : "";
  const serverId = typeof parsed.server_id === "string" ? parsed.server_id : "";
  const workerId = typeof parsed.worker_id === "string" ? parsed.worker_id : "";

  const rateLimit = await checkSharedRateLimit(
    `omes-worker-ai-privacy-posture:${tenantId || "unknown"}:${workerId || "unknown"}`,
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
    typeof parsed.posture !== "object" ||
    parsed.posture === null ||
    Array.isArray(parsed.posture)
  ) {
    return rejected();
  }

  const postureText = JSON.stringify(parsed.posture);
  const contractErrors = await validateOmesContractText(
    "ai-privacy-posture-view",
    postureText,
    { version: request.headers.get("x-omes-contract-version") ?? undefined }
  ).catch(() => ["unsupported_contract_version"]);

  if (contractErrors.length > 0) {
    return rejected();
  }

  const posture = parsed.posture as Record<string, unknown>;
  const target = posture.target as Record<string, unknown>;

  // The posture projection's own tenant_id/server_id must agree with the
  // worker envelope's authenticated tenant_id/server_id — a worker
  // authenticated for tenant A/server A can never deliver a projection
  // labeled for a different tenant/server, regardless of what the schema
  // alone would accept.
  if (
    posture.tenant_id !== tenantId ||
    !target ||
    target.server_id !== serverId
  ) {
    return rejected();
  }

  const now = new Date();
  let result;

  try {
    result = await runWorkerTenantWork(tenantId, async (tx) => {
      const verification = await verifyWorkerEnvelope(
        tx,
        {
          route: "ai-privacy-posture",
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

      const outcome = await ingestAiPrivacyPosture(tx, {
        tenantId: verification.tenantId,
        correlationId: String(posture.correlation_id ?? ""),
        serverId: verification.serverId,
        deploymentId:
          typeof target.deployment_id === "string"
            ? target.deployment_id
            : undefined,
        authority: String(posture.authority ?? "omes-host"),
        evidenceFreshness: String(posture.evidence_freshness ?? "unknown"),
        classificationMode: String(posture.classification_mode ?? "unknown"),
        destinationClass: String(posture.destination_class ?? "unknown"),
        localEndpointClassification:
          typeof posture.local_endpoint_classification === "string"
            ? posture.local_endpoint_classification
            : undefined,
        status: String(posture.status ?? "BLOCKED"),
        reasonCodes: Array.isArray(posture.reason_codes)
          ? (posture.reason_codes as string[])
          : [],
        lastVerifiedAt:
          typeof posture.last_verified_at === "string"
            ? posture.last_verified_at
            : null,
        projectedAt: String(posture.projected_at ?? now.toISOString()),
        latestDecision:
          (posture.latest_decision as Record<string, unknown> | null) ?? null
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

  if (result.kind === "denied" || result.outcome.outcome !== "ingested") {
    return rejected();
  }

  return jsonResponse(
    { status: "acknowledged", received_at: now.toISOString() },
    { status: 200 }
  );
};
