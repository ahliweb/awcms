import { ok } from "../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../modules/_shared/tenant-route";
import {
  auditCrmFollowUp,
  disabledResponse,
  mutationRefusal,
  prepareMutation,
  runIdempotent
} from "../../../../modules/crm-follow-up/application/route-support";
import {
  fetchSettings,
  updateSettings
} from "../../../../modules/crm-follow-up/application/settings-directory";
import { CRM_FOLLOW_UP_GUARDS } from "../../../../modules/crm-follow-up/domain/crm-follow-up-constants";
import {
  validateSettingsPatch,
  type SettingsPatch
} from "../../../../modules/crm-follow-up/domain/crm-follow-up-validation";

/**
 * `GET /api/v1/crm-follow-up/settings` (Issue #1165) — the tenant switch and
 * the per-recipient hourly notice cap. A tenant that never set them is OFF.
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: CRM_FOLLOW_UP_GUARDS.readRules,
  handler: async (context) => {
    const disabled = disabledResponse();

    if (disabled) return disabled;

    return ok(await fetchSettings(context.tx, context.tenantId));
  }
});

/**
 * `PATCH /api/v1/crm-follow-up/settings` — switch the module on or off for
 * this tenant and set the hourly cap (1-200). High-risk (`configure`):
 * `Idempotency-Key`, audited at `warning` with the previous and new values.
 */
export const PATCH = defineTenantRoute<{
  idempotencyKey: string;
  input: SettingsPatch;
}>({
  workClass: "interactive",
  prepare: ({ request }) => prepareMutation(request, validateSettingsPatch),
  authorize: CRM_FOLLOW_UP_GUARDS.configureRules,
  handler: async (context) => {
    const refused = mutationRefusal(context.auth);

    if (refused) return refused;

    const { tx, tenantId, auth, prepared } = context;
    const actor = auth.context.tenantUserId;

    return runIdempotent(
      tx,
      tenantId,
      "crm_follow_up_settings_patch",
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

        await auditCrmFollowUp(context, {
          action: "crm_follow_up.settings.configure",
          resourceType: "crm_follow_up_settings",
          resourceId: null,
          severity: "warning",
          message: "Follow-up settings changed.",
          attributes: {
            previousEnabled: previous.enabled,
            enabled: current.enabled,
            previousMaxNoticesPerRecipientHour:
              previous.maxNoticesPerRecipientHour,
            maxNoticesPerRecipientHour: current.maxNoticesPerRecipientHour
          }
        });

        return { status: 200, body: current };
      }
    );
  }
});
