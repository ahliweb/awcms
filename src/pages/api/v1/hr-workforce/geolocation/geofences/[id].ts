import { fail } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import {
  replaceGeofence,
  setGeofenceDeleted
} from "../../../../../../modules/hr-workforce/application/hr-location-evidence";
import {
  asUuid,
  badId,
  readIdempotencyKey,
  readValidatedBody,
  runIdempotent
} from "../../../../../../modules/hr-workforce/application/hr-workforce-route-support";
import { HR_WORKFORCE_GUARDS } from "../../../../../../modules/hr-workforce/domain/hr-workforce-permissions";
import {
  validateGeofence,
  type GeofenceInput
} from "../../../../../../modules/hr-workforce/domain/hr-geolocation-validation";
import { validateEmptyBody } from "../../../../../../modules/hr-workforce/domain/hr-workforce-validation";

type ReplacePrepared = {
  id: string;
  idempotencyKey: string;
  input: GeofenceInput;
};

const REPLACE_SCOPE = "hr_workforce_geofence_replace";

/**
 * `PUT /api/v1/hr-workforce/geolocation/geofences/{id}` — replace a live
 * geofence's label, office and geometry. Evidence already recorded keeps naming
 * this geofence (it cannot be re-evaluated: no coordinate was kept). High-risk
 * `configure`, audited with ids only, idempotent.
 */
export const PUT = defineTenantRoute<ReplacePrepared>({
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

    const input = await readValidatedBody(request, validateGeofence);

    return input instanceof Response ? input : { id, idempotencyKey, input };
  },
  authorize: HR_WORKFORCE_GUARDS.geolocationEvidence.configure,
  handler: async ({ tx, tenantId, auth, prepared, locals }) =>
    runIdempotent(
      tx,
      tenantId,
      REPLACE_SCOPE,
      prepared.idempotencyKey,
      auth.context.tenantUserId,
      { id: prepared.id, ...prepared.input },
      async () => {
        const result = await replaceGeofence(
          tx,
          tenantId,
          {
            actorTenantUserId: auth.context.tenantUserId,
            correlationId: locals.correlationId
          },
          prepared.id,
          prepared.input
        );

        switch (result.outcome) {
          case "ok":
            return { status: 200, body: result.geofence };
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

type DeletePrepared = { id: string; idempotencyKey: string };

const DELETE_SCOPE = "hr_workforce_geofence_delete";

/**
 * `DELETE /api/v1/hr-workforce/geolocation/geofences/{id}` — SOFT delete (a
 * verdict that names the geofence keeps its reference). High-risk, audited,
 * idempotent.
 */
export const DELETE = defineTenantRoute<DeletePrepared>({
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
      DELETE_SCOPE,
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
          true
        );

        switch (result.outcome) {
          case "ok":
            return { status: 200, body: result.geofence };
          case "already_in_state":
            return fail(
              409,
              "GEOFENCE_ALREADY_DELETED",
              "The geofence is already deleted."
            );
          case "last_live_fence":
            return fail(
              409,
              "GEOFENCE_LAST_WHILE_ENABLED",
              "Geolocation evidence is enabled and this is the last live geofence; switch it off first."
            );
          default:
            return fail(404, "RESOURCE_NOT_FOUND", "Geofence not found.");
        }
      }
    )
});
