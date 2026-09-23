import { defineTenantRoute } from "../../../../../../../../modules/_shared/tenant-route";
import {
  fail,
  jsonResponse,
  ok
} from "../../../../../../../../modules/_shared/api-response";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../../../../../modules/_shared/idempotency";
import { OMES_GUARDS } from "../../../../../../../../modules/omes-control/domain/permissions";
import { revokeEnrollment } from "../../../../../../../../modules/omes-control/application/enrollment-management";
import { recordAuditEvent } from "../../../../../../../../modules/logging/application/audit-log";

const IDEMPOTENCY_SCOPE = "omes_enrollment_revoke";

type Prepared = { idempotencyKey: string };

/**
 * `POST /api/v1/omes/servers/{id}/enrollment-challenges/{workerId}/revoke`
 * (Issue ahliweb/omes#198) — revokes a pending or enrolled worker
 * credential. Guarded by `omes_control.enrollments.manage`.
 */
export const POST = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: ({ request }): Prepared | Response => {
    const idempotencyKey = request.headers.get("idempotency-key");

    if (!idempotencyKey) {
      return fail(
        400,
        "IDEMPOTENCY_REQUIRED",
        "Idempotency-Key header is required."
      );
    }

    return { idempotencyKey };
  },
  authorize: OMES_GUARDS.enrollments.manage,
  handler: async ({ tx, tenantId, now, auth, prepared, params, locals }) => {
    const serverId = params.id;
    const workerId = params.workerId;

    if (!serverId || !workerId) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "Server id and worker id are required."
      );
    }

    const requestHash = computeRequestHash({
      action: "revoke_enrollment",
      serverId,
      workerId
    });
    const existing = await findIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey
    );

    if (existing) {
      if (existing.requestHash !== requestHash) {
        return fail(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Idempotency-Key was already used with a different request."
        );
      }
      return jsonResponse(existing.responseBody, {
        status: existing.responseStatus
      });
    }

    const outcome = await revokeEnrollment(
      tx,
      tenantId,
      serverId,
      workerId,
      now
    );

    if (outcome.outcome === "not_found") {
      return fail(404, "RESOURCE_NOT_FOUND", "Enrollment not found.");
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "omes_control",
      action: "omes_control.enrollments.manage",
      resourceType: "omes_enrollment",
      resourceId: workerId,
      severity: "warning",
      message:
        outcome.outcome === "revoked"
          ? `Enrollment ${workerId} revoked.`
          : `Enrollment ${workerId} was already revoked.`,
      attributes: { serverId, workerId },
      correlationId: locals.correlationId
    });

    const response = ok({ workerId, status: "revoked" });
    const responseBody = await response.clone().json();

    await saveIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey,
      requestHash,
      200,
      responseBody
    );

    return response;
  }
});
