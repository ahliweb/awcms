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
  reassignWorkflowTask,
  WorkflowRecoveryError
} from "../../../../../../modules/workflow-approval/application/workflow-recovery";

const REASSIGN_GUARD = {
  moduleKey: "workflow",
  activityCode: "recovery",
  action: "reassign" as const
};
const IDEMPOTENCY_SCOPE = "workflow_task_reassign";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REASON_LENGTH = 500;

type ReassignRequestBody = { toTenantUserId?: unknown; reason?: unknown };

/**
 * `POST /api/v1/workflows/tasks/{id}/reassign` (Issue #747) —
 * administrative recovery: reassigns every currently-`pending` assignment
 * seat on the task to a new tenant user. Explicit permission
 * (`workflow.recovery.reassign`), reason required, `Idempotency-Key`
 * (high-risk), fully audited. Never deletes the prior assignment rows —
 * marks them `reassigned` and appends a new `pending` one.
 */
export const POST: APIRoute = async ({ request, params, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const taskId = params.id;

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!taskId) return fail(400, "VALIDATION_ERROR", "Task id is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const idempotencyKey = request.headers.get("idempotency-key");

  if (!idempotencyKey) {
    return fail(
      400,
      "IDEMPOTENCY_REQUIRED",
      "Idempotency-Key header is required."
    );
  }

  const bodyRead = await readJsonBody<ReassignRequestBody>(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const toTenantUserId = bodyRead.value?.toTenantUserId;
  const reason =
    typeof bodyRead.value?.reason === "string"
      ? bodyRead.value.reason.trim()
      : "";

  if (
    typeof toTenantUserId !== "string" ||
    !UUID_PATTERN.test(toTenantUserId)
  ) {
    return fail(400, "VALIDATION_ERROR", "toTenantUserId must be a UUID.");
  }
  if (reason.length === 0 || reason.length > MAX_REASON_LENGTH) {
    return fail(
      400,
      "VALIDATION_ERROR",
      `reason is required (1-${MAX_REASON_LENGTH} characters).`
    );
  }

  const requestHash = computeRequestHash({ taskId, toTenantUserId, reason });
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
        REASSIGN_GUARD
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
        const result = await reassignWorkflowTask(tx, {
          tenantId,
          taskId,
          toTenantUserId,
          reassignedByTenantUserId: auth.context.tenantUserId,
          reason
        });

        await recordAuditEvent(tx, {
          tenantId,
          actorTenantUserId: auth.context.tenantUserId,
          moduleKey: "workflow",
          action: "reassign",
          resourceType: "workflow_task",
          resourceId: taskId,
          severity: "warning",
          message: `Workflow task reassigned to ${toTenantUserId}.`,
          attributes: { toTenantUserId, reason },
          correlationId
        });

        recordCounter("workflow_recovery_action_total", { action: "reassign" });

        const successResponse = ok(
          { taskId, assignmentId: result.assignmentId },
          { correlationId }
        );
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
          if (error.message.includes("not found")) {
            return fail(404, "RESOURCE_NOT_FOUND", error.message);
          }
          return fail(409, "INVALID_STATUS_TRANSITION", error.message);
        }
        throw error;
      }
    },
    { workClass: "interactive" }
  );
};
