import { ok } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import {
  asUuid,
  badId,
  disabledResponse,
  notFound
} from "../../../../../../modules/crm-follow-up/application/route-support";
import { fetchTaskDetail } from "../../../../../../modules/crm-follow-up/application/task-directory";
import { CRM_FOLLOW_UP_GUARDS } from "../../../../../../modules/crm-follow-up/domain/crm-follow-up-constants";

/**
 * `GET /api/v1/crm-follow-up/tasks/{id}` (Issue #1165) — one task with its
 * append-only action history and its staff notices (scheduled, enqueued,
 * cancelled or suppressed, with the closed reason).
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: CRM_FOLLOW_UP_GUARDS.readTasks,
  handler: async (context) => {
    const disabled = disabledResponse();

    if (disabled) return disabled;

    const id = asUuid(context.params.id);

    if (!id) return badId();

    const detail = await fetchTaskDetail(
      context.tx,
      context.tenantId,
      id,
      context.now
    );

    return detail ? ok(detail) : notFound("Task");
  }
});
