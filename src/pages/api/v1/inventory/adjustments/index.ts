import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { postAdjustment } from "../../../../../modules/inventory/application/inventory-ledger";
import {
  postedResult,
  readIdempotencyKey,
  readValidatedBody,
  runIdempotent
} from "../../../../../modules/inventory/application/inventory-route-support";
import { INVENTORY_GUARDS } from "../../../../../modules/inventory/domain/inventory-permissions";
import {
  validateAdjustmentInput,
  type AdjustmentInput
} from "../../../../../modules/inventory/domain/inventory-validation";

const IDEMPOTENCY_SCOPE = "inventory_adjustment_post";

type Prepared = { idempotencyKey: string; input: AdjustmentInput };

/**
 * `POST /api/v1/inventory/adjustments` — post a stock ADJUSTMENT: the one
 * movement type that carries its own sign (`quantityDelta`) and the only way to
 * change stock without a business document behind it (a stock count, shrinkage).
 *
 * That is why it has its own permission (`movements.adjust`, HIGH-RISK) and
 * requires a `reasonCode`: the reason IS the audit trail. A mistake here is
 * undone with `POST .../adjustments/{id}/reversal`, never by editing the row.
 */
export const POST = defineTenantRoute<Prepared>({
  workClass: "critical_transaction",
  prepare: async ({ request }) => {
    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) {
      return idempotencyKey;
    }

    const input = await readValidatedBody(request, validateAdjustmentInput);

    return input instanceof Response ? input : { idempotencyKey, input };
  },
  authorize: INVENTORY_GUARDS.movements.adjust,
  handler: async ({ tx, tenantId, auth, prepared, locals }) =>
    runIdempotent(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey,
      prepared.input,
      async () => {
        const actor = {
          actorTenantUserId: auth.context.tenantUserId,
          correlationId: locals.correlationId
        };
        const result = await postAdjustment(
          tx,
          tenantId,
          prepared.input,
          actor
        );

        return postedResult(
          tx,
          tenantId,
          actor.actorTenantUserId,
          actor.correlationId,
          result,
          () => ({
            action: "inventory.adjustment.posted",
            severity: "warning",
            message: "Stock adjustment posted.",
            reasonCode: prepared.input.reasonCode
          })
        );
      }
    )
});
