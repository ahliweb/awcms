import { ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  actorOf,
  authorizeDeletedView,
  parseListQuery,
  runAdminMutation
} from "../../../../../modules/booking/application/booking-admin-routes";
import {
  createPool,
  listPools
} from "../../../../../modules/booking/application/booking-resource-admin";
import {
  readIdempotencyKey,
  readValidatedBody
} from "../../../../../modules/booking/application/booking-route-support";
import {
  validateCreatePool,
  type CreatePoolInput
} from "../../../../../modules/booking/domain/booking-admin-validation";
import { BOOKING_GUARDS } from "../../../../../modules/booking/domain/booking-permissions";

type ListPrepared = Exclude<ReturnType<typeof listPrepared>, Response>;

function listPrepared(url: URL) {
  return parseListQuery(url, () => ({}));
}

/**
 * `GET /api/v1/booking/resource-pools` -- this tenant's resource pools, newest
 * first, keyset paginated (`cursor`); `includeDeleted=true` or `onlyDeleted=true` shows
 * soft-deleted pools to a holder of `booking.resources.restore`. Each carries its live `memberCount`. Pools are gated by the
 * `resources` permissions: `booking.resources.read`.
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
      await listPools(
        tx,
        tenantId,
        prepared.filters,
        prepared.cursor ?? undefined
      )
    );
  }
});

type CreatePrepared = { idempotencyKey: string; input: CreatePoolInput };

/**
 * `POST /api/v1/booking/resource-pools` -- create a pool of interchangeable
 * resources. A resource joins a pool through its own `poolId`. A duplicate `code`
 * (case-insensitive) is `409 CODE_TAKEN`. Gated by `booking.resources.create`;
 * `Idempotency-Key` required; audited `info`.
 */
export const POST = defineTenantRoute<CreatePrepared>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) {
      return idempotencyKey;
    }

    const input = await readValidatedBody(request, validateCreatePool);

    return input instanceof Response ? input : { idempotencyKey, input };
  },
  authorize: BOOKING_GUARDS.resources.create,
  handler: ({ tx, tenantId, auth, prepared, locals }) =>
    runAdminMutation(
      tx,
      tenantId,
      auth,
      "booking_pool_create",
      prepared.idempotencyKey,
      prepared.input,
      201,
      () => createPool(tx, tenantId, actorOf(auth, locals), prepared.input),
      (result) => ({ pool: result.pool, replayed: result.replayed })
    )
});
