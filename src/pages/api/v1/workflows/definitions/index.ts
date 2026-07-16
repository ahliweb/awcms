import type { APIRoute } from "astro";
import { fail, ok } from "../../../../../modules/_shared/api-response";
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
  createWorkflowDefinition,
  listWorkflowDefinitions,
  InvalidWorkflowGraphError
} from "../../../../../modules/workflow-approval/application/workflow-definition-directory";
import { validateCreateWorkflowDefinitionRequestBody } from "../../../../../modules/workflow-approval/domain/workflow-definition-lifecycle";

const READ_GUARD = {
  moduleKey: "workflow",
  activityCode: "definition",
  action: "read" as const
};
const CREATE_GUARD = {
  moduleKey: "workflow",
  activityCode: "definition",
  action: "create" as const
};

function serializeDefinition(row: {
  id: string;
  workflow_key: string;
  name: string;
  description: string | null;
  version: number;
  lifecycle_status: string;
  graph: unknown;
  facts_schema: unknown;
  published_at: Date | null;
  retired_at: Date | null;
  created_at: Date;
  updated_at: Date;
}) {
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

/**
 * `GET /api/v1/workflows/definitions` (Issue #747) — one row per distinct
 * `workflowKey` (latest version, or latest matching `lifecycleStatus`
 * filter). See `GET /api/v1/workflows/definitions/{id}` for full version
 * history.
 */
export const GET: APIRoute = async ({ request, url, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }
  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const lifecycleStatus = url.searchParams.get("lifecycleStatus");

  if (
    lifecycleStatus &&
    lifecycleStatus !== "draft" &&
    lifecycleStatus !== "active" &&
    lifecycleStatus !== "retired"
  ) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "lifecycleStatus must be draft, active, or retired."
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
        READ_GUARD
      );

      if (!auth.allowed) {
        return auth.denied;
      }

      const rows = await listWorkflowDefinitions(tx, tenantId, {
        lifecycleStatus: (lifecycleStatus ?? undefined) as
          "draft" | "active" | "retired" | undefined
      });

      return ok(
        { definitions: rows.map(serializeDefinition) },
        { correlationId: locals.correlationId }
      );
    },
    { workClass: "interactive" }
  );
};

/**
 * `POST /api/v1/workflows/definitions` (Issue #747) — creates a new
 * `draft` version 1 definition (or, if `workflowKey` already has version
 * history, the next draft version). Guarded by `workflow.definition.create`.
 */
export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }
  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const bodyRead = await readJsonBody(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const validation = validateCreateWorkflowDefinitionRequestBody(
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
        CREATE_GUARD
      );

      if (!auth.allowed) {
        return auth.denied;
      }

      try {
        const created = await createWorkflowDefinition(tx, {
          tenantId,
          workflowKey: validation.value.workflowKey,
          name: validation.value.name,
          description: validation.value.description,
          graph: validation.value.graph,
          factsSchema: validation.value.factsSchema,
          createdByTenantUserId: auth.context.tenantUserId
        });

        return ok(
          { definition: serializeDefinition(created) },
          { correlationId: locals.correlationId }
        );
      } catch (error) {
        if (error instanceof InvalidWorkflowGraphError) {
          return fail(400, "VALIDATION_ERROR", error.message, {}, error.errors);
        }
        throw error;
      }
    },
    { workClass: "interactive" }
  );
};
