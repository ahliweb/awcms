import { ok } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { fetchModuleMatrix } from "../../../../../../modules/module-management/application/module-matrix";

/**
 * `GET /api/v1/tenant/modules/matrix` — every module × what matters for this
 * tenant, in two queries.
 *
 * A read over the module registry, so it guards on `tenant_modules.read`, the
 * same permission `GET /api/v1/tenant/modules` already requires. It adds no
 * data the caller could not assemble from existing endpoints; it assembles it
 * without N round trips and, more usefully, adds the two lifecycle warnings by
 * re-running the REAL validation rather than a UI's guess at it.
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: {
    moduleKey: "module_management",
    activityCode: "tenant_modules",
    action: "read"
  },
  handler: async ({ tx, tenantId }) =>
    ok({ modules: await fetchModuleMatrix(tx, tenantId) })
});
