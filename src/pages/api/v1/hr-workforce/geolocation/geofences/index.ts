import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import {
  createGeofence,
  listGeofences
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

type ListPrepared = { officeId?: string; includeDeleted: boolean };

/**
 * `GET /api/v1/hr-workforce/geolocation/geofences` — the tenant's work-site
 * geofences (`?officeId=`, `?includeDeleted=true`). A geofence is a place of
 * business, not a person. Needs `hr_workforce.geolocation_evidence.configure`.
 */
export const GET = defineTenantRoute<ListPrepared>({
  workClass: "interactive",
  prepare: ({ url }) => {
    const officeId = url.searchParams.get("officeId");
    const includeDeleted = url.searchParams.get("includeDeleted");

    if (officeId && !asUuid(officeId)) {
      return badId("officeId");
    }

    if (
      includeDeleted &&
      includeDeleted !== "true" &&
      includeDeleted !== "false"
    ) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "includeDeleted must be true or false."
      );
    }

    return {
      officeId: officeId ? asUuid(officeId)! : undefined,
      includeDeleted: includeDeleted === "true"
    };
  },
  authorize: HR_WORKFORCE_GUARDS.geolocationEvidence.configure,
  handler: async ({ tx, tenantId, prepared }) =>
    ok({ geofences: await listGeofences(tx, tenantId, prepared) })
});

type CreatePrepared = { idempotencyKey: string; input: GeofenceInput };

const SCOPE = "hr_workforce_geofence_create";

/**
 * `POST /api/v1/hr-workforce/geolocation/geofences` — define an authorised work
 * site: a circle (`latitude`, `longitude`, `radiusMeters`) or a small polygon
 * (3-32 `[latitude, longitude]` vertices) attached to an office. High-risk
 * `configure`, audited with ids only, idempotent.
 */
export const POST = defineTenantRoute<CreatePrepared>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) {
      return idempotencyKey;
    }

    const input = await readValidatedBody(request, validateGeofence);

    return input instanceof Response ? input : { idempotencyKey, input };
  },
  authorize: HR_WORKFORCE_GUARDS.geolocationEvidence.configure,
  handler: async ({ tx, tenantId, auth, prepared, locals }) =>
    runIdempotent(
      tx,
      tenantId,
      SCOPE,
      prepared.idempotencyKey,
      auth.context.tenantUserId,
      prepared.input,
      async () => {
        const result = await createGeofence(
          tx,
          tenantId,
          {
            actorTenantUserId: auth.context.tenantUserId,
            correlationId: locals.correlationId
          },
          prepared.input
        );

        if (result.outcome === "ok") {
          return { status: 201, body: result.geofence };
        }

        if (result.outcome === "office_limit") {
          return fail(
            409,
            "GEOFENCE_OFFICE_LIMIT",
            "An office may have at most 10 live geofences."
          );
        }

        return fail(422, "OFFICE_NOT_FOUND", "Office not found.");
      }
    )
});
