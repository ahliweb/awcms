import type { APIRoute } from "astro";
import {
  fail,
  jsonResponse,
  ok
} from "../../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../../lib/database/client";
import { withTenant } from "../../../../../../lib/database/tenant-context";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../../../lib/auth/session-token";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../../lib/security/request-body-limit";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../../../modules/_shared/idempotency";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";
import { recordCounter } from "../../../../../../lib/observability/metrics-port";
import {
  cancelWorkflowInstance,
  WorkflowRecoveryError
} from "../../../../../../modules/workflow-approval/application/workflow-recovery";

const CANCEL_GUARD = {
  moduleKey: "workflow",
  activityCode: "recovery",
  action: "cancel" as const
};
const IDEMPOTENCY_SCOPE = "workflow_instance_cancel";
const MAX_REASON_LENGTH = 500;

type CancelRequestBody = { reason?: unknown };

/**
 * `POST /api/v1/workflows/instances/{id}/cancel` (Issue #747) —
 * administrative recovery: cancels a `pending` instance and every one of
 * its `pending` tasks. Explicit permission (`workflow.recovery.cancel`),
 * reason required, `Idempotency-Key` (high-risk), fully audited. Never
 * deletes the instance/task rows — appends a status transition
 * (`cancelled`) with `cancelled_at`/`cancelled_by`/`cancel_reason`.
 */
export const POST: APIRoute = async ({ request, params, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const instanceId = params.id;

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!instanceId)
    return fail(400, "VALIDATION_ERROR", "Instance id is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const idempotencyKey = request.headers.get("idempotency-key");

  if (!idempotencyKey) {
    return fail(
      400,
      "IDEMPOTENCY_REQUIRED",
      "Idempotency-Key header is required."
    );
  }

  const bodyRead = await readJsonBody<CancelRequestBody>(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const reason =
    typeof bodyRead.value?.reason === "string"
      ? bodyRead.value.reason.trim()
      : "";

  if (reason.length === 0 || reason.length > MAX_REASON_LENGTH) {
    return fail(
      400,
      "VALIDATION_ERROR",
      `reason is required (1-${MAX_REASON_LENGTH} characters).`
    );
  }

  const requestHash = computeRequestHash({ instanceId, reason });
  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const correlationId = locals.correlationId;

  return withTenant(
    sql,
    tenantId,
    async (tx) => {
      const auth = await authorizeInTransaction(
        tx,
        tenantId,
        tokenHash,
        now,
        CANCEL_GUARD
      );
      if (!auth.allowed) return auth.denied;

      const existingIdempotency = await findIdempotencyRecord(
        tx,
        tenantId,
        IDEMPOTENCY_SCOPE,
        idempotencyKey
      );

      if (existingIdempotency) {
        if (existingIdempotency.requestHash !== requestHash) {
          return fail(
            409,
            "IDEMPOTENCY_CONFLICT",
            "Idempotency-Key was already used with a different request."
          );
        }
        return jsonResponse(existingIdempotency.responseBody, {
          status: existingIdempotency.responseStatus
        });
      }

      try {
        await cancelWorkflowInstance(tx, {
          tenantId,
          instanceId,
          cancelledByTenantUserId: auth.context.tenantUserId,
          reason,
          correlationId
        });

        await recordAuditEvent(tx, {
          tenantId,
          actorTenantUserId: auth.context.tenantUserId,
          moduleKey: "workflow",
          action: "cancel",
          resourceType: "workflow_instance",
          resourceId: instanceId,
          severity: "warning",
          message: "Workflow instance cancelled.",
          attributes: { reason },
          correlationId
        });

        recordCounter("workflow_recovery_action_total", { action: "cancel" });

        const successResponse = ok({ instanceId }, { correlationId });
        const successBody = await successResponse.clone().json();

        await saveIdempotencyRecord(
          tx,
          tenantId,
          IDEMPOTENCY_SCOPE,
          idempotencyKey,
          requestHash,
          200,
          successBody
        );

        return successResponse;
      } catch (error) {
        if (error instanceof WorkflowRecoveryError) {
          return fail(409, "INVALID_STATUS_TRANSITION", error.message);
        }
        throw error;
      }
    },
    { workClass: "interactive" }
  );
};
