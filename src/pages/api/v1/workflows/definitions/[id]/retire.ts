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
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../../../modules/_shared/idempotency";
import {
  retireWorkflowDefinition,
  WorkflowDefinitionLifecycleError
} from "../../../../../../modules/workflow-approval/application/workflow-definition-directory";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";

const RETIRE_GUARD = {
  moduleKey: "workflow",
  activityCode: "definition",
  action: "retire" as const
};
const IDEMPOTENCY_SCOPE = "workflow_definition_retire";

/** `POST /api/v1/workflows/definitions/{id}/retire` (Issue #747) — voluntarily retires an `active` version without publishing a replacement. High-risk (stops new instances from starting against this workflowKey) — requires `Idempotency-Key`. */
export const POST: APIRoute = async ({ request, params, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const id = params.id;

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!id) return fail(400, "VALIDATION_ERROR", "Definition id is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const idempotencyKey = request.headers.get("idempotency-key");

  if (!idempotencyKey) {
    return fail(
      400,
      "IDEMPOTENCY_REQUIRED",
      "Idempotency-Key header is required."
    );
  }

  const requestHash = computeRequestHash({ id, action: "retire" });
  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();

  return withTenant(
    sql,
    tenantId,
    async (tx) => {
      const auth = await authorizeInTransaction(
        tx,
        tenantId,
        tokenHash,
        now,
        RETIRE_GUARD
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
        const retired = await retireWorkflowDefinition(tx, {
          tenantId,
          definitionId: id,
          retiredByTenantUserId: auth.context.tenantUserId
        });

        await recordAuditEvent(tx, {
          tenantId,
          actorTenantUserId: auth.context.tenantUserId,
          moduleKey: "workflow",
          action: "retire",
          resourceType: "workflow_definition",
          resourceId: retired.id,
          severity: "warning",
          message: `Workflow definition "${retired.workflow_key}" v${retired.version} retired.`,
          attributes: {
            workflowKey: retired.workflow_key,
            version: retired.version
          },
          correlationId: locals.correlationId
        });

        const successResponse = ok(
          {
            id: retired.id,
            workflowKey: retired.workflow_key,
            version: retired.version,
            lifecycleStatus: retired.lifecycle_status
          },
          { correlationId: locals.correlationId }
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
        if (error instanceof WorkflowDefinitionLifecycleError) {
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
