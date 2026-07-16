import type { APIRoute } from "astro";
import { fail, ok } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import { listWorkflowInstanceHistory } from "../../../../../modules/workflow-approval/application/workflow-inbox-directory";

const READ_GUARD = {
  moduleKey: "workflow",
  activityCode: "approval",
  action: "read" as const
};

type InstanceRow = {
  id: string;
  workflow_definition_id: string;
  workflow_definition_version: number;
  workflow_key: string;
  workflow_name: string;
  resource_type: string;
  resource_id: string;
  status: string;
  requested_by_tenant_user_id: string;
  facts: unknown;
  cancel_reason: string | null;
  created_at: Date;
  updated_at: Date;
};

/**
 * `GET /api/v1/workflows/instances/{id}` (Issue #747) — instance detail
 * (pinned definition version, facts, status) plus its immutable action
 * history (decisions + audit events, `listWorkflowInstanceHistory`).
 */
export const GET: APIRoute = async ({ request, params, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const id = params.id;

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!id) return fail(400, "VALIDATION_ERROR", "Instance id is required.");
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

      const rows = (await tx`
        SELECT i.id, i.workflow_definition_id, i.workflow_definition_version,
               d.workflow_key, d.name AS workflow_name,
               i.resource_type, i.resource_id, i.status,
               i.requested_by_tenant_user_id, i.facts, i.cancel_reason,
               i.created_at, i.updated_at
        FROM awcms_workflow_instances i
        JOIN awcms_workflow_definitions d ON d.id = i.workflow_definition_id
        WHERE i.tenant_id = ${tenantId} AND i.id = ${id}
      `) as InstanceRow[];
      const instance = rows[0];

      if (!instance) {
        return fail(404, "RESOURCE_NOT_FOUND", "Workflow instance not found.");
      }

      const history = await listWorkflowInstanceHistory(tx, tenantId, id);

      return ok(
        {
          instance: {
            id: instance.id,
            workflowDefinitionId: instance.workflow_definition_id,
            workflowDefinitionVersion: instance.workflow_definition_version,
            workflowKey: instance.workflow_key,
            workflowName: instance.workflow_name,
            resourceType: instance.resource_type,
            resourceId: instance.resource_id,
            status: instance.status,
            requestedByTenantUserId: instance.requested_by_tenant_user_id,
            facts: instance.facts,
            cancelReason: instance.cancel_reason ?? undefined,
            createdAt: instance.created_at.toISOString(),
            updatedAt: instance.updated_at.toISOString()
          },
          history: history.map((entry) => ({
            kind: entry.kind,
            createdAt: entry.createdAt.toISOString(),
            actorTenantUserId: entry.actorTenantUserId ?? undefined,
            action: entry.action,
            detail: entry.detail
          }))
        },
        { correlationId: locals.correlationId }
      );
    },
    { workClass: "interactive" }
  );
};
