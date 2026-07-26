import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  boundAuditSummaryLimit,
  fetchModuleAuditSummary,
  MODULE_AUDIT_SUMMARY_DEFAULT_LIMIT
} from "../../../../../modules/module-management/application/module-audit-summary";
import { getModuleByKey } from "../../../../../modules";

/**
 * `GET /api/v1/modules/{moduleKey}/audit` — recent module-management activity
 * for one module.
 *
 * Guarded by `logging.audit_trail.read`, NOT by a module-management permission.
 * The rows are audit-log rows; whoever may read the audit log may read this
 * slice of it, and whoever may not must not get a filtered view of the same
 * data through a different door.
 *
 * A `moduleKey` that is not registered answers 404 rather than an empty list —
 * an empty list for a typo reads as "nothing has happened to this module",
 * which is a different and wrong statement.
 */
export const GET = defineTenantRoute<{ limit: number }>({
  workClass: "reporting",
  prepare: ({ url }) => {
    const raw = url.searchParams.get("limit");

    return {
      limit: raw === null ? MODULE_AUDIT_SUMMARY_DEFAULT_LIMIT : Number(raw)
    };
  },
  authorize: {
    // `audit_trail`, not `audit_log`. `logging` seeds exactly one permission
    // (`logging.audit_trail.read`, sql/007) and `/api/v1/logs/audit` already
    // guards on it. Naming a plausible-but-unseeded action here would deny
    // every caller including the owner — the latent-authz trap this repo has
    // hit before on the roles and ABAC write surfaces, and which is invisible
    // in review because the guard reads perfectly well.
    moduleKey: "logging",
    activityCode: "audit_trail",
    action: "read"
  },
  handler: async ({ tx, tenantId, params, prepared }) => {
    const moduleKey = params.moduleKey ?? "";

    if (!getModuleByKey(moduleKey)) {
      return fail(404, "RESOURCE_NOT_FOUND", "Module is not registered.");
    }

    return ok({
      moduleKey,
      limit: boundAuditSummaryLimit(prepared.limit),
      entries: await fetchModuleAuditSummary(
        tx,
        tenantId,
        moduleKey,
        prepared.limit
      )
    });
  }
});
