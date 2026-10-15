import { ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { getBlock } from "../../../../../modules/booking/application/booking-block-directory";
import { blockNotFound } from "../../../../../modules/booking/application/booking-block-routes";
import {
  asUuid,
  badId
} from "../../../../../modules/booking/application/booking-route-support";
import { BOOKING_GUARDS } from "../../../../../modules/booking/domain/booking-permissions";

/**
 * `GET /api/v1/booking/blocks/{id}` -- one block with the units holding its
 * nights. An unknown id and another tenant's id are the same
 * `404 BLOCK_NOT_FOUND`. Gated by `booking.blocks.read`.
 */
export const GET = defineTenantRoute<{ id: string }>({
  workClass: "interactive",
  prepare: ({ params }) => {
    const id = asUuid(params.id);

    return id ? { id } : badId();
  },
  authorize: BOOKING_GUARDS.blocks.read,
  handler: async ({ tx, tenantId, prepared }) => {
    const block = await getBlock(tx, tenantId, prepared.id);

    return block ? ok({ block }) : blockNotFound();
  }
});
