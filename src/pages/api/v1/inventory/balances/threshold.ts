import { fail } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import { setLowStockThreshold } from "../../../../../modules/inventory/application/inventory-balance-directory";
import {
  readIdempotencyKey,
  readValidatedBody,
  runIdempotent
} from "../../../../../modules/inventory/application/inventory-route-support";
import { INVENTORY_GUARDS } from "../../../../../modules/inventory/domain/inventory-permissions";
import {
  validateThresholdInput,
  type ThresholdInput
} from "../../../../../modules/inventory/domain/inventory-validation";

const IDEMPOTENCY_SCOPE = "inventory_threshold_set";

type Prepared = { idempotencyKey: string; input: ThresholdInput };

/**
 * `PUT /api/v1/inventory/balances/threshold` — set (or clear, with `null`) the
 * low-stock threshold of one `(location, item)`.
 *
 * This touches `low_stock_threshold` and NOTHING else: the on-hand quantity is
 * not a field of this request, and a body that names one is a 400. Changing the
 * threshold can move a balance across the low-stock line; that transition is
 * recorded in the same transaction and, for a downward crossing, published.
 */
export const PUT = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) {
      return idempotencyKey;
    }

    const input = await readValidatedBody(request, validateThresholdInput);

    return input instanceof Response ? input : { idempotencyKey, input };
  },
  authorize: INVENTORY_GUARDS.policy.configure,
  handler: async ({ tx, tenantId, auth, prepared, locals }) =>
    runIdempotent(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey,
      prepared.input,
      async () => {
        const result = await setLowStockThreshold(
          tx,
          tenantId,
          prepared.input,
          {
            actorTenantUserId: auth.context.tenantUserId,
            correlationId: locals.correlationId
          }
        );

        if (result.outcome === "location_not_found") {
          return fail(404, "LOCATION_NOT_FOUND", "Stock location not found.");
        }

        if (result.outcome === "unit_mismatch") {
          return fail(
            409,
            "UNIT_MISMATCH",
            `This item is stocked in unit "${result.expectedUnitCode}" at this location.`,
            {},
            { expectedUnitCode: result.expectedUnitCode }
          );
        }

        await recordAuditEvent(tx, {
          tenantId,
          actorTenantUserId: auth.context.tenantUserId,
          moduleKey: "inventory",
          action: "inventory.threshold.updated",
          resourceType: "inventory_balance",
          resourceId: prepared.input.locationId,
          severity: "info",
          message: "Low-stock threshold changed.",
          attributes: {
            locationId: prepared.input.locationId,
            itemType: prepared.input.itemType,
            itemRef: prepared.input.itemRef,
            before: result.before,
            after: result.balance.lowStockThreshold
          },
          correlationId: locals.correlationId
        });

        return { status: 200, body: result.balance };
      }
    )
});
