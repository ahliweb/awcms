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
import { recordHistogram } from "../../../../../../lib/observability/metrics-port";
import { validateWorkflowDecisionRequestBody } from "../../../../../../modules/workflow-approval/domain/workflow-transition";
import {
  fetchTaskWithInstanceForDecision,
  findEligibleAssignment,
  recordWorkflowTaskDecision
} from "../../../../../../modules/workflow-approval/application/workflow-instance-decision";

const GUARD_ACTIVITY = { moduleKey: "workflow", activityCode: "approval" };
const IDEMPOTENCY_SCOPE = "workflow_task_decision";
// No notification port is wired in this base — the `email` module (which
// owns the concrete WorkflowNotificationPort adapter in awcms-mini) has not
// been ported yet, so `notify` graph nodes silently no-op (they always
// advance to `next` regardless). Inject an adapter here once `email` lands.

/**
 * `POST /api/v1/workflows/tasks/{id}/decisions` (Issue 11.1, evolved by
 * Issue #747 for quorum/delegation). Guarded by `workflow.approval.approve`
 * (same action for both "approve" and "reject" — the permission is the
 * ability to decide). The task's instance's `requested_by_tenant_user_id`
 * is looked up BEFORE calling the guard so the EXISTING, unchanged
 * self-approval denial in `identity-access/domain/access-control.ts`
 * (Issue 2.4) has the right value to compare against
 * `context.tenantUserId`. A SEPARATE, narrower check
 * (`findEligibleAssignment`) then confirms the caller is actually one of
 * THIS task's eligible deciders (directly assigned, or an active
 * delegate) — a business rule ABAC has no notion of.
 *
 * High-risk mutation: requires `Idempotency-Key`. Same key + same request
 * body hash replays the stored response; same key + different hash ->
 * `409 IDEMPOTENCY_CONFLICT`; task no longer `pending` -> also `409`.
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

  const bodyRead = await readJsonBody(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const validation = validateWorkflowDecisionRequestBody(bodyRead.value);

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Decision input is invalid.",
      {},
      validation.errors
    );
  }

  const { decision, reason } = validation.value;
  const requestHash = computeRequestHash({ taskId, decision, reason });
  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const correlationId = locals.correlationId;
  const decisionStartedAt = Date.now();

  return withTenant(
    sql,
    tenantId,
    async (tx) => {
      // Look up the task/instance BEFORE the real guard so self-approval
      // resourceAttributes are populated — see doc comment above.
      const task = await fetchTaskWithInstanceForDecision(tx, tenantId, taskId);

      const guardRequest = {
        ...GUARD_ACTIVITY,
        action: "approve" as const,
        resourceType: "workflow_task",
        resourceId: taskId,
        resourceAttributes: {
          tenantId,
          requestedByTenantUserId: task?.requested_by_tenant_user_id
        }
      };

      const auth = await authorizeInTransaction(
        tx,
        tenantId,
        tokenHash,
        now,
        guardRequest
      );

      if (!auth.allowed) {
        return auth.denied;
      }

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

      if (!task) {
        return fail(404, "RESOURCE_NOT_FOUND", "Workflow task not found.");
      }

      if (task.status !== "pending") {
        return fail(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Task decision has already been recorded."
        );
      }

      const assignment = await findEligibleAssignment(
        tx,
        tenantId,
        taskId,
        auth.context.tenantUserId,
        task.workflow_key,
        task.resource_type,
        now
      );

      if (!assignment) {
        return fail(
          403,
          "ACCESS_DENIED",
          "You are not an eligible decider for this task (not directly assigned, and no active delegation names you)."
        );
      }

      const result = await recordWorkflowTaskDecision(tx, {
        tenantId,
        taskId,
        task,
        assignment,
        decidingTenantUserId: auth.context.tenantUserId,
        decision,
        reason,
        now,
        correlationId
      });

      await recordAuditEvent(tx, {
        tenantId,
        actorTenantUserId: auth.context.tenantUserId,
        moduleKey: "workflow",
        action: decision,
        resourceType: "workflow_instance",
        resourceId: result.instanceId,
        severity: "warning",
        message: `Workflow task decision recorded: ${decision}.`,
        attributes: { decision, reason, taskId },
        correlationId
      });

      recordHistogram(
        "workflow_task_decision_duration_ms",
        Date.now() - decisionStartedAt,
        {
          outcome:
            result.instanceStatus ??
            (decision === "approve" ? "approved" : "rejected")
        }
      );

      const responseData = {
        taskId,
        decision,
        instanceId: result.instanceId,
        taskCompleted: result.taskCompleted,
        instanceFinished: result.instanceFinished,
        instanceStatus: result.instanceStatus ?? "pending"
      };
      const successResponse = ok(responseData, { correlationId });
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
    },
    { workClass: "interactive" }
  );
};
