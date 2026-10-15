import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  actorOf,
  authorizeDeletedView,
  deletedViewer,
  runAdminMutation
} from "../../../../../modules/booking/application/booking-admin-routes";
import {
  deletePool,
  getPool,
  patchPool
} from "../../../../../modules/booking/application/booking-resource-admin";
import {
  asUuid,
  badId,
  readIdempotencyKey,
  readValidatedBody
} from "../../../../../modules/booking/application/booking-route-support";
import {
  validatePoolPatch,
  type PoolPatchInput
} from "../../../../../modules/booking/domain/booking-admin-validation";
import { BOOKING_GUARDS } from "../../../../../modules/booking/domain/booking-permissions";

/**
 * `GET /api/v1/booking/resource-pools/{id}` -- one pool with its live members
 * (at most 500), a soft-deleted pool included for a holder of `booking.resources.restore`
 * (anyone else gets the neutral 404). An unknown id and another
 * tenant's id are the same `404 POOL_NOT_FOUND`. Gated by
 * `booking.resources.read`.
 */
export const GET = defineTenantRoute<{ id: string }>({
  workClass: "interactive",
  prepare: ({ params }) => {
    const id = asUuid(params.id);

    return id ? { id } : badId();
  },
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
    const pool = await getPool(tx, tenantId, prepared.id);

    // A soft-deleted row is visible only to a holder of `.restore` (the
    // ADR-0128 rule); to anyone else it is the same neutral 404 as an unknown id.
    if (pool && pool.deletedAt !== null) {
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
        return fail(404, "POOL_NOT_FOUND", "Resource pool not found.");
      }
    }

    return pool
      ? ok({ pool })
      : fail(404, "POOL_NOT_FOUND", "Resource pool not found.");
  }
});

type PatchPrepared = {
  id: string;
  idempotencyKey: string;
  patch: PoolPatchInput;
};

/**
 * `PATCH /api/v1/booking/resource-pools/{id}` -- rename a pool (`code` is
 * fixed). `409 POOL_DELETED` for a deleted pool. Gated by
 * `booking.resources.update`; `Idempotency-Key` required; audited `info`.
 */
export const PATCH = defineTenantRoute<PatchPrepared>({
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

    const patch = await readValidatedBody(request, validatePoolPatch);

    return patch instanceof Response ? patch : { id, idempotencyKey, patch };
  },
  authorize: BOOKING_GUARDS.resources.update,
  handler: ({
    tx,
    tenantId,
    auth,
    prepared,
    locals,
    tokenHash,
    now,
    request,
    clientAddress
  }) =>
    runAdminMutation(
      tx,
      tenantId,
      auth,
      "booking_pool_patch",
      prepared.idempotencyKey,
      { id: prepared.id, patch: prepared.patch },
      200,
      () =>
        patchPool(
          tx,
          tenantId,
          actorOf(auth, locals),
          prepared.id,
          prepared.patch,
          deletedViewer(
            tx,
            tenantId,
            tokenHash,
            now,
            BOOKING_GUARDS.resources.restore,
            request,
            clientAddress
          )
        ),
      (result) => ({ pool: result.pool, replayed: result.replayed })
    )
});

/**
 * `DELETE /api/v1/booking/resource-pools/{id}` -- SOFT-delete a pool. Refused
 * with `409 POOL_NOT_EMPTY` while a live resource is a member. Deleting a
 * deleted pool returns it with `replayed: true`. Gated by
 * `booking.resources.delete`; `Idempotency-Key` required; audited `warning`.
 */
export const DELETE = defineTenantRoute<{ id: string; idempotencyKey: string }>(
  {
    workClass: "interactive",
    prepare: ({ request, params }) => {
      const id = asUuid(params.id);

      if (!id) {
        return badId();
      }

      const idempotencyKey = readIdempotencyKey(request);

      return idempotencyKey instanceof Response
        ? idempotencyKey
        : { id, idempotencyKey };
    },
    authorize: BOOKING_GUARDS.resources.delete,
    handler: ({
      tx,
      tenantId,
      auth,
      prepared,
      locals,
      tokenHash,
      now,
      request,
      clientAddress
    }) =>
      runAdminMutation(
        tx,
        tenantId,
        auth,
        "booking_pool_delete",
        prepared.idempotencyKey,
        { id: prepared.id },
        200,
        () =>
          deletePool(
            tx,
            tenantId,
            actorOf(auth, locals),
            prepared.id,
            deletedViewer(
              tx,
              tenantId,
              tokenHash,
              now,
              BOOKING_GUARDS.resources.restore,
              request,
              clientAddress
            )
          ),
        (result) => ({ pool: result.pool, replayed: result.replayed })
      )
  }
);
