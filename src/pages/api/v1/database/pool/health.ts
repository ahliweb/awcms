import type { APIRoute } from "astro";
import { ok } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { getDatabaseCircuitBreaker } from "../../../../../lib/database/circuit-breaker";
import { getWorkClassSaturation } from "../../../../../lib/database/work-class";
import {
  emitCapacityGauges,
  evaluateCapacityBudget
} from "../../../../../lib/database/capacity-config";

// SSR dinamis (bukan prerender) — endpoint ini harus berjalan per-request
// di atas server (@astrojs/node), sama seperti /api/v1/health. Lihat
// astro.config.mjs dan ADR-0002.
//
// Issue 10.2 (doc 16 §Connection pooling dan backpressure, doc 05 "DB Pool").
// No auth required, matching the existing /api/v1/health liveness endpoint's
// public precedent — but only aggregate counts/booleans are ever exposed
// here, never tenant data or query content.
//
// Issue #743 (epic #738, platform-evolution): also reports `capacity` — this
// PROCESS's own configured pool max / approved budget / reserved headroom
// (src/lib/database/capacity-config.ts). Deliberately NOT a fleet-wide
// aggregate (a single process cannot know how many other instances are
// running) — see database-capacity-runbook.md for the read-only,
// preflight-time cross-instance validation this endpoint does not perform.
// Also refreshes the db_pool_capacity_* gauges on every call, same pattern
// as scripts/database-capacity-check.ts.
export const GET: APIRoute = async () => {
  const breaker = getDatabaseCircuitBreaker();
  const now = new Date();
  const circuitState = breaker.getState(now);
  const saturation = getWorkClassSaturation();
  const capacityReport = evaluateCapacityBudget();

  emitCapacityGauges(capacityReport);

  let databaseReachable = false;

  try {
    const sql = getDatabaseClient();

    await sql`SELECT 1`;
    databaseReachable = true;
  } catch {
    databaseReachable = false;
  }

  const anyClassSaturated = saturation.some(
    (entry) => entry.active >= entry.max && entry.queued > 0
  );

  const status: "healthy" | "degraded" | "unhealthy" = !databaseReachable
    ? "unhealthy"
    : circuitState === "open"
      ? "unhealthy"
      : circuitState === "half_open" || anyClassSaturated
        ? "degraded"
        : "healthy";

  const appUsage = capacityReport.expected.perClass.find(
    (entry) => entry.processClass === "app"
  );

  return ok({
    status,
    databaseReachable,
    circuitBreakerState: circuitState,
    workClasses: saturation,
    capacity: {
      processClass: "app" as const,
      poolMax: appUsage?.poolMax ?? 0,
      approvedConnections: capacityReport.approvedConnections,
      reservedAdminHeadroom: capacityReport.reservedAdminHeadroom
    },
    generatedAt: now.toISOString()
  });
};
