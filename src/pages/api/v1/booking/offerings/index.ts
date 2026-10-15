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
  createOffering,
  listOfferings
} from "../../../../../modules/booking/application/booking-offering-admin";
import {
  readIdempotencyKey,
  readValidatedBody
} from "../../../../../modules/booking/application/booking-route-support";
import {
  validateCreateOffering,
  type CreateOfferingInput
} from "../../../../../modules/booking/domain/booking-admin-validation";
import { BOOKING_GUARDS } from "../../../../../modules/booking/domain/booking-permissions";

type OfferingListFilterInput = {
  granularity?: "time" | "stay";
  status?: "active" | "inactive";
};

type ListPrepared = Exclude<ReturnType<typeof listPrepared>, Response>;

function listPrepared(url: URL) {
  return parseListQuery(url, (params): OfferingListFilterInput | Response => {
    const granularity = enumParam(params, "granularity", [
      "time",
      "stay"
    ] as const);
    const status = enumParam(params, "status", ["active", "inactive"] as const);

    if (granularity instanceof Response) return granularity;
    if (status instanceof Response) return status;

    return {
      ...(granularity ? { granularity } : {}),
      ...(status ? { status } : {})
    };
  });
}

/**
 * `GET /api/v1/booking/offerings` -- this tenant's service offerings, newest
 * first, keyset paginated (`cursor`). Filters: `granularity` (`time` | `stay`),
 * `status`, and `includeDeleted=true` or `onlyDeleted=true` (soft-deleted rows, which also
 * need `booking.offerings.restore`). An offering
 * holds no price and no product id. Gated by `booking.offerings.read`.
 */
export const GET = defineTenantRoute<ListPrepared>({
  workClass: "interactive",
  prepare: ({ url }) => listPrepared(url),
  authorize: BOOKING_GUARDS.offerings.read,
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
        BOOKING_GUARDS.offerings.restore,
        request,
        clientAddress
      );

      if (!view.allowed) {
        return view.denied;
      }
    }

    return ok(
      await listOfferings(
        tx,
        tenantId,
        prepared.filters,
        prepared.cursor ?? undefined
      )
    );
  }
});

type CreatePrepared = { idempotencyKey: string; input: CreateOfferingInput };

/**
 * `POST /api/v1/booking/offerings` -- create a service offering. A `time`
 * offering needs `durationSeconds` and `slotStepSeconds` (at least 300) and may
 * set buffers; a `stay` offering needs `minNights` and `maxNights` (at most 366)
 * and sends no time field. `maxParty` is at least `minParty`. A duplicate
 * `code` (case-insensitive) is `409 CODE_TAKEN`. Gated by
 * `booking.offerings.create`; `Idempotency-Key` required; audited `info`.
 */
export const POST = defineTenantRoute<CreatePrepared>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) {
      return idempotencyKey;
    }

    const input = await readValidatedBody(request, validateCreateOffering);

    return input instanceof Response ? input : { idempotencyKey, input };
  },
  authorize: BOOKING_GUARDS.offerings.create,
  handler: ({ tx, tenantId, auth, prepared, locals }) =>
    runAdminMutation(
      tx,
      tenantId,
      auth,
      "booking_offering_create",
      prepared.idempotencyKey,
      prepared.input,
      201,
      () => createOffering(tx, tenantId, actorOf(auth, locals), prepared.input),
      (result) => ({ offering: result.offering, replayed: result.replayed })
    )
});
