import { fail } from "../../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../../modules/_shared/tenant-route";
import { setGeofenceDeleted } from "../../../../../../../modules/hr-workforce/application/hr-location-evidence";
import {
  asUuid,
  badId,
  readIdempotencyKey,
  readValidatedBody,
  runIdempotent
} from "../../../../../../../modules/hr-workforce/application/hr-workforce-route-support";
import { HR_WORKFORCE_GUARDS } from "../../../../../../../modules/hr-workforce/domain/hr-workforce-permissions";
import { validateEmptyBody } from "../../../../../../../modules/hr-workforce/domain/hr-workforce-validation";

type Prepared = { id: string; idempotencyKey: string };

const SCOPE = "hr_workforce_geofence_restore";

/**
 * `POST /api/v1/hr-workforce/geolocation/geofences/{id}/restore` — undo a soft
 * delete (refused 422 while its office is deleted). High-risk, audited,
 * idempotent.
 */
export const POST = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: async ({ request, params }) => {
    const id = asUuid(params.id);

    if (!id) {
      return badId();
    }

    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) {
      return idempotencyKey;
    }

    const body = await readValidatedBody(request, validateEmptyBody);

    return body instanceof Response ? body : { id, idempotencyKey };
  },
  authorize: HR_WORKFORCE_GUARDS.geolocationEvidence.configure,
  handler: async ({ tx, tenantId, auth, prepared, locals }) =>
    runIdempotent(
      tx,
      tenantId,
      SCOPE,
      prepared.idempotencyKey,
      auth.context.tenantUserId,
      { id: prepared.id },
      async () => {
        const result = await setGeofenceDeleted(
          tx,
          tenantId,
          {
            actorTenantUserId: auth.context.tenantUserId,
            correlationId: locals.correlationId
          },
          prepared.id,
          false
        );

        switch (result.outcome) {
          case "ok":
            return { status: 200, body: result.geofence };
          case "already_in_state":
            return fail(
              409,
              "GEOFENCE_NOT_DELETED",
              "The geofence is not deleted."
            );
          case "office_not_found":
            return fail(422, "OFFICE_NOT_FOUND", "Office not found.");
          case "office_limit":
            return fail(
              409,
              "GEOFENCE_OFFICE_LIMIT",
              "An office may have at most 10 live geofences."
            );
          default:
            return fail(404, "RESOURCE_NOT_FOUND", "Geofence not found.");
        }
      }
    )
});
