import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import {
  asUuid,
  auditCrmFollowUp,
  badId,
  mutationRefusal,
  prepareMutation,
  runIdempotent,
  taskCloseRefusal,
  tenantDisabledResponse
} from "../../../../../../modules/crm-follow-up/application/route-support";
import { completeTask } from "../../../../../../modules/crm-follow-up/application/task-engine";
import { CRM_FOLLOW_UP_GUARDS } from "../../../../../../modules/crm-follow-up/domain/crm-follow-up-constants";
import {
  validateCompleteTask,
  type CompleteTaskInput
} from "../../../../../../modules/crm-follow-up/domain/crm-follow-up-validation";

/**
 * `POST /api/v1/crm-follow-up/tasks/{id}/complete` (Issue #1165) — close an
 * open or escalated task with a CLOSED outcome (`reached`, `no_answer`,
 * `rescheduled`, `not_interested`, `other`; no free text). Its pending notices
 * are cancelled. `Idempotency-Key`, `expectedVersion` (`409 VERSION_CONFLICT`),
 * `409 TASK_CLOSED` for a closed task, audited.
 */
export const POST = defineTenantRoute<{
  idempotencyKey: string;
  input: CompleteTaskInput;
}>({
  workClass: "interactive",
  prepare: ({ request }) => prepareMutation(request, validateCompleteTask),
  authorize: CRM_FOLLOW_UP_GUARDS.updateTasks,
  handler: async (context) => {
    const refused = mutationRefusal(context.auth);

    if (refused) return refused;

    const id = asUuid(context.params.id);

    if (!id) return badId();

    const { tx, tenantId, auth, prepared } = context;
    const tenantOff = await tenantDisabledResponse(tx, tenantId);

    if (tenantOff) return tenantOff;

    const actor = auth.context.tenantUserId;

    return runIdempotent(
      tx,
      tenantId,
      "crm_follow_up_task_complete",
      prepared.idempotencyKey,
      actor,
      { id, ...prepared.input },
      async () => {
        const result = await completeTask(
          tx,
          tenantId,
          actor,
          id,
          prepared.input
        );
        if (result.outcome !== "completed" && result.outcome !== "cancelled") {
          // Every non-success outcome has a refusal.
          return taskCloseRefusal(result)!;
        }

        await auditCrmFollowUp(context, {
          action: "crm_follow_up.task.complete",
          resourceType: "crm_follow_up_task",
          resourceId: id,
          severity: "info",
          message: "Follow-up task completed.",
          attributes: { outcome: prepared.input.outcome }
        });

        return { status: 200, body: result.task };
      }
    );
  }
});
