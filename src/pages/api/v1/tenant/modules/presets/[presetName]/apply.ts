import { fail, ok } from "../../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../../modules/_shared/tenant-route";
import { applyModulePreset } from "../../../../../../../modules/module-management/application/module-presets";
import { recordAuditEvent } from "../../../../../../../modules/logging/application/audit-log";

/**
 * `POST /api/v1/tenant/modules/{presetName}/apply` — bring the tenant's module
 * state to a named profile.
 *
 * Guarded by `tenant_modules.disable`, not a new `presets.apply` action. A
 * preset apply IS a sequence of enables and disables, and `disable` is the
 * stronger of the two permissions the underlying primitives require — so the
 * guard here can never be weaker than doing the same thing by hand. A new
 * action would need a seed migration, and an unseeded action denies even the
 * owner (the latent-authz trap already hit on the roles and ABAC write
 * surfaces).
 *
 * Partial application is a real outcome, not an error: each planned change runs
 * the real lifecycle validation and can be rejected. `complete: false` with the
 * per-module reasons is more useful than a 500 that hides which half landed.
 */
export const POST = defineTenantRoute({
  // Not "interactive": a preset can touch every module in the registry, each
  // with its own descriptor sync. It is an administrative batch, and must not
  // compete with request traffic for the interactive pool.
  workClass: "maintenance",
  authorize: {
    moduleKey: "module_management",
    activityCode: "tenant_modules",
    action: "disable"
  },
  handler: async ({ tx, tenantId, auth, params, locals }) => {
    const presetName = params.presetName ?? "";
    const result = await applyModulePreset(
      tx,
      tenantId,
      presetName,
      auth.context.tenantUserId
    );

    if (!result) {
      return fail(404, "RESOURCE_NOT_FOUND", "Unknown module preset.");
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "module_management",
      action: "tenant_module_preset_applied",
      resourceType: "module_preset",
      resourceId: result.presetName,
      correlationId: locals.correlationId,
      message: `Applied module preset "${result.presetName}" (${result.complete ? "complete" : "partial"}).`,
      severity: result.complete ? "info" : "warning",
      attributes: {
        enabled: result.changes
          .filter((c) => c.action === "enable" && c.outcome === "applied")
          .map((c) => c.moduleKey),
        disabled: result.changes
          .filter((c) => c.action === "disable" && c.outcome === "applied")
          .map((c) => c.moduleKey),
        rejected: result.changes
          .filter((c) => c.outcome === "rejected")
          .map((c) => c.moduleKey),
        complete: result.complete
      }
    });

    return ok(result);
  }
});
