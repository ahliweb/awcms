import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { deleteException } from "../../../../../modules/booking/application/booking-schedule-directory";
import {
  asUuid,
  badId
} from "../../../../../modules/booking/application/booking-route-support";
import { BOOKING_GUARDS } from "../../../../../modules/booking/domain/booking-permissions";

/**
 * `DELETE /api/v1/booking/schedule-exceptions/{id}` -- delete one exception
 * (configuration with no history value; the deletion is audited). Gated by
 * `booking.schedules.delete`.
 */
export const DELETE = defineTenantRoute<{ id: string }>({
  workClass: "interactive",
  prepare: ({ params }) => {
    const id = asUuid(params.id);

    return id ? { id } : badId();
  },
  authorize: BOOKING_GUARDS.schedules.delete,
  handler: async ({ tx, tenantId, auth, prepared, locals }) =>
    (await deleteException(
      tx,
      tenantId,
      {
        actorTenantUserId: auth.context.tenantUserId,
        correlationId: locals.correlationId
      },
      prepared.id
    ))
      ? ok({ id: prepared.id, deleted: true })
      : fail(404, "RESOURCE_NOT_FOUND", "Schedule exception not found.")
});
