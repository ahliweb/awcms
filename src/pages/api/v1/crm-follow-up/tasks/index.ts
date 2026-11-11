import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { disabledResponse } from "../../../../../modules/crm-follow-up/application/route-support";
import { listTasks } from "../../../../../modules/crm-follow-up/application/task-directory";
import { CRM_FOLLOW_UP_GUARDS } from "../../../../../modules/crm-follow-up/domain/crm-follow-up-constants";
import {
  validateTaskListQuery,
  type TaskListFilter
} from "../../../../../modules/crm-follow-up/domain/crm-follow-up-validation";

/**
 * `GET /api/v1/crm-follow-up/tasks` (Issue #1165, ADR-0159) — the follow-up
 * queue, ordered by due instant, keyset-paginated (`cursor`, at most 100 per
 * page). The daily worklist is `assignee=me`; the overdue queue is
 * `overdue=true`; a lead's work is `leadId=...`. Ids, staff ids, closed codes
 * and instants only.
 */
export const GET = defineTenantRoute<TaskListFilter>({
  workClass: "interactive",
  prepare: ({ url }) => {
    const query = validateTaskListQuery(url.searchParams);

    return query.valid
      ? query.value
      : fail(400, "VALIDATION_ERROR", "Query is invalid.", {}, query.errors);
  },
  authorize: CRM_FOLLOW_UP_GUARDS.readTasks,
  handler: async (context) => {
    const disabled = disabledResponse();

    if (disabled) return disabled;

    return ok(
      await listTasks(
        context.tx,
        context.tenantId,
        context.auth.context.tenantUserId,
        context.prepared,
        context.now
      )
    );
  }
});
