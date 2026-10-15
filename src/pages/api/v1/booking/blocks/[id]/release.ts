import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { runReleaseBlockRoute } from "../../../../../../modules/booking/application/booking-block-routes";
import {
  asUuid,
  badId,
  readIdempotencyKey,
  readReservationBody
} from "../../../../../../modules/booking/application/booking-route-support";
import { BOOKING_GUARDS } from "../../../../../../modules/booking/domain/booking-permissions";
import { validateEmptyReservationBody } from "../../../../../../modules/booking/domain/booking-reservation-validation";

/**
 * `POST /api/v1/booking/blocks/{id}/release` -- return a block's nights to sale.
 * The block row is locked and the database releases its allocation rows in the
 * same statement, with the block's own release instant. Releasing an already
 * released block returns it with `replayed: true` and writes nothing. An unknown
 * id and another tenant's id are the same `404 BLOCK_NOT_FOUND`. Gated by
 * `booking.blocks.release`; `Idempotency-Key` required; audited `info`. The body
 * is empty. Emits no domain event in v1 (booking.md section 7.4).
 */
export const POST = defineTenantRoute<{ id: string; idempotencyKey: string }>({
  workClass: "interactive",
  prepare: async ({ request, params }) => {
    const id = asUuid(params.id);

    if (!id) {
      return badId();
    }

    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) {
      return idempotencyKey;
    }

    const body = await readReservationBody(
      request,
      validateEmptyReservationBody
    );

    return body instanceof Response ? body : { id, idempotencyKey };
  },
  authorize: BOOKING_GUARDS.blocks.release,
  handler: ({ tx, tenantId, auth, prepared, locals }) =>
    runReleaseBlockRoute(
      tx,
      tenantId,
      auth,
      locals,
      prepared.idempotencyKey,
      prepared.id
    )
});
