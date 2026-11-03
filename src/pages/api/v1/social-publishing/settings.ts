import { ok } from "../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../modules/_shared/tenant-route";
import {
  auditPublishing,
  disabledResponse,
  mutationRefusal,
  readIdempotencyKey,
  readJson,
  runIdempotent,
  validationFailure
} from "../../../../modules/social-publishing/application/route-support";
import {
  fetchSettings,
  updateSettings
} from "../../../../modules/social-publishing/application/settings-directory";
import { SOCIAL_PUBLISHING_GUARDS } from "../../../../modules/social-publishing/domain/social-publishing-constants";
import {
  validateSettingsPatch,
  type SettingsPatch
} from "../../../../modules/social-publishing/domain/social-publishing-validation";

/**
 * `GET /api/v1/social-publishing/settings` (Issue #1145) — this tenant's two
 * switches. A tenant that never set them is the safe default: nothing is
 * published automatically and approval is required.
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: SOCIAL_PUBLISHING_GUARDS.rulesRead,
  handler: async (context) => {
    const disabled = disabledResponse();

    if (disabled) return disabled;

    return ok(await fetchSettings(context.tx, context.tenantId));
  }
});

type Prepared = { idempotencyKey: string; patch: SettingsPatch };

/**
 * `PATCH /api/v1/social-publishing/settings` (Issue #1145) — switch automatic
 * publishing and the approval requirement. Prospective: a publication keeps the
 * approval requirement it was created with (`approval_required` is snapshotted on
 * the row), so turning approval OFF does not release anything already waiting.
 * High-risk (`configure`): `Idempotency-Key`, audited at `warning` with the
 * previous and the new values.
 */
export const PATCH = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) return idempotencyKey;

    const body = await readJson(request);

    if (body instanceof Response) return body;

    const patch = validateSettingsPatch(body);

    return patch.valid
      ? { idempotencyKey, patch: patch.value }
      : validationFailure(patch.errors);
  },
  authorize: SOCIAL_PUBLISHING_GUARDS.settingsConfigure,
  handler: async (context) => {
    const refused = mutationRefusal(context.auth);

    if (refused) return refused;

    const { tx, tenantId, auth, prepared } = context;
    const actor = auth.context.tenantUserId;

    return runIdempotent(
      tx,
      tenantId,
      "social_publishing_settings_patch",
      prepared.idempotencyKey,
      actor,
      prepared.patch,
      async () => {
        const { previous, current } = await updateSettings(
          tx,
          tenantId,
          actor,
          prepared.patch
        );

        await auditPublishing(context, {
          action: "social_publishing.settings.configure",
          resourceType: "social_publishing_settings",
          resourceId: null,
          severity: "warning",
          message: "Social publishing settings changed.",
          attributes: {
            previousAutoPublishEnabled: previous.autoPublishEnabled,
            autoPublishEnabled: current.autoPublishEnabled,
            previousApprovalRequired: previous.approvalRequired,
            approvalRequired: current.approvalRequired
          }
        });

        return { status: 200, body: current };
      }
    );
  }
});
