import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { postMovement } from "../../../../../modules/inventory/application/inventory-ledger";
import {
  postedResult,
  readIdempotencyKey,
  readValidatedBody,
  runIdempotent
} from "../../../../../modules/inventory/application/inventory-route-support";
import { INVENTORY_GUARDS } from "../../../../../modules/inventory/domain/inventory-permissions";
import {
  validateOpeningInput,
  type PostMovementInput
} from "../../../../../modules/inventory/domain/inventory-validation";

const IDEMPOTENCY_SCOPE = "inventory_opening_post";

type Prepared = { idempotencyKey: string; input: PostMovementInput };

/**
 * `POST /api/v1/inventory/openings` — state the STARTING quantity of an item at
 * a location. Once per (location, item), and only as its first movement.
 *
 * An opening is not an ordinary movement and is not posted through
 * `POST /movements`. It has no business document behind it — nothing a consumer
 * could point at and nothing the ledger could cross-check — so it is the same
 * kind of power as an adjustment: it creates stock out of a stated number. It
 * therefore needs `movements.adjust` (HIGH-RISK, separately grantable, audited at
 * warning severity), not `movements.create`. A POS service account that holds
 * `create` cannot conjure inventory with it (ADR-0126 §2).
 *
 * The body is a movement WITHOUT `movementType` — the endpoint fixes it, and
 * naming one is a 400. Requires an `Idempotency-Key` and a `source` identity (a
 * stock-take or migration document id keeps a backfill re-runnable).
 */
export const POST = defineTenantRoute<Prepared>({
  workClass: "critical_transaction",
  prepare: async ({ request }) => {
    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) {
      return idempotencyKey;
    }

    const input = await readValidatedBody(request, validateOpeningInput);

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
        const result = await postMovement(tx, tenantId, prepared.input, actor);

        return postedResult(
          tx,
          tenantId,
          actor.actorTenantUserId,
          actor.correlationId,
          result,
          () => ({
            action: "inventory.movement.opening",
            severity: "warning",
            message: "Stock opening balance posted."
          })
        );
      }
    )
});
