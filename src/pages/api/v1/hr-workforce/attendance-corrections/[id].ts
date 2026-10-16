import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { authorizeInTransaction } from "../../../../../modules/identity-access/application/access-guard";
import {
  correctionAccessFacts,
  employmentWithinBasis,
  getCorrection
} from "../../../../../modules/hr-workforce/application/hr-attendance-directory";
import {
  asUuid,
  badId
} from "../../../../../modules/hr-workforce/application/hr-workforce-route-support";
import { recordSensitiveRead } from "../../../../../modules/logging/application/sensitive-read-audit";
import { HR_WORKFORCE_GUARDS } from "../../../../../modules/hr-workforce/domain/hr-workforce-permissions";

type IdPrepared = { id: string };

/**
 * `GET /api/v1/hr-workforce/attendance-corrections/{id}` — one correction.
 *
 * Reachable without `hr_workforce.corrections.read` by the REQUESTER, a workflow
 * ASSIGNEE of its approval instance, the employee it is about, and a supervisor
 * above that employee (an ownership grant, ADR-0063). The REASON is sensitive
 * and is included only for the requester, an assignee, or a holder of
 * `corrections.read`; a supervisor reading a report's correction through the
 * manager chain alone sees everything but the reason. A missing id and someone
 * else's correction are both 403 to a caller without the permission.
 */
export const GET = defineTenantRoute<IdPrepared>({
  workClass: "interactive",
  prepare: ({ params }) => {
    const id = asUuid(params.id);

    return id ? { id } : badId();
  },
  ownershipGrant: async ({ tx, tenantId, tenantUserId, prepared }) => {
    const facts = await correctionAccessFacts(
      tx,
      tenantId,
      prepared.id,
      tenantUserId
    );

    const granted =
      facts !== null &&
      (facts.requestedBy === tenantUserId ||
        facts.isAssignee ||
        (await employmentWithinBasis(tx, tenantId, facts.employmentId, {
          mode: "mine",
          tenantUserId
        })) ||
        (await employmentWithinBasis(tx, tenantId, facts.employmentId, {
          mode: "reports",
          tenantUserId
        })));

    return {
      granted,
      reason: "requester, approver, employee or supervisor reads a correction"
    };
  },
  authorize: HR_WORKFORCE_GUARDS.corrections.read,
  handler: async ({ tx, tenantId, prepared, auth, tokenHash, now, locals }) => {
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

    // The reason is read only for the requester, an assignee, or a caller whose
    // ROLES grant `corrections.read` (asked without the ownership basis).
    const ownReason = facts.requestedBy === tenantUserId || facts.isAssignee;
    const roleGrant =
      !ownReason &&
      (
        await authorizeInTransaction(
          tx,
          tenantId,
          tokenHash,
          now,
          HR_WORKFORCE_GUARDS.corrections.read
        )
      ).allowed;
    const includeReason = ownReason || roleGrant;

    // PS-18 / Issue #1083 M-1: the free-text reason is sensitive (health,
    // family). Reading it through the ROLE grant is recorded (the correction's
    // employment id, never the text); the requester's and an assignee's own
    // read is not.
    if (roleGrant) {
      await recordSensitiveRead(tx, {
        tenantId,
        actorTenantUserId: tenantUserId,
        permission: "hr_workforce.corrections.read",
        mode: "role_grant",
        itemCount: 1,
        resourceIds: [facts.employmentId],
        correlationId: locals.correlationId
      });
    }

    const correction = await getCorrection(tx, tenantId, prepared.id, {
      includeReason
    });

    return correction
      ? ok(correction)
      : fail(404, "RESOURCE_NOT_FOUND", "Attendance correction not found.");
  }
});
