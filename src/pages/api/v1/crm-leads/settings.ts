import { ok } from "../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../modules/_shared/tenant-route";
import {
  auditCrmLeads,
  disabledResponse,
  mutationRefusal,
  prepareMutation,
  runIdempotent
} from "../../../../modules/crm-leads/application/route-support";
import {
  fetchSettings,
  updateSettings
} from "../../../../modules/crm-leads/application/settings-directory";
import { CRM_LEADS_GUARDS } from "../../../../modules/crm-leads/domain/crm-leads-constants";
import {
  validateSettingsPatch,
  type SettingsPatch
} from "../../../../modules/crm-leads/domain/crm-leads-validation";

/**
 * `GET /api/v1/crm-leads/settings` (Issue #1166) — the tenant switch and the
 * merge-undo window. A tenant that never set them is OFF.
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: CRM_LEADS_GUARDS.readLeads,
  handler: async (context) => {
    const disabled = disabledResponse();

    if (disabled) return disabled;

    return ok(await fetchSettings(context.tx, context.tenantId));
  }
});

/**
 * `PATCH /api/v1/crm-leads/settings` — switch the module on or off for this
 * tenant and set the merge-undo window (1-720 hours). High-risk (`configure`):
 * `Idempotency-Key`, audited at `warning` with the previous and new values.
 */
export const PATCH = defineTenantRoute<{
  idempotencyKey: string;
  input: SettingsPatch;
}>({
  workClass: "interactive",
  prepare: ({ request }) => prepareMutation(request, validateSettingsPatch),
  authorize: CRM_LEADS_GUARDS.configurePipelines,
  handler: async (context) => {
    const refused = mutationRefusal(context.auth);

    if (refused) return refused;

    const { tx, tenantId, auth, prepared } = context;
    const actor = auth.context.tenantUserId;

    return runIdempotent(
      tx,
      tenantId,
      "crm_leads_settings_patch",
      prepared.idempotencyKey,
      actor,
      prepared.input,
      async () => {
        const { previous, current } = await updateSettings(
          tx,
          tenantId,
          actor,
          prepared.input
        );

        await auditCrmLeads(context, {
          action: "crm_leads.settings.configure",
          resourceType: "crm_leads_settings",
          resourceId: null,
          severity: "warning",
          message: "Lead pipeline settings changed.",
          attributes: {
            previousEnabled: previous.enabled,
            enabled: current.enabled,
            previousMergeUndoHours: previous.mergeUndoHours,
            mergeUndoHours: current.mergeUndoHours
          }
        });

        return { status: 200, body: current };
      }
    );
  }
});
