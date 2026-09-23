import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { ok } from "../../../../../modules/_shared/api-response";
import { OMES_GUARDS } from "../../../../../modules/omes-control/domain/permissions";
import { computeOmesOverview } from "../../../../../modules/omes-control/application/overview";

/**
 * `GET /api/v1/omes/overview` (Issue ahliweb/omes#198) — tenant-wide fleet
 * rollup: server/job state counts, health distribution, backup freshness,
 * and drift summary. Guarded by `omes_control.servers.read` — the broadest
 * "may see fleet state" permission in the seeded catalog (sql/155), and the
 * same permission `health.ts` already reuses for cross-cutting telemetry
 * rather than this issue inventing a dedicated `overview.read` activity.
 */
export const GET = defineTenantRoute<undefined>({
  workClass: "interactive",
  authorize: OMES_GUARDS.servers.read,
  handler: async ({ tx, tenantId, now }) =>
    ok({ overview: await computeOmesOverview(tx, tenantId, now) })
});
