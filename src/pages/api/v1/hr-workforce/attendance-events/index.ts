import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { authorizeInTransaction } from "../../../../../modules/identity-access/application/access-guard";
import {
  employmentIsCallers,
  employmentWithinBasis,
  listEvents,
  parseAttendanceCursor,
  recordEvent,
  type ReadBasis
} from "../../../../../modules/hr-workforce/application/hr-attendance-directory";
import { recordSensitiveRead } from "../../../../../modules/logging/application/sensitive-read-audit";
import {
  captureLocationEvidence,
  readEvidenceVerdict
} from "../../../../../modules/hr-workforce/application/hr-location-evidence";
import {
  asUuid,
  badId,
  readIdempotencyKey,
  readValidatedBody,
  runIdempotent
} from "../../../../../modules/hr-workforce/application/hr-workforce-route-support";
import { HR_WORKFORCE_GUARDS } from "../../../../../modules/hr-workforce/domain/hr-workforce-permissions";
import {
  parseAttendanceInstant,
  validateCreateAttendanceEvent,
  type CreateAttendanceEventInput
} from "../../../../../modules/hr-workforce/domain/hr-attendance-validation";

type ListPrepared = {
  employmentId?: string;
  from?: Date;
  to?: Date;
  effectiveOnly: boolean;
  mine: boolean;
  reports: boolean;
  cursor: ReturnType<typeof parseAttendanceCursor>;
};

function flag(url: URL, name: string): boolean | Response {
  const value = url.searchParams.get(name);

  if (value && value !== "true" && value !== "false") {
    return fail(400, "VALIDATION_ERROR", `${name} must be true or false.`);
  }

  return value === "true";
}

/**
 * `GET /api/v1/hr-workforce/attendance-events` — attendance events, newest
 * claimed instant first, keyset paginated (`?cursor=`), optionally for one
 * employment (`employmentId`), a window on the claimed instant (`from`
 * inclusive, `to` exclusive) and only the EFFECTIVE record (`effective=true`
 * hides an event a later approved correction replaced).
 *
 * Three ways in, never combined:
 *   * `?mine=true`    — your OWN events; needs no permission beyond being linked
 *                       to an employment (an ownership grant, ADR-0063);
 *   * `?reports=true` — the events of the people who report to you (directly or
 *                       through the manager chain, ten levels at most; a
 *                       soft-deleted employment breaks the chain); the same grant;
 *   * neither         — every employee's events, and needs
 *                       `hr_workforce.attendance.read`.
 * An `employmentId` outside the chosen basis is 403, the same as an absent one.
 */
export const GET = defineTenantRoute<ListPrepared>({
  workClass: "interactive",
  prepare: ({ url }) => {
    const employmentId = url.searchParams.get("employmentId");
    const fromText = url.searchParams.get("from");
    const toText = url.searchParams.get("to");
    const cursorText = url.searchParams.get("cursor");

    if (employmentId && !asUuid(employmentId)) {
      return badId("employmentId");
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

    const mine = flag(url, "mine");
    const reports = flag(url, "reports");
    const effective = flag(url, "effective");

    for (const parsed of [mine, reports, effective]) {
      if (parsed instanceof Response) {
        return parsed;
      }
    }

    if (mine === true && reports === true) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "mine and reports cannot be combined."
      );
    }

    const cursor = cursorText ? parseAttendanceCursor(cursorText) : null;

    if (cursorText && !cursor) {
      return fail(400, "VALIDATION_ERROR", "cursor is not valid.");
    }

    return {
      employmentId: employmentId ? asUuid(employmentId)! : undefined,
      from: from ?? undefined,
      to: to ?? undefined,
      effectiveOnly: effective === true,
      mine: mine === true,
      reports: reports === true,
      cursor
    };
  },
  ownershipGrant: async ({ prepared }) => ({
    granted: prepared.mine || prepared.reports,
    reason: prepared.mine
      ? "employee lists their own attendance"
      : "supervisor lists their reports' attendance"
  }),
  authorize: HR_WORKFORCE_GUARDS.attendance.read,
  handler: async ({ tx, tenantId, prepared, auth, locals }) => {
    const tenantUserId = auth.context.tenantUserId;
    const basis: ReadBasis = prepared.mine
      ? { mode: "mine", tenantUserId }
      : prepared.reports
        ? { mode: "reports", tenantUserId }
        : { mode: "all" };

    if (
      prepared.employmentId &&
      !(await employmentWithinBasis(tx, tenantId, prepared.employmentId, basis))
    ) {
      return fail(
        403,
        "ACCESS_DENIED",
        "That employment is outside what you may read."
      );
    }

    const page = await listEvents(
      tx,
      tenantId,
      basis,
      {
        employmentId: prepared.employmentId,
        from: prepared.from,
        to: prepared.to,
        effectiveOnly: prepared.effectiveOnly
      },
      prepared.cursor ?? undefined
    );

    // PS-18 / Issue #1083: an all-employee read of clock-in and clock-out times
    // is recorded (employment ids and a count only, coalesced), whether it
    // came from the permission or from the manager chain (mode "reports", up to
    // ten levels: Issue #1083 M-2). Only the employee's own read is not.
    if (basis.mode !== "mine") {
      await recordSensitiveRead(tx, {
        mode: basis.mode,
        tenantId,
        actorTenantUserId: tenantUserId,
        permission: "hr_workforce.attendance.read",
        itemCount: page.events.length,
        resourceIds: [
          ...new Set(page.events.map((event) => event.employmentId))
        ],
        correlationId: locals.correlationId
      });
    }

    return ok(page);
  }
});

type CreatePrepared = {
  idempotencyKey: string;
  input: CreateAttendanceEventInput;
};

const SCOPE = "hr_workforce_attendance_event_create";

/**
 * `POST /api/v1/hr-workforce/attendance-events` — record one attendance event.
 *
 * `source: "self"` records YOUR OWN event and needs `hr_workforce.clock.create`
 * plus an employment linked to your login (anything else is 403, whether the
 * employment exists or not). Any other source (`supervisor`, `kiosk`, `import`)
 * records for another employment and needs `hr_workforce.attendance.create`.
 *
 * The server clock decides `recordedAt`; `occurredAt` is bounded by the tenant's
 * clock-skew setting: in the future -> 422 `ATTENDANCE_TIME_IN_FUTURE`; for
 * `self`/`supervisor`, older than the skew -> 422 `ATTENDANCE_BACKDATED` (request
 * a correction); a `kiosk`/`import` replay is accepted up to seven days old and
 * flagged `late` past fifteen minutes. A replay of the same `clientEventKey`
 * returns the ORIGINAL with 200 (a different event under a used key is 409).
 * There is no location, photo or device field on the event, and none is stored.
 * The one optional body field is `positionSample` (Issue #970, ADR-0138): only a
 * `self` clock_in / clock_out may carry it (anything else is 400), the server
 * evaluates it in the request against the office's geofences and DISCARDS it,
 * and `locationVerdict` in the response is `inside` / `outside` / `not_provided`
 * - or null while the tenant's switch is off (the default), when the sample is
 * ignored. It never blocks clocking. Idempotent; audited when recorded
 * for somebody else (every `supervisor` event, a `kiosk`/`import` one flagged
 * `late`; `self` and punctual taps are not: high
 * volume: the event is the record).
 */
export const POST = defineTenantRoute<CreatePrepared>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) {
      return idempotencyKey;
    }

    const input = await readValidatedBody(
      request,
      validateCreateAttendanceEvent
    );

    return input instanceof Response ? input : { idempotencyKey, input };
  },
  authorize: [
    HR_WORKFORCE_GUARDS.clock.create,
    HR_WORKFORCE_GUARDS.attendance.create
  ],
  handler: async ({ tx, tenantId, auth, prepared, locals, tokenHash, now }) => {
    const { input } = prepared;
    const tenantUserId = auth.context.tenantUserId;

    // The route guard let either permission through; the SOURCE decides which
    // one this request actually needed, and the chokepoint is asked again.
    if (input.source === "self") {
      const clock = await authorizeInTransaction(
        tx,
        tenantId,
        tokenHash,
        now,
        HR_WORKFORCE_GUARDS.clock.create
      );

      if (!clock.allowed) {
        return clock.denied;
      }

      if (
        !(await employmentIsCallers(
          tx,
          tenantId,
          input.employmentId,
          tenantUserId
        ))
      ) {
        return fail(
          403,
          "ACCESS_DENIED",
          "Attendance can be recorded as self only for your own employment."
        );
      }
    } else {
      const create = await authorizeInTransaction(
        tx,
        tenantId,
        tokenHash,
        now,
        HR_WORKFORCE_GUARDS.attendance.create
      );

      if (!create.allowed) {
        return create.denied;
      }
    }

    return runIdempotent(
      tx,
      tenantId,
      SCOPE,
      prepared.idempotencyKey,
      tenantUserId,
      {
        ...input,
        occurredAt: input.occurredAt.toISOString(),
        // ADR-0138: a position sample is personal data. The request hash is
        // stored with the idempotency record, and a hash of a coordinate is a
        // value a guess can be checked against, so only its PRESENCE is hashed.
        positionSample: input.positionSample === null ? null : "present"
      },
      async () => {
        const result = await recordEvent(
          tx,
          tenantId,
          {
            actorTenantUserId: tenantUserId,
            correlationId: locals.correlationId
          },
          input
        );

        switch (result.outcome) {
          case "ok": {
            // A replay is never re-evaluated. The sample is evaluated by the
            // server here and dropped; only a verdict is kept (ADR-0138).
            const evidence = result.replayed
              ? await readEvidenceVerdict(tx, tenantId, result.event.id)
              : await captureLocationEvidence(
                  tx,
                  tenantId,
                  result.event,
                  input.positionSample
                );

            return {
              status: result.replayed ? 200 : 201,
              body: {
                ...result.event,
                locationVerdict: evidence ? evidence.verdict : null
              }
            };
          }
          case "employment_not_found":
            return fail(
              422,
              "EMPLOYMENT_NOT_FOUND",
              "employmentId does not name a live employment in this tenant."
            );
          case "office_not_found":
            return fail(422, "OFFICE_NOT_FOUND", "Office not found.");
          case "key_conflict":
            return fail(
              409,
              "CLIENT_EVENT_KEY_CONFLICT",
              "clientEventKey was already used for a different event of this employment."
            );
          case "refused":
            switch (result.reason) {
              case "future":
                return fail(
                  422,
                  "ATTENDANCE_TIME_IN_FUTURE",
                  "occurredAt is further in the future than the tenant's clock-skew bound allows."
                );
              case "backdated":
                return fail(
                  422,
                  "ATTENDANCE_BACKDATED",
                  "A self or supervisor event cannot claim a time older than the clock-skew bound; request a correction instead."
                );
              case "too_old":
                return fail(
                  422,
                  "ATTENDANCE_TOO_OLD",
                  "A kiosk or import event cannot claim a time more than seven days old; request a correction instead."
                );
              case "employment_terminated":
                return fail(
                  409,
                  "EMPLOYMENT_TERMINATED",
                  "The employment is terminated; only an approved correction may touch its history."
                );
              case "target_superseded":
                // Only an approved correction supersedes; a recording request
                // never reaches that rule.
                return fail(
                  409,
                  "TARGET_EVENT_SUPERSEDED",
                  "That event was already replaced."
                );
              case "employment_deleted":
                return fail(
                  422,
                  "EMPLOYMENT_NOT_FOUND",
                  "employmentId does not name a live employment in this tenant."
                );
            }
        }
      }
    );
  }
});
