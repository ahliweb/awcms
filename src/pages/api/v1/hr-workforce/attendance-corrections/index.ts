import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { authorizeInTransaction } from "../../../../../modules/identity-access/application/access-guard";
import {
  createCorrection,
  employmentIsCallers,
  employmentWithinBasis,
  listCorrections,
  parseAttendanceCursor,
  type ReadBasis
} from "../../../../../modules/hr-workforce/application/hr-attendance-directory";
import {
  asUuid,
  badId,
  readIdempotencyKey,
  readValidatedBody,
  runIdempotent
} from "../../../../../modules/hr-workforce/application/hr-workforce-route-support";
import { recordSensitiveRead } from "../../../../../modules/logging/application/sensitive-read-audit";
import { HR_WORKFORCE_GUARDS } from "../../../../../modules/hr-workforce/domain/hr-workforce-permissions";
import {
  isCorrectionStatus,
  type CorrectionStatus
} from "../../../../../modules/hr-workforce/domain/hr-attendance-types";
import {
  validateCreateCorrection,
  type CreateCorrectionInput
} from "../../../../../modules/hr-workforce/domain/hr-attendance-validation";

type ListPrepared = {
  employmentId?: string;
  status?: CorrectionStatus;
  mine: boolean;
  reports: boolean;
  cursor: ReturnType<typeof parseAttendanceCursor>;
};

/**
 * `GET /api/v1/hr-workforce/attendance-corrections` — corrections, newest first,
 * keyset paginated, optionally for one employment and one status. The same three
 * bases as the events list: `?mine=true` (your own employment's), `?reports=true`
 * (your reports', through the manager chain), or neither with
 * `hr_workforce.corrections.read`. The LIST never carries the reason: it is
 * sensitive and is returned only by the single-correction read, to those allowed
 * to see it.
 */
export const GET = defineTenantRoute<ListPrepared>({
  workClass: "interactive",
  prepare: ({ url }) => {
    const employmentId = url.searchParams.get("employmentId");
    const status = url.searchParams.get("status");
    const mine = url.searchParams.get("mine");
    const reports = url.searchParams.get("reports");
    const cursorText = url.searchParams.get("cursor");

    if (employmentId && !asUuid(employmentId)) {
      return badId("employmentId");
    }

    if (status && !isCorrectionStatus(status)) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "status must be pending, approved, rejected or withdrawn."
      );
    }

    for (const [name, value] of [
      ["mine", mine],
      ["reports", reports]
    ] as const) {
      if (value && value !== "true" && value !== "false") {
        return fail(400, "VALIDATION_ERROR", `${name} must be true or false.`);
      }
    }

    if (mine === "true" && reports === "true") {
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
      status: (status as CorrectionStatus | null) ?? undefined,
      mine: mine === "true",
      reports: reports === "true",
      cursor
    };
  },
  ownershipGrant: async ({ prepared }) => ({
    granted: prepared.mine || prepared.reports,
    reason: prepared.mine
      ? "employee lists their own attendance corrections"
      : "supervisor lists their reports' attendance corrections"
  }),
  authorize: HR_WORKFORCE_GUARDS.corrections.read,
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

    const page = await listCorrections(
      tx,
      tenantId,
      basis,
      { employmentId: prepared.employmentId, status: prepared.status },
      prepared.cursor ?? undefined
    );

    // PS-18 / Issue #1083 M-1: the list carries every employee's proposed clock
    // times. Recorded for the permission AND the manager chain (mode); only the
    // employee's own read is not. Employment ids and a count, never a time.
    if (basis.mode !== "mine") {
      await recordSensitiveRead(tx, {
        tenantId,
        actorTenantUserId: tenantUserId,
        permission: "hr_workforce.corrections.read",
        mode: basis.mode,
        itemCount: page.corrections.length,
        resourceIds: [
          ...new Set(page.corrections.map((entry) => entry.employmentId))
        ],
        correlationId: locals.correlationId
      });
    }

    return ok(page);
  }
});

type CreatePrepared = { idempotencyKey: string; input: CreateCorrectionInput };

const SCOPE = "hr_workforce_attendance_correction_create";

/**
 * `POST /api/v1/hr-workforce/attendance-corrections` — request a correction: add
 * a missing event (`kind: add`) or replace one (`kind: replace` + `targetEventId`),
 * with a mandatory `reason`. It never edits the original: on approval a NEW event
 * is appended that supersedes the old one.
 *
 * Needs `hr_workforce.corrections.create`, and the employment must be YOURS unless
 * you also hold `hr_workforce.attendance.create` (a supervisor or HR entering one
 * for somebody else; the requester can never be the approver). Approval is
 * REQUIRED and fail-closed: with no published workflow under the tenant's
 * correction workflow key, 409 `APPROVAL_WORKFLOW_NOT_CONFIGURED` and nothing is
 * created. A `proposedOccurredAt` further in the future than the tenant's
 * clock-skew bound is 422 `ATTENDANCE_TIME_IN_FUTURE` (the event guard would
 * refuse it at approval, stranding the correction). The reason is sensitive: it is never written to an audit row, an event
 * or the workflow store. Idempotent.
 */
export const POST = defineTenantRoute<CreatePrepared>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) {
      return idempotencyKey;
    }

    const input = await readValidatedBody(request, validateCreateCorrection);

    return input instanceof Response ? input : { idempotencyKey, input };
  },
  authorize: HR_WORKFORCE_GUARDS.corrections.create,
  handler: async ({ tx, tenantId, auth, prepared, locals, tokenHash, now }) => {
    const { input } = prepared;
    const tenantUserId = auth.context.tenantUserId;

    if (
      !(await employmentIsCallers(
        tx,
        tenantId,
        input.employmentId,
        tenantUserId
      ))
    ) {
      // Somebody else's (or no such) employment: only a holder of the
      // record-for-others power may propose a correction for it.
      const others = await authorizeInTransaction(
        tx,
        tenantId,
        tokenHash,
        now,
        HR_WORKFORCE_GUARDS.attendance.create
      );

      if (!others.allowed) {
        return fail(
          403,
          "ACCESS_DENIED",
          "A correction can be requested only for your own employment."
        );
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
        proposedOccurredAt: input.proposedOccurredAt.toISOString()
      },
      async () => {
        const result = await createCorrection(
          tx,
          tenantId,
          {
            actorTenantUserId: tenantUserId,
            correlationId: locals.correlationId
          },
          input,
          now
        );

        switch (result.outcome) {
          case "ok":
            return { status: 201, body: result.correction };
          case "employment_not_found":
            return fail(
              422,
              "EMPLOYMENT_NOT_FOUND",
              "employmentId does not name a live employment in this tenant."
            );
          case "proposed_in_future":
            return fail(
              422,
              "ATTENDANCE_TIME_IN_FUTURE",
              "proposedOccurredAt is further in the future than the tenant's clock-skew bound allows; approval could never record it."
            );
          case "target_not_found":
            return fail(
              422,
              "TARGET_EVENT_NOT_FOUND",
              "targetEventId does not name an event of that employment."
            );
          case "target_superseded":
            return fail(
              409,
              "TARGET_EVENT_SUPERSEDED",
              "That event was already replaced by an approved correction."
            );
          case "target_already_pending":
            return fail(
              409,
              "CORRECTION_ALREADY_PENDING",
              "A correction for that event is already awaiting a decision."
            );
          case "approval_workflow_not_configured":
            return fail(
              409,
              "APPROVAL_WORKFLOW_NOT_CONFIGURED",
              "Attendance corrections need approval, but no active workflow is published under the tenant's correction workflow key (or the workflow module is off). Nothing was created."
            );
          case "approval_facts_invalid":
            return fail(
              409,
              "APPROVAL_WORKFLOW_MISCONFIGURED",
              "The correction workflow declares facts attendance does not supply; attendance supplies none.",
              {},
              result.errors
            );
        }
      }
    );
  }
});
