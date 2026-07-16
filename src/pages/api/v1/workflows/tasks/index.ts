import type { APIRoute } from "astro";
import { fail, ok } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import { decodeKeysetCursor } from "../../../../../modules/_shared/keyset-pagination";
import { listWorkflowInboxTasks } from "../../../../../modules/workflow-approval/application/workflow-inbox-directory";

const GUARD_REQUEST = {
  moduleKey: "workflow",
  activityCode: "approval",
  action: "read" as const
};

const VALID_STATUSES = new Set([
  "pending",
  "completed",
  "skipped",
  "cancelled"
]);

/**
 * `GET /api/v1/workflows/tasks` (Issue 11.1, extended by Issue #747 into
 * the consolidated admin approval inbox). Bearer-session/SSR-cookie auth,
 * guarded by `workflow.approval.read`. Keyset pagination (`cursor` query
 * param, opaque, `(created_at, id)`-based — doc 16 §Pagination keyset),
 * filters `workflowKey`/`resourceType`/`status`/`overdue`, and a safe
 * parameterized `search`.
 */
export const GET: APIRoute = async ({ request, url, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }
  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const statusParam = url.searchParams.get("status") ?? "pending";

  if (!VALID_STATUSES.has(statusParam)) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "status must be pending, completed, skipped, or cancelled."
    );
  }

  const cursorParam = url.searchParams.get("cursor");
  const cursor = cursorParam ? decodeKeysetCursor(cursorParam) : null;

  if (cursorParam && !cursor) {
    return fail(400, "VALIDATION_ERROR", "cursor is malformed.");
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
        GUARD_REQUEST
      );
      if (!auth.allowed) return auth.denied;

      const result = await listWorkflowInboxTasks(
        tx,
        tenantId,
        {
          workflowKey: url.searchParams.get("workflowKey") ?? undefined,
          resourceType: url.searchParams.get("resourceType") ?? undefined,
          status: statusParam as
            "pending" | "completed" | "skipped" | "cancelled",
          overdueOnly: url.searchParams.get("overdue") === "true",
          search: url.searchParams.get("search") ?? undefined
        },
        now,
        cursor
      );

      return ok(
        {
          tasks: result.tasks.map((task) => ({
            id: task.id,
            nodeId: task.nodeId,
            status: task.status,
            quorumRule: task.quorumRule,
            dueAt: task.dueAt ?? undefined,
            overdue: task.overdue,
            createdAt: task.createdAt.toISOString(),
            instanceId: task.instanceId,
            resourceType: task.resourceType,
            resourceId: task.resourceId,
            requestedByTenantUserId: task.requestedByTenantUserId,
            workflowDefinitionId: task.workflowDefinitionId,
            workflowKey: task.workflowKey,
            workflowName: task.workflowName
          })),
          nextCursor: result.nextCursor
        },
        { correlationId: locals.correlationId }
      );
    },
    { workClass: "interactive" }
  );
};
