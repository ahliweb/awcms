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
  forceWorkflowTaskDecision,
  WorkflowRecoveryError
} from "../../../../../../modules/workflow-approval/application/workflow-recovery";
import { fetchTaskWithInstanceForDecision } from "../../../../../../modules/workflow-approval/application/workflow-instance-decision";

const FORCE_DECIDE_GUARD = {
  moduleKey: "workflow",
  activityCode: "recovery",
  action: "force_decide" as const
};
const IDEMPOTENCY_SCOPE = "workflow_task_force_decision";
const MAX_REASON_LENGTH = 500;
// No notification port is wired in this base — see decisions.ts for why the
// `email`-owned WorkflowNotificationPort adapter is not injected yet.

type ForceDecisionRequestBody = { decision?: unknown; reason?: unknown };

/**
 * `POST /api/v1/workflows/tasks/{id}/force-decision` (Issue #747) —
 * administrative recovery: force-approves or force-rejects a pending
 * task, BYPASSING quorum entirely. Explicit permission
 * (`workflow.recovery.force_decide`), reason required, `Idempotency-Key`
 * (high-risk), fully audited. Recorded as an append-only decision row
 * with `is_administrative_override: true` — never overwrites prior
 * decision history.
 *
 * Security-auditor finding (PR #778): the task/instance is looked up
 * BEFORE the guard — same pattern `decisions.ts` uses — so
 * `resourceAttributes.requestedByTenantUserId` is populated and the
 * self-approval-deny check in `access-control.ts` (extended to also
 * cover `force_decide`) can fire. Without this, a caller who filed their
 * own instance and also holds `workflow.recovery.force_decide` could
 * force-approve their own request, structurally bypassing quorum.
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

  const bodyRead = await readJsonBody<ForceDecisionRequestBody>(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const decisionInput = bodyRead.value?.decision;
  const reason =
    typeof bodyRead.value?.reason === "string"
      ? bodyRead.value.reason.trim()
      : "";

  if (decisionInput !== "approve" && decisionInput !== "reject") {
    return fail(
      400,
      "VALIDATION_ERROR",
      'decision must be "approve" or "reject".'
    );
  }
  if (reason.length === 0 || reason.length > MAX_REASON_LENGTH) {
    return fail(
      400,
      "VALIDATION_ERROR",
      `reason is required (1-${MAX_REASON_LENGTH} characters).`
    );
  }

  const decision =
    decisionInput === "approve" ? "force_approve" : "force_reject";
  const requestHash = computeRequestHash({ taskId, decision, reason });
  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const correlationId = locals.correlationId;

  return withTenant(
    sql,
    tenantId,
    async (tx) => {
      // Look up the task/instance BEFORE the guard so self-approval
      // resourceAttributes are populated — see doc comment above.
      const taskForGuard = await fetchTaskWithInstanceForDecision(
        tx,
        tenantId,
        taskId
      );

      const guardRequest = {
        ...FORCE_DECIDE_GUARD,
        resourceType: "workflow_task",
        resourceId: taskId,
        resourceAttributes: {
          tenantId,
          requestedByTenantUserId: taskForGuard?.requested_by_tenant_user_id
        }
      };

      const auth = await authorizeInTransaction(
        tx,
        tenantId,
        tokenHash,
        now,
        guardRequest
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
        const result = await forceWorkflowTaskDecision(tx, {
          tenantId,
          taskId,
          decision,
          forcedByTenantUserId: auth.context.tenantUserId,
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
          message: `Workflow task force-decided: ${decision}.`,
          attributes: { decision, reason, taskId },
          correlationId
        });

        recordCounter("workflow_recovery_action_total", {
          action: "force_decide"
        });

        const successResponse = ok(
          {
            taskId,
            instanceId: result.instanceId,
            instanceFinished: result.instanceFinished,
            instanceStatus: result.instanceStatus ?? "pending"
          },
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
