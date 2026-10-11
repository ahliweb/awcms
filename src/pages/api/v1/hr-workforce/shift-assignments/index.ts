import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { authorizeInTransaction } from "../../../../../modules/identity-access/application/access-guard";
import {
  createAssignment,
  listAssignments,
  parseShiftCursor
} from "../../../../../modules/hr-workforce/application/hr-shift-directory";
import {
  asUuid,
  badId,
  readIdempotencyKey,
  readValidatedBody,
  runIdempotent
} from "../../../../../modules/hr-workforce/application/hr-workforce-route-support";
import { HR_WORKFORCE_GUARDS } from "../../../../../modules/hr-workforce/domain/hr-workforce-permissions";
import {
  parseInstant,
  validateCreateAssignment,
  type CreateAssignmentInput
} from "../../../../../modules/hr-workforce/domain/hr-shift-validation";
import {
  isShiftStatus,
  type ShiftStatus
} from "../../../../../modules/hr-workforce/domain/hr-shift-types";

type ListPrepared = {
  employmentId?: string;
  from?: Date;
  to?: Date;
  status?: ShiftStatus;
  mine: boolean;
  cursor: ReturnType<typeof parseShiftCursor>;
};

/**
 * `GET /api/v1/hr-workforce/shift-assignments` — assignments, oldest start
 * first, keyset paginated (`?cursor=`), optionally for one employment
 * (`employmentId`) and a window (`from` inclusive, `to` exclusive, whole-minute
 * UTC instants) — an assignment is listed when it overlaps the window.
 *
 * `?mine=true` answers the caller's OWN PUBLISHED schedule and needs no
 * permission beyond being linked to an employment (an ownership grant,
 * ADR-0063); drafts and cancelled rows are never shown that way. Without it the
 * route needs `hr_workforce.shifts.read`, and drafts are visible.
 */
export const GET = defineTenantRoute<ListPrepared>({
  workClass: "interactive",
  prepare: ({ url }) => {
    const employmentId = url.searchParams.get("employmentId");
    const fromText = url.searchParams.get("from");
    const toText = url.searchParams.get("to");
    const status = url.searchParams.get("status");
    const mine = url.searchParams.get("mine");
    const cursorText = url.searchParams.get("cursor");

    if (employmentId && !asUuid(employmentId)) {
      return badId("employmentId");
    }

    const from = fromText ? parseInstant(fromText) : null;
    const to = toText ? parseInstant(toText) : null;

    for (const [name, text, value] of [
      ["from", fromText, from],
      ["to", toText, to]
    ] as const) {
      if (text && !value) {
        return fail(
          400,
          "VALIDATION_ERROR",
          `${name} must be a whole-minute UTC instant ending in Z.`
        );
      }
    }

    if (from && to && to <= from) {
      return fail(400, "VALIDATION_ERROR", "to must be after from.");
    }

    if (status && !isShiftStatus(status)) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "status must be draft, published or cancelled."
      );
    }

    if (mine && mine !== "true" && mine !== "false") {
      return fail(400, "VALIDATION_ERROR", "mine must be true or false.");
    }

    const cursor = cursorText ? parseShiftCursor(cursorText) : null;

    if (cursorText && !cursor) {
      return fail(400, "VALIDATION_ERROR", "cursor is not valid.");
    }

    return {
      employmentId: employmentId ? asUuid(employmentId)! : undefined,
      from: from ?? undefined,
      to: to ?? undefined,
      status: (status as ShiftStatus | null) ?? undefined,
      mine: mine === "true",
      cursor
    };
  },
  ownershipGrant: async ({ prepared }) => ({
    granted: prepared.mine,
    reason: "employee lists their own published schedule"
  }),
  authorize: HR_WORKFORCE_GUARDS.shifts.read,
  handler: async ({ tx, tenantId, prepared, auth }) =>
    ok(
      await listAssignments(
        tx,
        tenantId,
        {
          employmentId: prepared.employmentId,
          from: prepared.from,
          to: prepared.to,
          status: prepared.status,
          publishedOnly: prepared.mine,
          ownedByTenantUserId: prepared.mine
            ? auth.context.tenantUserId
            : undefined
        },
        prepared.cursor ?? undefined
      )
    )
});

type CreatePrepared = { idempotencyKey: string; input: CreateAssignmentInput };

const SCOPE = "hr_workforce_shift_assignment_create";

/**
 * `POST /api/v1/hr-workforce/shift-assignments` — draft a work shift or a period
 * of time off for an employment. Send either `templateId` + `localDate` (the
 * wall clock is resolved to UTC ONCE, here, in the template's zone) or the
 * explicit `startsAt`/`endsAt` UTC interval with its `timeZone`. A draft is
 * invisible to scheduling consumers until published, but it already counts for
 * the overlap rule: an employment cannot have two non-cancelled assignments that
 * overlap, across kinds (409 `SHIFT_CONFLICT`, naming the other assignment).
 * Time off carries a coarse `timeOffKind` and never a reason.
 */
export const POST = defineTenantRoute<CreatePrepared>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) {
      return idempotencyKey;
    }

    const input = await readValidatedBody(request, validateCreateAssignment);

    return input instanceof Response ? input : { idempotencyKey, input };
  },
  authorize: HR_WORKFORCE_GUARDS.shifts.create,
  handler: async ({ tx, tenantId, auth, prepared, locals, tokenHash, now }) =>
    runIdempotent(
      tx,
      tenantId,
      SCOPE,
      prepared.idempotencyKey,
      auth.context.tenantUserId,
      {
        ...prepared.input,
        // Dates do not survive a plain JSON hash identically across shapes.
        ...(prepared.input.source === "explicit"
          ? {
              startsAt: prepared.input.startsAt.toISOString(),
              endsAt: prepared.input.endsAt.toISOString(),
              breakStartsAt:
                prepared.input.breakStartsAt?.toISOString() ?? null,
              breakEndsAt: prepared.input.breakEndsAt?.toISOString() ?? null
            }
          : {})
      },
      async () => {
        const result = await createAssignment(
          tx,
          tenantId,
          {
            actorTenantUserId: auth.context.tenantUserId,
            correlationId: locals.correlationId
          },
          prepared.input
        );

        switch (result.outcome) {
          case "ok":
            return { status: 201, body: result.assignment };
          case "employment_not_found":
            return fail(
              422,
              "EMPLOYMENT_NOT_FOUND",
              "employmentId does not name a live employment in this tenant."
            );
          case "template_not_found":
            return fail(
              422,
              "TEMPLATE_NOT_FOUND",
              "templateId does not name a live shift template in this tenant."
            );
          case "office_not_found":
            return fail(422, "OFFICE_NOT_FOUND", "Office not found.");
          case "invalid_time_zone":
            return fail(
              422,
              "INVALID_TIME_ZONE",
              "timeZone is not a known IANA zone."
            );
          case "conflict": {
            // The other assignment's id is schedule data about someone else:
            // only a caller who could list it anyway (shifts.read) gets it.
            const canSee = await authorizeInTransaction(
              tx,
              tenantId,
              tokenHash,
              now,
              HR_WORKFORCE_GUARDS.shifts.read
            );

            return fail(
              409,
              "SHIFT_CONFLICT",
              "The employment already has an assignment overlapping this interval.",
              {},
              canSee.allowed
                ? { conflictingAssignmentId: result.conflictingAssignmentId }
                : undefined
            );
          }
        }
      }
    )
});
