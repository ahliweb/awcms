import type { APIRoute } from "astro";
import {
  fail,
  jsonResponse,
  ok
} from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../../modules/_shared/idempotency";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import {
  getWorkflowDefinitionById,
  listWorkflowDefinitionVersions,
  softDeleteDraftWorkflowDefinition,
  updateDraftWorkflowDefinition,
  InvalidWorkflowGraphError,
  WorkflowDefinitionLifecycleError,
  type WorkflowDefinitionRow
} from "../../../../../modules/workflow-approval/application/workflow-definition-directory";
import { validateUpdateWorkflowDefinitionRequestBody } from "../../../../../modules/workflow-approval/domain/workflow-definition-lifecycle";

const READ_GUARD = {
  moduleKey: "workflow",
  activityCode: "definition",
  action: "read" as const
};
const UPDATE_GUARD = {
  moduleKey: "workflow",
  activityCode: "definition",
  action: "update" as const
};
const DELETE_GUARD = {
  moduleKey: "workflow",
  activityCode: "definition",
  action: "delete" as const
};
const DELETE_IDEMPOTENCY_SCOPE = "workflow_definition_delete";

function serializeDefinition(row: WorkflowDefinitionRow) {
  return {
    id: row.id,
    workflowKey: row.workflow_key,
    name: row.name,
    description: row.description ?? undefined,
    version: row.version,
    lifecycleStatus: row.lifecycle_status,
    graph: row.graph,
    factsSchema: row.facts_schema,
    publishedAt: row.published_at ? row.published_at.toISOString() : undefined,
    retiredAt: row.retired_at ? row.retired_at.toISOString() : undefined,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

/** `GET /api/v1/workflows/definitions/{id}` (Issue #747) — detail + full version history for the same `workflowKey`. */
export const GET: APIRoute = async ({ request, params, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const id = params.id;

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!id) return fail(400, "VALIDATION_ERROR", "Definition id is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

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
        READ_GUARD
      );
      if (!auth.allowed) return auth.denied;

      const definition = await getWorkflowDefinitionById(tx, tenantId, id);

      if (!definition) {
        return fail(
          404,
          "RESOURCE_NOT_FOUND",
          "Workflow definition not found."
        );
      }

      const versions = await listWorkflowDefinitionVersions(
        tx,
        tenantId,
        definition.workflow_key
      );

      return ok(
        {
          definition: serializeDefinition(definition),
          versions: versions.map(serializeDefinition)
        },
        { correlationId: locals.correlationId }
      );
    },
    { workClass: "interactive" }
  );
};

/** `PUT /api/v1/workflows/definitions/{id}` (Issue #747) — updates a `draft` definition IN PLACE. 409 if the definition is not a draft (use `POST .../new-version` instead). */
export const PUT: APIRoute = async ({ request, params, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const id = params.id;

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!id) return fail(400, "VALIDATION_ERROR", "Definition id is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const bodyRead = await readJsonBody(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const validation = validateUpdateWorkflowDefinitionRequestBody(
    bodyRead.value
  );

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Definition input is invalid.",
      {},
      validation.errors
    );
  }

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
        UPDATE_GUARD
      );
      if (!auth.allowed) return auth.denied;

      try {
        const updated = await updateDraftWorkflowDefinition(tx, {
          tenantId,
          definitionId: id,
          name: validation.value.name,
          description: validation.value.description,
          graph: validation.value.graph,
          factsSchema: validation.value.factsSchema
        });

        return ok(
          { definition: serializeDefinition(updated) },
          { correlationId: locals.correlationId }
        );
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

/**
 * `DELETE /api/v1/workflows/definitions/{id}` (Issue #747) — soft-deletes
 * a `draft` definition. 409 for any non-draft (published/retired version
 * history is permanent). High-risk (`delete` is in `HIGH_RISK_ACTIONS`) —
 * requires `Idempotency-Key`, fully audited (security-auditor finding,
 * PR #778 — both were previously missing).
 */
export const DELETE: APIRoute = async ({
  request,
  params,
  cookies,
  locals
}) => {
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

  const bodyRead = await readJsonBody<{ reason?: unknown }>(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const reason =
    typeof bodyRead.value?.reason === "string"
      ? bodyRead.value.reason
      : undefined;

  const requestHash = computeRequestHash({ id, action: "delete", reason });
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
        DELETE_GUARD
      );
      if (!auth.allowed) return auth.denied;

      const existingIdempotency = await findIdempotencyRecord(
        tx,
        tenantId,
        DELETE_IDEMPOTENCY_SCOPE,
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
        const existing = await getWorkflowDefinitionById(tx, tenantId, id);

        await softDeleteDraftWorkflowDefinition(tx, {
          tenantId,
          definitionId: id,
          deletedByTenantUserId: auth.context.tenantUserId,
          deleteReason: reason
        });

        await recordAuditEvent(tx, {
          tenantId,
          actorTenantUserId: auth.context.tenantUserId,
          moduleKey: "workflow",
          action: "delete",
          resourceType: "workflow_definition",
          resourceId: id,
          severity: "warning",
          message: `Workflow definition draft "${existing?.workflow_key ?? id}" soft-deleted.`,
          attributes: {
            workflowKey: existing?.workflow_key,
            version: existing?.version,
            reason
          },
          correlationId: locals.correlationId
        });

        const successResponse = ok(
          { id },
          { correlationId: locals.correlationId }
        );
        const successBody = await successResponse.clone().json();

        await saveIdempotencyRecord(
          tx,
          tenantId,
          DELETE_IDEMPOTENCY_SCOPE,
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
