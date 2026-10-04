import { fail } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { reverseAdjustment } from "../../../../../../modules/inventory/application/inventory-ledger";
import {
  asUuid,
  postedResult,
  readIdempotencyKey,
  readValidatedBody,
  runIdempotent
} from "../../../../../../modules/inventory/application/inventory-route-support";
import { INVENTORY_GUARDS } from "../../../../../../modules/inventory/domain/inventory-permissions";
import {
  validateReversalInput,
  type ReversalInput
} from "../../../../../../modules/inventory/domain/inventory-validation";

const IDEMPOTENCY_SCOPE = "inventory_adjustment_reverse";

type Prepared = { id: string; idempotencyKey: string; input: ReversalInput };

/**
 * `POST /api/v1/inventory/adjustments/{id}/reversal` — compensate an
 * ADJUSTMENT with an equal and opposite adjustment. The original row is never
 * touched (it is append-only); the correction is a new row linked by
 * `reversesMovementId`.
 *
 * The source identity is derived from the target (`reversal`, `{id}`), so a
 * retry is naturally idempotent, and the partial unique index guarantees one
 * adjustment can be reversed at most once. Reversing can itself be refused
 * (`INSUFFICIENT_STOCK`) when the stock the adjustment added has since been sold
 * and the negative-stock policy forbids going below zero.
 */
export const POST = defineTenantRoute<Prepared>({
  workClass: "critical_transaction",
  prepare: async ({ request, params }) => {
    const id = asUuid(params.id);

    if (!id) {
      return fail(400, "VALIDATION_ERROR", "id must be a UUID.");
    }

    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) {
      return idempotencyKey;
    }

    const input = await readValidatedBody(request, validateReversalInput);

    return input instanceof Response ? input : { id, idempotencyKey, input };
  },
  authorize: INVENTORY_GUARDS.movements.adjust,
  handler: async ({ tx, tenantId, auth, prepared, locals }) =>
    runIdempotent(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey,
      { id: prepared.id, input: prepared.input },
      async () => {
        const actor = {
          actorTenantUserId: auth.context.tenantUserId,
          correlationId: locals.correlationId
        };
        const result = await reverseAdjustment(
          tx,
          tenantId,
          prepared.id,
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
            action: "inventory.adjustment.reversed",
            severity: "warning",
            message: "Stock adjustment reversed.",
            reasonCode: prepared.input.reasonCode
          })
        );
      }
    )
});
