import { ok } from "../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../modules/_shared/tenant-route";
import {
  readSettings,
  writeSettings
} from "../../../../modules/hr-workforce/application/hr-workforce-directory";
import {
  readIdempotencyKey,
  readValidatedBody,
  runIdempotent
} from "../../../../modules/hr-workforce/application/hr-workforce-route-support";
import { HR_WORKFORCE_GUARDS } from "../../../../modules/hr-workforce/domain/hr-workforce-permissions";
import {
  validateSettings,
  type SettingsInput
} from "../../../../modules/hr-workforce/domain/hr-workforce-validation";

const SCOPE = "hr_workforce_settings_set";

/**
 * `GET /api/v1/hr-workforce/settings` — the tenant's clock-skew bound and the
 * workflow key an attendance correction starts. There is no evidence, location
 * or photo setting, by construction (owner decision O6).
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: HR_WORKFORCE_GUARDS.settings.read,
  handler: async ({ tx, tenantId }) => ok(await readSettings(tx, tenantId))
});

type Prepared = { idempotencyKey: string; input: SettingsInput };

/**
 * `PUT /api/v1/hr-workforce/settings` — change either setting (an omitted field
 * keeps its value). High-risk `configure`, audited, idempotent.
 */
export const PUT = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) {
      return idempotencyKey;
    }

    const input = await readValidatedBody(request, validateSettings);

    return input instanceof Response ? input : { idempotencyKey, input };
  },
  authorize: HR_WORKFORCE_GUARDS.settings.configure,
  handler: async ({ tx, tenantId, auth, prepared, locals }) =>
    runIdempotent(
      tx,
      tenantId,
      SCOPE,
      prepared.idempotencyKey,
      auth.context.tenantUserId,
      prepared.input,
      async () => ({
        status: 200,
        body: await writeSettings(
          tx,
          tenantId,
          {
            actorTenantUserId: auth.context.tenantUserId,
            correlationId: locals.correlationId
          },
          prepared.input
        )
      })
    )
});
