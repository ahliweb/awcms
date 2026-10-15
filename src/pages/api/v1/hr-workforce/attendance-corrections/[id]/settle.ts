import { fail } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { authorizeInTransaction } from "../../../../../../modules/identity-access/application/access-guard";
import {
  correctionAccessFacts,
  settleCorrection
} from "../../../../../../modules/hr-workforce/application/hr-attendance-directory";
import {
  asUuid,
  badId,
  readIdempotencyKey,
  readValidatedBody,
  runIdempotent
} from "../../../../../../modules/hr-workforce/application/hr-workforce-route-support";
import { HR_WORKFORCE_GUARDS } from "../../../../../../modules/hr-workforce/domain/hr-workforce-permissions";
import { validateEmptyBody } from "../../../../../../modules/hr-workforce/domain/hr-workforce-validation";

type Prepared = { id: string; idempotencyKey: string };

const SCOPE = "hr_workforce_attendance_correction_settle";

/**
 * `POST /api/v1/hr-workforce/attendance-corrections/{id}/settle` — apply the
 * approval workflow's VERDICT to a pending correction. The decision itself is
 * made in `workflow_approval`; this only materialises it:
 *
 *   * instance still pending  -> 409 `CORRECTION_STILL_PENDING`;
 *   * approved                -> the correction becomes `approved` and a NEW event
 *                                superseding the old one is appended (the original
 *                                is never edited);
 *   * rejected / cancelled    -> `rejected` / `withdrawn`.
 *
 * Normally the settlement is AUTOMATIC: a domain-event consumer
 * (`hr_workforce.attendance_correction_settler`) applies the verdict as soon as
 * the workflow instance finishes. This route is the manual fallback (a consumer
 * that is behind, or a verdict it declined to apply).
 *
 * Segregation of duties: the requester cannot settle their own APPROVED
 * correction (a rejected or cancelled one they may close themselves: nothing is
 * applied), an approved instance with no human approving decision is refused, and so is one the
 * requester OR THE EMPLOYEE THE CORRECTION IS ABOUT approved directly or as the
 * delegator whose standing a delegate used, or one that employee settles (409
 * `CORRECTION_SELF_APPROVED`; the employee is the login linked when it was
 * requested and the one linked now); the database repeats each check. High-risk,
 * audited without the reason, idempotent.
 */
export const POST = defineTenantRoute<Prepared>({
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

    const body = await readValidatedBody(request, validateEmptyBody);

    return body instanceof Response ? body : { id, idempotencyKey };
  },
  authorize: HR_WORKFORCE_GUARDS.corrections.approve,
  handler: async ({ tx, tenantId, auth, prepared, locals, tokenHash, now }) => {
    const tenantUserId = auth.context.tenantUserId;
    const facts = await correctionAccessFacts(
      tx,
      tenantId,
      prepared.id,
      tenantUserId
    );

    if (!facts) {
      return fail(
        404,
        "RESOURCE_NOT_FOUND",
        "Attendance correction not found."
      );
    }

    // The self-approval guard of the chokepoint, now that the requester is
    // known: a caller may never approve a request they filed themselves. It
    // guards APPROVING, so it is skipped for a verdict that approves nothing: a
    // `rejected` or `cancelled` instance only moves the correction to
    // `rejected` / `withdrawn` (nothing is applied), and the requester must be
    // able to close their own refused request (#998). Those verdicts are
    // terminal, so the status read here cannot change before the handler runs.
    // `pending` and `approved` keep the guard.
    const settlesWithoutApproving =
      facts.instanceStatus === "rejected" ||
      facts.instanceStatus === "cancelled";

    if (!settlesWithoutApproving) {
      const guarded = await authorizeInTransaction(
        tx,
        tenantId,
        tokenHash,
        now,
        {
          ...HR_WORKFORCE_GUARDS.corrections.approve,
          resourceType: "hr_attendance_correction",
          resourceId: prepared.id,
          resourceAttributes: { requestedByTenantUserId: facts.requestedBy }
        }
      );

      if (!guarded.allowed) {
        return guarded.denied;
      }
    }

    return runIdempotent(
      tx,
      tenantId,
      SCOPE,
      prepared.idempotencyKey,
      tenantUserId,
      { id: prepared.id },
      async () => {
        const result = await settleCorrection(
          tx,
          tenantId,
          prepared.id,
          {
            actorTenantUserId: tenantUserId,
            correlationId: locals.correlationId
          },
          now
        );

        switch (result.outcome) {
          case "ok":
            return { status: 200, body: result.correction };
          case "not_found":
            return fail(
              404,
              "RESOURCE_NOT_FOUND",
              "Attendance correction not found."
            );
          case "not_pending":
            return fail(
              409,
              "CORRECTION_NOT_PENDING",
              `The correction is already ${result.status}.`
            );
          case "still_pending":
            return fail(
              409,
              "CORRECTION_STILL_PENDING",
              "The approval workflow has not decided yet."
            );
          case "no_approver":
            return fail(
              409,
              "CORRECTION_NO_APPROVER",
              "The workflow finished without a human approving decision; the correction cannot be approved. Check the correction workflow's graph."
            );
          case "self_approved":
            return fail(
              409,
              "CORRECTION_SELF_APPROVED",
              "The requester, or the employee the correction is about, took part in approving or settling it, directly or as a delegator; it cannot be applied."
            );
          case "target_superseded":
            return fail(
              409,
              "TARGET_EVENT_SUPERSEDED",
              "The event this correction replaces was already replaced."
            );
          case "apply_refused":
            return fail(
              409,
              "CORRECTION_NOT_APPLICABLE",
              `The approved correction cannot be applied now (${result.reason}).`
            );
        }
      }
    );
  }
});
