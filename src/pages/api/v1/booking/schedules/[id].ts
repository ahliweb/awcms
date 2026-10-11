import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  getSchedule,
  patchSchedule,
  type PatchScheduleResult
} from "../../../../../modules/booking/application/booking-schedule-directory";
import {
  asUuid,
  badId,
  readValidatedBody
} from "../../../../../modules/booking/application/booking-route-support";
import { BOOKING_GUARDS } from "../../../../../modules/booking/domain/booking-permissions";
import {
  validateSchedulePatch,
  type SchedulePatchInput
} from "../../../../../modules/booking/domain/booking-validation";

function respond(result: PatchScheduleResult): Response {
  switch (result.outcome) {
    case "ok":
      return ok(result.schedule);
    case "not_found":
      return fail(404, "RESOURCE_NOT_FOUND", "Schedule not found.");
    case "not_editable":
      return fail(409, "SCHEDULE_NOT_EDITABLE", result.message);
  }
}

/** `GET /api/v1/booking/schedules/{id}` -- one schedule. Gated by `booking.schedules.read`. */
export const GET = defineTenantRoute<{ id: string }>({
  workClass: "interactive",
  prepare: ({ params }) => {
    const id = asUuid(params.id);

    return id ? { id } : badId();
  },
  authorize: BOOKING_GUARDS.schedules.read,
  handler: async ({ tx, tenantId, prepared }) => {
    const schedule = await getSchedule(tx, tenantId, prepared.id);

    return schedule
      ? ok(schedule)
      : fail(404, "RESOURCE_NOT_FOUND", "Schedule not found.");
  }
});

/**
 * `PATCH /api/v1/booking/schedules/{id}` -- shorten `effectiveTo` (a window is
 * superseded, not edited, so it can never be lengthened or reopened). Gated by
 * `booking.schedules.update`; audited.
 */
export const PATCH = defineTenantRoute<{
  id: string;
  patch: SchedulePatchInput;
}>({
  workClass: "interactive",
  prepare: async ({ request, params }) => {
    const id = asUuid(params.id);

    if (!id) {
      return badId();
    }

    const patch = await readValidatedBody(request, validateSchedulePatch);

    return patch instanceof Response ? patch : { id, patch };
  },
  authorize: BOOKING_GUARDS.schedules.update,
  handler: async ({ tx, tenantId, auth, prepared, locals }) =>
    respond(
      await patchSchedule(
        tx,
        tenantId,
        {
          actorTenantUserId: auth.context.tenantUserId,
          correlationId: locals.correlationId
        },
        prepared.id,
        prepared.patch
      )
    )
});

/**
 * `DELETE /api/v1/booking/schedules/{id}` -- DEACTIVATE the schedule (it is never
 * removed; confirmed reservations do not depend on it). Gated by
 * `booking.schedules.delete`; audited.
 */
export const DELETE = defineTenantRoute<{ id: string }>({
  workClass: "interactive",
  prepare: ({ params }) => {
    const id = asUuid(params.id);

    return id ? { id } : badId();
  },
  authorize: BOOKING_GUARDS.schedules.delete,
  handler: async ({ tx, tenantId, auth, prepared, locals }) =>
    respond(
      await patchSchedule(
        tx,
        tenantId,
        {
          actorTenantUserId: auth.context.tenantUserId,
          correlationId: locals.correlationId
        },
        prepared.id,
        { status: "inactive" }
      )
    )
});
