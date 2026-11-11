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
import { cancelTask } from "../../../../../../modules/crm-follow-up/application/task-engine";
import { CRM_FOLLOW_UP_GUARDS } from "../../../../../../modules/crm-follow-up/domain/crm-follow-up-constants";
import {
  validateVersioned,
  type VersionedInput
} from "../../../../../../modules/crm-follow-up/domain/crm-follow-up-validation";

/**
 * `POST /api/v1/crm-follow-up/tasks/{id}/cancel` (Issue #1165) — cancel one
 * open or escalated task (`manual_cancel`); its pending notices are cancelled.
 * To stop ALL work on a lead, record a stop signal instead.
 * `Idempotency-Key`, `expectedVersion`, `409 TASK_CLOSED`, audited.
 */
export const POST = defineTenantRoute<{
  idempotencyKey: string;
  input: VersionedInput;
}>({
  workClass: "interactive",
  prepare: ({ request }) => prepareMutation(request, validateVersioned),
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
      "crm_follow_up_task_cancel",
      prepared.idempotencyKey,
      actor,
      { id, ...prepared.input },
      async () => {
        const result = await cancelTask(
          tx,
          tenantId,
          actor,
          id,
          prepared.input.expectedVersion
        );

        if (result.outcome !== "completed" && result.outcome !== "cancelled") {
          // Every non-success outcome has a refusal.
          return taskCloseRefusal(result)!;
        }

        await auditCrmFollowUp(context, {
          action: "crm_follow_up.task.cancel",
          resourceType: "crm_follow_up_task",
          resourceId: id,
          severity: "info",
          message: "Follow-up task cancelled."
        });

        return { status: 200, body: result.task };
      }
    );
  }
});
