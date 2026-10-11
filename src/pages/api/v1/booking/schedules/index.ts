import { created, fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  createSchedule,
  listSchedules,
  parseScheduleCursor
} from "../../../../../modules/booking/application/booking-schedule-directory";
import {
  asUuid,
  badId,
  readValidatedBody
} from "../../../../../modules/booking/application/booking-route-support";
import { BOOKING_GUARDS } from "../../../../../modules/booking/domain/booking-permissions";
import type { ScheduleInput } from "../../../../../modules/booking/domain/booking-schedule";
import { validateCreateSchedule } from "../../../../../modules/booking/domain/booking-validation";

type ListPrepared = {
  resourceId?: string;
  activeOnly: boolean;
  cursor: ReturnType<typeof parseScheduleCursor>;
};

/**
 * `GET /api/v1/booking/schedules` -- this tenant's schedules, newest first,
 * keyset paginated (`cursor`). `resourceId` narrows to one resource's schedules;
 * `activeOnly=true` hides deactivated windows. Gated by `booking.schedules.read`.
 */
export const GET = defineTenantRoute<ListPrepared>({
  workClass: "interactive",
  prepare: ({ url }) => {
    const resourceId = url.searchParams.get("resourceId");
    const activeOnly = url.searchParams.get("activeOnly");
    const cursorText = url.searchParams.get("cursor");

    if (resourceId && !asUuid(resourceId)) {
      return badId("resourceId");
    }

    if (activeOnly && activeOnly !== "true" && activeOnly !== "false") {
      return fail(400, "VALIDATION_ERROR", "activeOnly must be true or false.");
    }

    const cursor = cursorText ? parseScheduleCursor(cursorText) : null;

    if (cursorText && !cursor) {
      return fail(400, "VALIDATION_ERROR", "cursor is not valid.");
    }

    return {
      resourceId: resourceId ? asUuid(resourceId)! : undefined,
      activeOnly: activeOnly === "true",
      cursor
    };
  },
  authorize: BOOKING_GUARDS.schedules.read,
  handler: async ({ tx, tenantId, prepared }) =>
    ok(
      await listSchedules(
        tx,
        tenantId,
        { resourceId: prepared.resourceId, activeOnly: prepared.activeOnly },
        prepared.cursor ?? undefined
      )
    )
});

/**
 * `POST /api/v1/booking/schedules` -- create a schedule window (weekly local
 * windows in an IANA zone). A new window SUPERSEDES rather than edits: it
 * conflicts (409) with an active window of the same scope that overlaps it. A
 * schedule bound to a resource is in that resource's zone. Changes future
 * availability only; no reservation is touched. Gated by
 * `booking.schedules.create`; audited.
 */
export const POST = defineTenantRoute<ScheduleInput>({
  workClass: "interactive",
  prepare: async ({ request }) =>
    readValidatedBody(request, validateCreateSchedule),
  authorize: BOOKING_GUARDS.schedules.create,
  handler: async ({ tx, tenantId, auth, prepared, locals }) => {
    const result = await createSchedule(
      tx,
      tenantId,
      {
        actorTenantUserId: auth.context.tenantUserId,
        correlationId: locals.correlationId
      },
      prepared
    );

    switch (result.outcome) {
      case "ok":
        return created(result.schedule);
      case "resource_not_found":
        return fail(404, "RESOURCE_NOT_FOUND", "Resource not found.");
      case "overlap":
        return fail(
          409,
          "SCHEDULE_OVERLAP",
          "An active schedule of the same scope already covers part of this window; shorten or deactivate it first."
        );
      case "timezone_mismatch":
        return fail(
          409,
          "SCHEDULE_TIMEZONE_MISMATCH",
          "A schedule bound to a resource is written in that resource's time zone."
        );
      case "timezone_invalid":
        return fail(
          400,
          "TIMEZONE_INVALID",
          "timezone is not a known IANA zone name."
        );
    }
  }
});
