/**
 * `POST /api/v1/omes/worker/hermes-orchestration-tree` (Issue
 * ahliweb/omes#246, OMES issue #183, ADR-0028).
 *
 * Session-UNauthenticated, same Ed25519-envelope authentication chokepoint
 * as `/worker/{poll,result,heartbeat,ai-privacy-posture}`
 * (`verifyWorkerEnvelope`, `route: "hermes-orchestration-tree"` — see
 * `domain/worker-identity.ts`). OMES's
 * `contracts/control-center/v1/hermes-orchestration-tree.schema.json` is a
 * PROJECTION shape (tenant_id/server_id/session_id/... — no worker envelope
 * fields), so this route wraps it in the same small AWCMS-owned envelope
 * `ai-privacy-posture.ts` uses, carrying the worker-identity fields plus a
 * `tree` object that MUST independently validate against the vendored
 * `hermes-orchestration-tree` schema.
 *
 * A failed envelope OR schema check answers a neutral `rejected` status
 * (never a distinguishing error) — same discipline as every other worker
 * route in this module.
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
import { ingestOrchestrationTree } from "../../../../../modules/omes-control/application/hermes-orchestration-ingestion";

const RATE_LIMIT = { maxAttempts: 30, windowMs: 60_000 };
const IP_RATE_LIMIT = { maxAttempts: 300, windowMs: 60_000 };
const PATH = "/api/v1/omes/worker/hermes-orchestration-tree";

type TreeBody = {
  tenant_id?: unknown;
  server_id?: unknown;
  worker_id?: unknown;
  nonce?: unknown;
  timestamp?: unknown;
  tree?: unknown;
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
    `omes-worker-hermes-tree-ip:${resolveClientIp(request, clientAddress)}`,
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

  let parsed: TreeBody;

  try {
    parsed = JSON.parse(bodyRead.text) as TreeBody;
  } catch {
    return rejected();
  }

  const tenantId = typeof parsed.tenant_id === "string" ? parsed.tenant_id : "";
  const serverId = typeof parsed.server_id === "string" ? parsed.server_id : "";
  const workerId = typeof parsed.worker_id === "string" ? parsed.worker_id : "";

  const rateLimit = await checkSharedRateLimit(
    `omes-worker-hermes-tree:${tenantId || "unknown"}:${workerId || "unknown"}`,
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
    typeof parsed.tree !== "object" ||
    parsed.tree === null ||
    Array.isArray(parsed.tree)
  ) {
    return rejected();
  }

  const treeText = JSON.stringify(parsed.tree);
  const contractErrors = await validateOmesContractText(
    "hermes-orchestration-tree",
    treeText,
    { version: request.headers.get("x-omes-contract-version") ?? undefined }
  ).catch(() => ["unsupported_contract_version"]);

  if (contractErrors.length > 0) {
    return rejected();
  }

  const tree = parsed.tree as Record<string, unknown>;

  // The tree projection's own tenant_id/server_id must agree with the
  // worker envelope's authenticated tenant_id/server_id — a worker
  // authenticated for tenant A/server A can never deliver a projection
  // labeled for a different tenant/server, regardless of what the schema
  // alone would accept.
  if (tree.tenant_id !== tenantId || tree.server_id !== serverId) {
    return rejected();
  }

  const now = new Date();
  let result;

  try {
    result = await runWorkerTenantWork(tenantId, async (tx) => {
      const verification = await verifyWorkerEnvelope(
        tx,
        {
          route: "hermes-orchestration-tree",
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

      const nodes = Array.isArray(tree.nodes) ? tree.nodes : [];

      const outcome = await ingestOrchestrationTree(tx, {
        tenantId: verification.tenantId,
        correlationId: crypto.randomUUID(),
        serverId: verification.serverId,
        sessionId: String(tree.session_id ?? ""),
        rootSubagentId: String(tree.root_subagent_id ?? ""),
        generatedAt: String(tree.generated_at ?? now.toISOString()),
        activeCount:
          typeof tree.active_count === "number" ? tree.active_count : 0,
        completedCount:
          typeof tree.completed_count === "number" ? tree.completed_count : 0,
        failedCount:
          typeof tree.failed_count === "number" ? tree.failed_count : 0,
        nodes: (nodes as Record<string, unknown>[]).map((node) => ({
          subagentId: String(node.subagent_id ?? ""),
          parentSubagentId:
            typeof node.parent_subagent_id === "string"
              ? node.parent_subagent_id
              : null,
          role: typeof node.role === "string" ? node.role : undefined,
          goal: typeof node.goal === "string" ? node.goal : undefined,
          state: String(node.state ?? "UNKNOWN"),
          startedAt: String(node.started_at ?? now.toISOString()),
          completedAt:
            typeof node.completed_at === "string" ? node.completed_at : null,
          durationSeconds:
            typeof node.duration_seconds === "number"
              ? node.duration_seconds
              : undefined,
          activeTool:
            typeof node.active_tool === "string" ? node.active_tool : undefined,
          stepCount:
            typeof node.step_count === "number" ? node.step_count : undefined,
          summary: typeof node.summary === "string" ? node.summary : undefined,
          children: Array.isArray(node.children)
            ? (node.children as unknown[]).filter(
                (child): child is string => typeof child === "string"
              )
            : []
        }))
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
