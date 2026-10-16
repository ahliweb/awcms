import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  callerEmploymentIds,
  type ReadBasis
} from "../../../../../modules/hr-workforce/application/hr-attendance-directory";
import {
  auditEvidenceRead,
  listEvidence,
  parseEvidenceCursor
} from "../../../../../modules/hr-workforce/application/hr-location-evidence";
import {
  asUuid,
  badId
} from "../../../../../modules/hr-workforce/application/hr-workforce-route-support";
import { HR_WORKFORCE_GUARDS } from "../../../../../modules/hr-workforce/domain/hr-workforce-permissions";
import { parseAttendanceInstant } from "../../../../../modules/hr-workforce/domain/hr-attendance-validation";

type Prepared = {
  employmentId?: string;
  eventId?: string;
  from?: Date;
  to?: Date;
  mine: boolean;
  cursor: ReturnType<typeof parseEvidenceCursor>;
};

/**
 * `GET /api/v1/hr-workforce/geolocation/evidence` — location-evidence VERDICTS
 * (inside / outside / not_provided, two coarse bands, the geofence reference),
 * newest first, keyset paginated. There is no coordinate to return: none exists.
 *
 * Two ways in, never combined:
 *   * `?mine=true` — your OWN verdicts; needs no permission beyond being linked
 *                    to an employment (an ownership grant, ADR-0063);
 *   * neither      — every employee's, and needs
 *                    `hr_workforce.attendance_evidence.read` (held by HR and, by
 *                    assignment, a supervisor; a scheduler, cashier, marketer or
 *                    payroll operator has no path in). Each such read is audited.
 * An `employmentId` outside your own under `mine` is 403. Filters: `employmentId`,
 * `eventId`, `from` / `to` on the evaluation instant. A verdict flags a case for
 * HUMAN review and changes no pay, status or approval by itself. `no-store`.
 */
export const GET = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: ({ url }) => {
    const employmentId = url.searchParams.get("employmentId");
    const eventId = url.searchParams.get("eventId");
    const fromText = url.searchParams.get("from");
    const toText = url.searchParams.get("to");
    const cursorText = url.searchParams.get("cursor");
    const mine = url.searchParams.get("mine");

    if (employmentId && !asUuid(employmentId)) {
      return badId("employmentId");
    }

    if (eventId && !asUuid(eventId)) {
      return badId("eventId");
    }

    if (mine && mine !== "true" && mine !== "false") {
      return fail(400, "VALIDATION_ERROR", "mine must be true or false.");
    }

    const from = fromText ? parseAttendanceInstant(fromText) : null;
    const to = toText ? parseAttendanceInstant(toText) : null;

    for (const [name, text, value] of [
      ["from", fromText, from],
      ["to", toText, to]
    ] as const) {
      if (text && !value) {
        return fail(
          400,
          "VALIDATION_ERROR",
          `${name} must be a UTC instant ending in Z.`
        );
      }
    }

    if (from && to && to <= from) {
      return fail(400, "VALIDATION_ERROR", "to must be after from.");
    }

    const cursor = cursorText ? parseEvidenceCursor(cursorText) : null;

    if (cursorText && !cursor) {
      return fail(400, "VALIDATION_ERROR", "cursor is not valid.");
    }

    return {
      employmentId: employmentId ? asUuid(employmentId)! : undefined,
      eventId: eventId ? asUuid(eventId)! : undefined,
      from: from ?? undefined,
      to: to ?? undefined,
      mine: mine === "true",
      cursor
    };
  },
  ownershipGrant: async ({ prepared }) => ({
    granted: prepared.mine,
    reason: "employee reads their own location-evidence verdicts"
  }),
  authorize: HR_WORKFORCE_GUARDS.attendanceEvidence.read,
  handler: async ({ tx, tenantId, prepared, auth, locals }) => {
    const actor = {
      actorTenantUserId: auth.context.tenantUserId,
      correlationId: locals.correlationId
    };
    const basis: ReadBasis = prepared.mine
      ? { mode: "mine", tenantUserId: auth.context.tenantUserId }
      : { mode: "all" };
    const scope =
      basis.mode === "mine"
        ? await callerEmploymentIds(tx, tenantId, basis.tenantUserId)
        : null;

    if (
      scope !== null &&
      prepared.employmentId &&
      !scope.includes(prepared.employmentId)
    ) {
      return fail(
        403,
        "ACCESS_DENIED",
        "That employment is outside what you may read."
      );
    }

    const page = await listEvidence(
      tx,
      tenantId,
      scope,
      {
        employmentId: prepared.employmentId,
        eventId: prepared.eventId,
        from: prepared.from,
        to: prepared.to
      },
      prepared.cursor ?? undefined
    );

    await auditEvidenceRead(tx, tenantId, actor, basis, {
      employmentId: prepared.employmentId,
      returned: page.evidence.length,
      employmentIds: page.evidence.map((entry) => entry.employmentId)
    });

    return ok(page, {}, { "cache-control": "no-store" });
  }
});
