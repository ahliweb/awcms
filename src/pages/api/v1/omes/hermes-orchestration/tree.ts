import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { ok } from "../../../../../modules/_shared/api-response";
import { OMES_GUARDS } from "../../../../../modules/omes-control/domain/permissions";
import { fetchOrchestrationTrees } from "../../../../../modules/omes-control/application/hermes-orchestration-directory";

/**
 * `GET /api/v1/omes/hermes-orchestration/tree` (Issue ahliweb/omes#246,
 * OMES issue #183) — the tenant-scoped live orchestration tree snapshots,
 * for `/admin/omes/orkestrasi-langsung` and `/admin/omes/hermes`. Guarded
 * by `omes_control.hermes_orchestration.read`, re-checked here server-side
 * regardless of what the admin screen itself would have rendered.
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: OMES_GUARDS.hermesOrchestration.read,
  handler: async ({ tx, tenantId, now }) => {
    const trees = await fetchOrchestrationTrees(tx, tenantId, now);
    return ok({ trees });
  }
});
