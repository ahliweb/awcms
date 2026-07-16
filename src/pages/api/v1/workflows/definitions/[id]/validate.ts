import type { APIRoute } from "astro";
import { fail, ok } from "../../../../../../modules/_shared/api-response";
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
import { getWorkflowDefinitionById } from "../../../../../../modules/workflow-approval/application/workflow-definition-directory";
import { validateWorkflowGraph } from "../../../../../../modules/workflow-approval/domain/workflow-graph";
import { getWorkflowConditionResolverNames } from "../../../../../../modules/workflow-approval/infrastructure/condition-action-registry";

const READ_GUARD = {
  moduleKey: "workflow",
  activityCode: "definition",
  action: "read" as const
};

type ValidateRequestBody = { graph?: unknown; factsSchema?: unknown };

/**
 * `POST /api/v1/workflows/definitions/{id}/validate` (Issue #747) — a
 * read-only, non-persisting dry-run of `validateWorkflowGraph`. With no
 * body, validates the STORED definition's current graph/factsSchema;
 * with a body, validates the CANDIDATE graph/factsSchema (e.g. a draft
 * edit not yet saved) instead — useful for an editor's "check before
 * save" flow.
 */
export const POST: APIRoute = async ({ request, params, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const id = params.id;

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!id) return fail(400, "VALIDATION_ERROR", "Definition id is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const bodyRead = await readJsonBody<ValidateRequestBody>(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
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
      if (!auth.allowed) return auth.denied;

      const definition = await getWorkflowDefinitionById(tx, tenantId, id);

      if (!definition) {
        return fail(
          404,
          "RESOURCE_NOT_FOUND",
          "Workflow definition not found."
        );
      }

      const graph = bodyRead.value?.graph ?? definition.graph;
      const factsSchema =
        bodyRead.value?.factsSchema ?? definition.facts_schema;
      const result = validateWorkflowGraph(
        graph,
        factsSchema,
        getWorkflowConditionResolverNames()
      );

      return ok(
        result.valid
          ? { valid: true }
          : { valid: false, errors: result.errors },
        { correlationId: locals.correlationId }
      );
    },
    { workClass: "interactive" }
  );
};
