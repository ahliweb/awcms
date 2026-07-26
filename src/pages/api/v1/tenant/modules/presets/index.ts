import { ok } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { listModulePresets } from "../../../../../../modules/module-management/application/module-presets";
import { planModulePreset } from "../../../../../../modules/module-management/application/module-presets";

/**
 * `GET /api/v1/tenant/modules/presets` — the preset catalog, and optionally a
 * dry-run plan for one of them (`?preset=<name>`).
 *
 * The plan is a GET on purpose. Applying a preset DISABLES every enabled,
 * unlisted, unprotected module, so an operator switching a live tenant's
 * profile needs to see that list before it happens, not after. Read-only, so it
 * guards on `tenant_modules.read`.
 */
export const GET = defineTenantRoute<{ preset: string | null }>({
  workClass: "interactive",
  prepare: ({ url }) => ({ preset: url.searchParams.get("preset") }),
  authorize: {
    moduleKey: "module_management",
    activityCode: "tenant_modules",
    action: "read"
  },
  handler: async ({ tx, tenantId, prepared }) => {
    if (!prepared.preset) {
      return ok({ presets: listModulePresets() });
    }

    const plan = await planModulePreset(tx, tenantId, prepared.preset);

    if (!plan) {
      return ok({ presets: listModulePresets(), plan: null });
    }

    return ok({ presets: listModulePresets(), plan });
  }
});
