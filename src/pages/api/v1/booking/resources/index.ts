import { ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  actorOf,
  authorizeDeletedView,
  enumParam,
  parseListQuery,
  runAdminMutation
} from "../../../../../modules/booking/application/booking-admin-routes";
import {
  createResource,
  listResources
} from "../../../../../modules/booking/application/booking-resource-admin";
import {
  asUuid,
  badId,
  readIdempotencyKey,
  readValidatedBody
} from "../../../../../modules/booking/application/booking-route-support";
import {
  validateCreateResource,
  type CreateResourceInput
} from "../../../../../modules/booking/domain/booking-admin-validation";
import { BOOKING_GUARDS } from "../../../../../modules/booking/domain/booking-permissions";

type ResourceListFilterInput = {
  status?: "active" | "inactive";
  bookingMode?: "slot" | "stay";
  poolId?: string;
};

type ListPrepared = Exclude<ReturnType<typeof listPrepared>, Response>;

function listPrepared(url: URL) {
  return parseListQuery(url, (params): ResourceListFilterInput | Response => {
    const status = enumParam(params, "status", ["active", "inactive"] as const);
    const bookingMode = enumParam(params, "bookingMode", [
      "slot",
      "stay"
    ] as const);

    if (status instanceof Response) return status;
    if (bookingMode instanceof Response) return bookingMode;

    const poolId = params.get("poolId");

    if (poolId && !asUuid(poolId)) {
      return badId("poolId");
    }

    return {
      ...(status ? { status } : {}),
      ...(bookingMode ? { bookingMode } : {}),
      ...(poolId ? { poolId: asUuid(poolId)! } : {})
    };
  });
}

/**
 * `GET /api/v1/booking/resources` -- this tenant's resources, newest first,
 * keyset paginated (`cursor`). Filters: `status`, `bookingMode`, `poolId`, and
 * `includeDeleted=true` or `onlyDeleted=true` (soft-deleted rows, which also
 * need `booking.resources.restore`). Each carries `capacity`
 * and `activeUnits`; the units themselves are on the read of one resource.
 * Gated by `booking.resources.read`.
 */
export const GET = defineTenantRoute<ListPrepared>({
  workClass: "interactive",
  prepare: ({ url }) => listPrepared(url),
  authorize: BOOKING_GUARDS.resources.read,
  handler: async ({
    tx,
    tenantId,
    prepared,
    tokenHash,
    now,
    request,
    clientAddress
  }) => {
    if (prepared.filters.deleted !== "exclude") {
      const view = await authorizeDeletedView(
        tx,
        tenantId,
        tokenHash,
        now,
        BOOKING_GUARDS.resources.restore,
        request,
        clientAddress
      );

      if (!view.allowed) {
        return view.denied;
      }
    }

    return ok(
      await listResources(
        tx,
        tenantId,
        prepared.filters,
        prepared.cursor ?? undefined
      )
    );
  }
});

type CreatePrepared = { idempotencyKey: string; input: CreateResourceInput };

/**
 * `POST /api/v1/booking/resources` -- create a resource and its `capacity`
 * units (ordinals 1 to capacity, labelled from `unitLabels`) in one transaction.
 * A stay resource needs `stayCheckInTime` and `stayCheckOutTime`; a slot
 * resource sends neither. `timezone` is an IANA name. A duplicate `code`
 * (case-insensitive) is `409 CODE_TAKEN`, an unknown or deleted `poolId` is
 * `404 POOL_NOT_FOUND`. Gated by `booking.resources.create`;
 * `Idempotency-Key` required (a retry returns the SAME 201 and body); audited
 * `info`.
 */
export const POST = defineTenantRoute<CreatePrepared>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) {
      return idempotencyKey;
    }

    const input = await readValidatedBody(request, validateCreateResource);

    return input instanceof Response ? input : { idempotencyKey, input };
  },
  authorize: BOOKING_GUARDS.resources.create,
  handler: ({ tx, tenantId, auth, prepared, locals }) =>
    runAdminMutation(
      tx,
      tenantId,
      auth,
      "booking_resource_create",
      prepared.idempotencyKey,
      prepared.input,
      201,
      () => createResource(tx, tenantId, actorOf(auth, locals), prepared.input),
      (result) => ({ resource: result.resource, replayed: result.replayed })
    )
});
