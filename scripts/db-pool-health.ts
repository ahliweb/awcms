/**
 * db-pool-health.ts — `bun run db:pool:health`.
 *
 * Issue 10.3 (doc 07 §Production readiness checklist "Pool sehat", doc 16
 * §Connection pooling dan backpressure). Thin CLI wrapper around the
 * `GET /api/v1/database/pool/health` endpoint built in Issue 10.2
 * (`src/pages/api/v1/database/pool/health.ts`) — this script does not
 * duplicate any pool/circuit-breaker logic, it only calls the endpoint over
 * HTTP and interprets its `status` field.
 *
 * Exit code semantics mirror the endpoint's own 3-tier status (Issue 10.2):
 * - `"healthy"`/`"degraded"` → exit 0 (degraded is a warning, still a pass —
 *   the endpoint itself already distinguishes "needs attention" from "down").
 * - `"unhealthy"` → exit 1 (hard failure).
 * - Fetch itself failing (server not running, connection refused, DNS
 *   failure, timeout) is ALSO a hard failure — this must never look like a
 *   silent pass just because there was nothing to parse.
 */
import { resolveAppBaseUrl } from "./lib/app-url";
import { safeErrorDetail } from "../src/lib/logging/error-sanitizer";

export type PoolHealthOutcome = {
  ok: boolean;
  message: string;
};

export function interpretPoolHealthStatus(status: unknown): PoolHealthOutcome {
  if (status === "unhealthy") {
    return { ok: false, message: `db:pool:health FAIL — status="unhealthy".` };
  }

  if (status === "degraded") {
    return {
      ok: true,
      message:
        `db:pool:health WARNING — status="degraded" ` +
        "(treated as pass; investigate before go-live)."
    };
  }

  if (status === "healthy") {
    return { ok: true, message: `db:pool:health OK — status="healthy".` };
  }

  return {
    ok: false,
    message: `db:pool:health FAIL — response missing a recognized "status" field (got ${JSON.stringify(status)}).`
  };
}

async function main() {
  const baseUrl = resolveAppBaseUrl();
  const url = new URL("/api/v1/database/pool/health", baseUrl).toString();

  let response: Response;

  try {
    response = await fetch(url);
  } catch (error) {
    const detail = safeErrorDetail(error);
    console.error(
      `db:pool:health FAIL — could not reach ${url}: ${detail}\n` +
        "Is the server running? Start it with `bun run preview` (after `bun run build`) " +
        "or `bun run dev`, or set APP_URL to point at a running instance."
    );
    process.exitCode = 1;
    return;
  }

  let body: unknown;

  try {
    body = await response.json();
  } catch (error) {
    const detail = safeErrorDetail(error);
    console.error(
      `db:pool:health FAIL — response from ${url} was not valid JSON: ${detail}`
    );
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify(body, null, 2));

  if (!response.ok) {
    console.error(`db:pool:health FAIL — HTTP ${response.status} from ${url}.`);
    process.exitCode = 1;
    return;
  }

  const status = (body as { data?: { status?: unknown } })?.data?.status;
  const outcome = interpretPoolHealthStatus(status);

  if (outcome.ok) {
    console.log(outcome.message);
  } else {
    console.error(outcome.message);
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main();
}
