import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { isUuid } from "../../../../../../modules/tax/application/tax-route-support";
import { getSnapshot } from "../../../../../../modules/tax/application/tax-snapshot-directory";
import {
  TAX_MODULE_KEY,
  TAX_SNAPSHOTS_ACTIVITY_CODE
} from "../../../../../../modules/tax/domain/tax-permissions";

/**
 * `GET /api/v1/tax/snapshots/{id}` (ADR-0127) — one snapshot, with its lines.
 *
 * It does NOT embed the rule definition. The snapshot carries a copy (that is what
 * makes it self-contained for a reversal), but the copy is the rules — rates,
 * categories, treatments — and reading rules is `tax.rules.read`, a different
 * power from reading a document. A caller holding only `tax.snapshots.read` gets
 * the version id and number; the definition is one `GET /rule-versions/{id}` away
 * for a caller entitled to it, and is the same bytes because a published version
 * is immutable.
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: {
    moduleKey: TAX_MODULE_KEY,
    activityCode: TAX_SNAPSHOTS_ACTIVITY_CODE,
    action: "read"
  },
  handler: async ({ tx, tenantId, params }) => {
    const id = params.id;

    if (!id || !isUuid(id)) {
      return fail(404, "RESOURCE_NOT_FOUND", "Tax snapshot not found.");
    }

    const snapshot = await getSnapshot(tx, tenantId, id);

    if (!snapshot)
      return fail(404, "RESOURCE_NOT_FOUND", "Tax snapshot not found.");

    return ok(snapshot);
  }
});
