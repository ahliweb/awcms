import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { ok } from "../../../../../modules/_shared/api-response";
import { OMES_GUARDS } from "../../../../../modules/omes-control/domain/permissions";
import { fetchRepositoryProgress } from "../../../../../modules/omes-control/application/repository-progress-directory";

/**
 * `GET /api/v1/omes/repository-progress` (Issue ahliweb/omes#249, ADR-0030)
 * — the tenant-scoped GitHub repository-progress projection for
 * `/admin/omes/progres-hermes`. Reuses
 * `omes_control.hermes_orchestration.read` (see sql/167's header),
 * re-checked here server-side regardless of what the admin screen itself
 * would have rendered.
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: OMES_GUARDS.hermesOrchestration.read,
  handler: async ({ tx, tenantId, now }) => {
    const progress = await fetchRepositoryProgress(tx, tenantId, now);
    return ok({ progress });
  }
});
