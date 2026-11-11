import { ok } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import {
  asUuid,
  auditCrmFollowUp,
  badId,
  disabledResponse,
  mutationRefusal,
  prepareMutation,
  runIdempotent,
  tenantDisabledResponse
} from "../../../../../../modules/crm-follow-up/application/route-support";
import { listStopSignals } from "../../../../../../modules/crm-follow-up/application/task-directory";
import { recordStopSignal } from "../../../../../../modules/crm-follow-up/application/task-engine";
import { CRM_FOLLOW_UP_GUARDS } from "../../../../../../modules/crm-follow-up/domain/crm-follow-up-constants";
import {
  validateStopSignal,
  type StopSignalInput
} from "../../../../../../modules/crm-follow-up/domain/crm-follow-up-validation";

/**
 * `GET /api/v1/crm-follow-up/leads/{leadId}/stop-signals` (Issue #1165) — the
 * lead's stop signals, oldest first. An unknown lead id answers an empty list:
 * this module holds no lead copy, so it cannot tell "no such lead" from "no
 * stop" (and must not become an existence oracle for `crm_leads`).
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: CRM_FOLLOW_UP_GUARDS.readTasks,
  handler: async (context) => {
    const disabled = disabledResponse();

    if (disabled) return disabled;

    const leadId = asUuid(context.params.leadId);

    if (!leadId) return badId("leadId");

    return ok({
      items: await listStopSignals(context.tx, context.tenantId, leadId)
    });
  }
});

/**
 * `POST /api/v1/crm-follow-up/leads/{leadId}/stop-signals` (Issue #1165,
 * ADR-0159 section 5) — record that follow-up must STOP for this lead
 * (`reply_received`, `consent_withdrawn`, `sender_blocked`, `manual`; the
 * `converted`, `lost` and `merged` kinds come from lead events only). Cancels
 * every open or escalated task of the lead and their pending notices, and no
 * task is created for the lead afterwards. The answer reports how many notices
 * had ALREADY been handed to the e-mail outbox (never claimed to be recalled).
 * High-risk: `Idempotency-Key`, audited at warning.
 */
export const POST = defineTenantRoute<{
  idempotencyKey: string;
  input: StopSignalInput;
}>({
  workClass: "interactive",
  prepare: ({ request }) => prepareMutation(request, validateStopSignal),
  authorize: CRM_FOLLOW_UP_GUARDS.createStopSignals,
  handler: async (context) => {
    const refused = mutationRefusal(context.auth);

    if (refused) return refused;

    const leadId = asUuid(context.params.leadId);

    if (!leadId) return badId("leadId");

    const { tx, tenantId, auth, prepared } = context;
    const tenantOff = await tenantDisabledResponse(tx, tenantId);

    if (tenantOff) return tenantOff;

    const actor = auth.context.tenantUserId;

    return runIdempotent(
      tx,
      tenantId,
      "crm_follow_up_stop_signal",
      prepared.idempotencyKey,
      actor,
      {
        leadId,
        kind: prepared.input.kind,
        occurredAt: prepared.input.occurredAt?.toISOString() ?? null
      },
      async () => {
        const result = await recordStopSignal(tx, tenantId, {
          leadId,
          kind: prepared.input.kind,
          source: "staff",
          sourceEventId: null,
          recordedBy: actor,
          occurredAt: prepared.input.occurredAt ?? context.now
        });

        await auditCrmFollowUp(context, {
          action: "crm_follow_up.stop_signal.create",
          resourceType: "crm_follow_up_lead",
          resourceId: leadId,
          severity: "warning",
          message: "Follow-up stop signal recorded.",
          attributes: {
            kind: prepared.input.kind,
            cancelledTasks: result.cancelledTaskIds.length,
            cancelledNotifications: result.cancelledNotifications,
            alreadyEnqueuedNotifications: result.alreadyEnqueuedNotifications
          }
        });

        return {
          status: 201,
          body: {
            signalId: result.signalId,
            leadId,
            kind: prepared.input.kind,
            cancelledTaskIds: result.cancelledTaskIds,
            cancelledNotifications: result.cancelledNotifications,
            alreadyEnqueuedNotifications: result.alreadyEnqueuedNotifications
          }
        };
      }
    );
  }
});
