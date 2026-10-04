import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { postTransfer } from "../../../../../modules/inventory/application/inventory-ledger";
import {
  enforceBackdateWindow,
  postedResult,
  readIdempotencyKey,
  readValidatedBody,
  runIdempotent
} from "../../../../../modules/inventory/application/inventory-route-support";
import { INVENTORY_GUARDS } from "../../../../../modules/inventory/domain/inventory-permissions";
import {
  validateTransferInput,
  type TransferInput
} from "../../../../../modules/inventory/domain/inventory-validation";

const IDEMPOTENCY_SCOPE = "inventory_transfer_post";

type Prepared = { idempotencyKey: string; input: TransferInput };

/**
 * `POST /api/v1/inventory/transfers` — move stock between two locations as a
 * BALANCED out/in pair, in one transaction.
 *
 * Both legs are validated against locked state before either is written, so a
 * refused transfer (`INSUFFICIENT_STOCK` at the source, an inactive
 * destination) leaves nothing behind; and a deferred constraint trigger in the
 * database independently refuses to commit anything that is not exactly one out
 * leg and one in leg netting to zero. The response lists the out leg first.
 *
 * Replaying the same source identity returns the ORIGINAL pair (`replayed:
 * true`) — the pair is never posted twice and never half-posted.
 */
export const POST = defineTenantRoute<Prepared>({
  workClass: "critical_transaction",
  prepare: async ({ request }) => {
    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) {
      return idempotencyKey;
    }

    const input = await readValidatedBody(request, validateTransferInput);

    return input instanceof Response ? input : { idempotencyKey, input };
  },
  authorize: INVENTORY_GUARDS.movements.transfer,
  handler: async ({ tx, tenantId, auth, prepared, locals, tokenHash, now }) =>
    runIdempotent(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey,
      prepared.input,
      async () => {
        const tooOld = await enforceBackdateWindow(
          tx,
          tenantId,
          tokenHash,
          now,
          prepared.input.occurredAt
        );

        if (tooOld) {
          return tooOld;
        }

        const actor = {
          actorTenantUserId: auth.context.tenantUserId,
          correlationId: locals.correlationId
        };
        const result = await postTransfer(tx, tenantId, prepared.input, actor);

        return postedResult(
          tx,
          tenantId,
          actor.actorTenantUserId,
          actor.correlationId,
          result,
          () => ({
            action: "inventory.transfer.posted",
            severity: "warning",
            message: "Stock transfer posted."
          })
        );
      }
    )
});
