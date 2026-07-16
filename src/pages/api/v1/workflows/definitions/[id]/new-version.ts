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
  createNewDraftVersion,
  WorkflowDefinitionLifecycleError
} from "../../../../../../modules/workflow-approval/application/workflow-definition-directory";

const CREATE_GUARD = {
  moduleKey: "workflow",
  activityCode: "definition",
  action: "create" as const
};

/**
 * `POST /api/v1/workflows/definitions/{id}/new-version` (Issue #747) —
 * the ONLY way to change an `active`/`retired` definition: forks its
 * current graph/facts into a NEW `draft` row (`version` = current max for
 * the workflow_key + 1). Not high-risk on its own (creates a draft,
 * changes nothing live) — no Idempotency-Key required, matching
 * `POST .../definitions` (plain create).
 */
export const POST: APIRoute = async ({ params, request, cookies, locals }) => {
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
        CREATE_GUARD
      );
      if (!auth.allowed) return auth.denied;

      try {
        const created = await createNewDraftVersion(
          tx,
          tenantId,
          id,
          auth.context.tenantUserId
        );

        return ok(
          {
            id: created.id,
            workflowKey: created.workflow_key,
            version: created.version,
            lifecycleStatus: created.lifecycle_status
          },
          { correlationId: locals.correlationId }
        );
      } catch (error) {
        if (error instanceof WorkflowDefinitionLifecycleError) {
          return fail(404, "RESOURCE_NOT_FOUND", error.message);
        }
        throw error;
      }
    },
    { workClass: "interactive" }
  );
};
