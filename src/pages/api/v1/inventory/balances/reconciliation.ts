import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { reconcileBalances } from "../../../../../modules/inventory/application/inventory-balance-directory";
import { asUuid } from "../../../../../modules/inventory/application/inventory-route-support";
import { INVENTORY_GUARDS } from "../../../../../modules/inventory/domain/inventory-permissions";

/**
 * `GET /api/v1/inventory/balances/reconciliation` — proves each balance equals
 * the sum of its movements, or lists every key where it does not. Read-only.
 * `?locationId=` narrows the scope.
 *
 * `consistent: true` is the invariant the whole module rests on; `drift` is what
 * to look at when it is false, and `POST .../balances/rebuild` is what repairs
 * it. `negativeUnderForbid` counts balances that are negative although their
 * location's policy forbids it — ledger and balance can agree perfectly and
 * still describe a state the policy rules out (the policy was tightened after
 * the stock went negative).
 */
export const GET = defineTenantRoute<string | null>({
  workClass: "reporting",
  prepare: ({ url }) => {
    const locationId = url.searchParams.get("locationId");

    if (locationId === null) {
      return null;
    }

    return (
      asUuid(locationId) ??
      fail(400, "VALIDATION_ERROR", "locationId must be a UUID.")
    );
  },
  authorize: INVENTORY_GUARDS.balances.reconcile,
  handler: async ({ tx, tenantId, prepared }) =>
    ok(await reconcileBalances(tx, tenantId, prepared))
});
