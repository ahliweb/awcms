import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { authorizeInTransaction } from "../../../../../modules/identity-access/application/access-guard";
import {
  readGeolocationSettings,
  writeGeolocationSettings
} from "../../../../../modules/hr-workforce/application/hr-location-evidence";
import {
  readIdempotencyKey,
  readValidatedBody,
  runIdempotent
} from "../../../../../modules/hr-workforce/application/hr-workforce-route-support";
import { HR_WORKFORCE_GUARDS } from "../../../../../modules/hr-workforce/domain/hr-workforce-permissions";
import {
  validateGeolocationSettings,
  type GeolocationSettingsInput
} from "../../../../../modules/hr-workforce/domain/hr-geolocation-validation";

/**
 * `GET /api/v1/hr-workforce/geolocation/settings` — the tenant's geolocation
 * evidence switch (FALSE until an authorised person enables it), accuracy
 * ceiling, DPIA reference and current notice version. Needs
 * `hr_workforce.geolocation_evidence.configure`. `no-store`.
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: HR_WORKFORCE_GUARDS.geolocationEvidence.configure,
  handler: async ({ tx, tenantId }) =>
    ok(
      await readGeolocationSettings(tx, tenantId),
      {},
      { "cache-control": "no-store" }
    )
});

type Prepared = { idempotencyKey: string; input: GeolocationSettingsInput };

const SCOPE = "hr_workforce_geolocation_settings_set";

/**
 * `PUT /api/v1/hr-workforce/geolocation/settings` — switch geolocation
 * attendance evidence on or off (ADR-0138 section 3).
 *
 * ENABLING needs `hr_workforce.geolocation_evidence.configure` (never seeded to a
 * default role) AND, in the resulting state, a DPIA reference + date, a published
 * notice and at least one live geofence: otherwise 403, or 409
 * `GEOLOCATION_DPIA_REQUIRED` / `GEOLOCATION_NOTICE_REQUIRED` /
 * `GEOLOCATION_GEOFENCE_REQUIRED`. DISABLING has no precondition, and a holder of
 * the ordinary `hr_workforce.settings.configure` may do exactly that (a bare
 * `{ "enabled": false }`), so switching it off can never be blocked by who holds
 * the dedicated permission. Both directions are audited at `critical` severity
 * with the before / after STATE and the actor, never a location. Idempotent.
 */
export const PUT = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) {
      return idempotencyKey;
    }

    const input = await readValidatedBody(request, validateGeolocationSettings);

    return input instanceof Response ? input : { idempotencyKey, input };
  },
  authorize: [
    HR_WORKFORCE_GUARDS.geolocationEvidence.configure,
    HR_WORKFORCE_GUARDS.settings.configure
  ],
  handler: async ({ tx, tenantId, auth, prepared, locals, tokenHash, now }) => {
    const { input } = prepared;
    const bareDisable =
      !input.enabled &&
      input.accuracyCeilingMeters === null &&
      input.dpiaReference === undefined &&
      input.dpiaRecordedOn === undefined &&
      input.noticeId === undefined;

    // Anything but a bare "switch it off" needs the dedicated permission.
    if (!bareDisable) {
      const dedicated = await authorizeInTransaction(
        tx,
        tenantId,
        tokenHash,
        now,
        HR_WORKFORCE_GUARDS.geolocationEvidence.configure
      );

      if (!dedicated.allowed) {
        return dedicated.denied;
      }
    }

    return runIdempotent(
      tx,
      tenantId,
      SCOPE,
      prepared.idempotencyKey,
      auth.context.tenantUserId,
      input,
      async () => {
        const result = await writeGeolocationSettings(
          tx,
          tenantId,
          {
            actorTenantUserId: auth.context.tenantUserId,
            correlationId: locals.correlationId
          },
          input
        );

        if (result.outcome === "ok") {
          return { status: 200, body: result.settings };
        }

        switch (result.reason) {
          case "dpia_required":
            return fail(
              409,
              "GEOLOCATION_DPIA_REQUIRED",
              "Enabling needs a reference to the tenant's data-protection impact assessment (dpiaReference and dpiaRecordedOn)."
            );
          case "notice_required":
            return fail(
              409,
              "GEOLOCATION_NOTICE_REQUIRED",
              "Enabling needs a published notice version (noticeId)."
            );
          case "geofence_required":
            return fail(
              409,
              "GEOLOCATION_GEOFENCE_REQUIRED",
              "Enabling needs at least one geofence."
            );
          case "notice_not_found":
            return fail(
              422,
              "NOTICE_NOT_FOUND",
              "noticeId does not name a notice version of this tenant."
            );
        }
      }
    );
  }
});
