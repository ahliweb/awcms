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
  publishWorkflowDefinition,
  InvalidWorkflowGraphError,
  WorkflowDefinitionLifecycleError
} from "../../../../../../modules/workflow-approval/application/workflow-definition-directory";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";

const PUBLISH_GUARD = {
  moduleKey: "workflow",
  activityCode: "definition",
  action: "publish" as const
};
const IDEMPOTENCY_SCOPE = "workflow_definition_publish";

/**
 * `POST /api/v1/workflows/definitions/{id}/publish` (Issue #747) —
 * transitions `draft` -> `active`, retiring any previously-`active`
 * version of the same `workflow_key` in the SAME transaction. High-risk
 * (changes what future instances pin to) — requires `Idempotency-Key`.
 */
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

  const requestHash = computeRequestHash({ id, action: "publish" });
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
        PUBLISH_GUARD
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
        const published = await publishWorkflowDefinition(tx, {
          tenantId,
          definitionId: id,
          publishedByTenantUserId: auth.context.tenantUserId
        });

        await recordAuditEvent(tx, {
          tenantId,
          actorTenantUserId: auth.context.tenantUserId,
          moduleKey: "workflow",
          action: "publish",
          resourceType: "workflow_definition",
          resourceId: published.id,
          severity: "warning",
          message: `Workflow definition "${published.workflow_key}" v${published.version} published.`,
          attributes: {
            workflowKey: published.workflow_key,
            version: published.version
          },
          correlationId: locals.correlationId
        });

        const successResponse = ok(
          {
            id: published.id,
            workflowKey: published.workflow_key,
            version: published.version,
            lifecycleStatus: published.lifecycle_status
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
        if (error instanceof InvalidWorkflowGraphError) {
          return fail(400, "VALIDATION_ERROR", error.message, {}, error.errors);
        }
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
