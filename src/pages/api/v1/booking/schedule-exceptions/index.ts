import { created, fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  createException,
  listExceptions,
  parseScheduleCursor
} from "../../../../../modules/booking/application/booking-schedule-directory";
import {
  asUuid,
  badId,
  readValidatedBody
} from "../../../../../modules/booking/application/booking-route-support";
import { BOOKING_GUARDS } from "../../../../../modules/booking/domain/booking-permissions";
import type { ExceptionInput } from "../../../../../modules/booking/domain/booking-schedule";
import { validateCreateException } from "../../../../../modules/booking/domain/booking-validation";

type ListPrepared = {
  scheduleId?: string;
  resourceId?: string;
  cursor: ReturnType<typeof parseScheduleCursor>;
};

/**
 * `GET /api/v1/booking/schedule-exceptions` -- closures and override hours,
 * newest first, keyset paginated. `scheduleId` / `resourceId` narrow it. Gated
 * by `booking.schedules.read`.
 */
export const GET = defineTenantRoute<ListPrepared>({
  workClass: "interactive",
  prepare: ({ url }) => {
    const scheduleId = url.searchParams.get("scheduleId");
    const resourceId = url.searchParams.get("resourceId");
    const cursorText = url.searchParams.get("cursor");

    if (scheduleId && !asUuid(scheduleId)) {
      return badId("scheduleId");
    }

    if (resourceId && !asUuid(resourceId)) {
      return badId("resourceId");
    }

    const cursor = cursorText ? parseScheduleCursor(cursorText) : null;

    if (cursorText && !cursor) {
      return fail(400, "VALIDATION_ERROR", "cursor is not valid.");
    }

    return {
      scheduleId: scheduleId ? asUuid(scheduleId)! : undefined,
      resourceId: resourceId ? asUuid(resourceId)! : undefined,
      cursor
    };
  },
  authorize: BOOKING_GUARDS.schedules.read,
  handler: async ({ tx, tenantId, prepared }) =>
    ok(
      await listExceptions(
        tx,
        tenantId,
        { scheduleId: prepared.scheduleId, resourceId: prepared.resourceId },
        prepared.cursor ?? undefined
      )
    )
});

/**
 * `POST /api/v1/booking/schedule-exceptions` -- a closure (`closed`) or
 * replacement hours (`override_hours`) over a half-open range of LOCAL dates in
 * the schedule's zone, owned by a schedule or a resource. The reason is a short
 * code, never free text. A closure changes future availability only and never
 * touches an existing reservation. Gated by `booking.schedules.create`; audited.
 */
export const POST = defineTenantRoute<ExceptionInput>({
  workClass: "interactive",
  prepare: async ({ request }) =>
    readValidatedBody(request, validateCreateException),
  authorize: BOOKING_GUARDS.schedules.create,
  handler: async ({ tx, tenantId, auth, prepared, locals }) => {
    const result = await createException(
      tx,
      tenantId,
      {
        actorTenantUserId: auth.context.tenantUserId,
        correlationId: locals.correlationId
      },
      prepared
    );

    if (result.outcome === "duplicate") {
      return fail(
        409,
        "EXCEPTION_DUPLICATE",
        "An identical exception already exists for this owner, kind and range."
      );
    }

    return result.outcome === "ok"
      ? created(result.exception)
      : fail(404, "RESOURCE_NOT_FOUND", "Schedule or resource not found.");
  }
});
