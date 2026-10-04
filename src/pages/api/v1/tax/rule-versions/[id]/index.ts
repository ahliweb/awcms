import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { isUuid } from "../../../../../../modules/tax/application/tax-route-support";
import { getRuleVersion } from "../../../../../../modules/tax/application/tax-rule-version-directory";
import {
  TAX_MODULE_KEY,
  TAX_RULES_ACTIVITY_CODE
} from "../../../../../../modules/tax/domain/tax-permissions";

/**
 * `GET /api/v1/tax/rule-versions/{id}` (ADR-0127) — one version with its full
 * rule definition. This is also the document an offline client caches: the
 * definition plus the version's rounding settings are everything the pure
 * calculator needs.
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: {
    moduleKey: TAX_MODULE_KEY,
    activityCode: TAX_RULES_ACTIVITY_CODE,
    action: "read"
  },
  handler: async ({ tx, tenantId, params }) => {
    const id = params.id;

    if (!id || !isUuid(id)) {
      return fail(404, "RESOURCE_NOT_FOUND", "Tax rule version not found.");
    }

    const version = await getRuleVersion(tx, tenantId, id);

    return version
      ? ok(version)
      : fail(404, "RESOURCE_NOT_FOUND", "Tax rule version not found.");
  }
});
