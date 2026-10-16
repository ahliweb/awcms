/**
 * The handler body shared by the five in-place transition routes (Issue #941):
 * `confirm`, `cancel`, `check-in`, `check-out` and `no-show`. Each route file
 * still calls `defineTenantRoute` itself (so `api:tenant-route:check` and the
 * permission-enforcement scan read the guard where it sits); only the identical
 * body below is shared, so the five cannot drift into different answers for the
 * same refusal.
 *
 * ## The order, and why
 *
 *   1. the route has ALREADY authorised the verb's permission (default deny) and
 *      validated the body and the header, before any database work;
 *   2. `runIdempotent`: a stored response for this key (and this acting user and
 *      this request) is returned byte for byte, a reused key with a different
 *      request is `409 IDEMPOTENCY_CONFLICT`;
 *   3. the transition: a refusal is returned as a value and stored nowhere, a
 *      success is stored with its status.
 */
import { NO_OP_STAFF_AVAILABILITY } from "../domain/booking-staff-availability";
import type { AuthorizedAccess } from "../../_shared/tenant-route";
import {
  transitionReservation,
  type TransitionAction
} from "./booking-reservation-service";
import {
  refusalResponse,
  reservationNotFound,
  runIdempotent
} from "./booking-route-support";

export type TransitionRouteInput = {
  id: string;
  idempotencyKey: string;
  /** Only `cancel` has input: its short reason code. */
  reasonCode?: string | null;
};

export async function runTransitionRoute(
  tx: Bun.TransactionSQL,
  tenantId: string,
  auth: AuthorizedAccess,
  locals: { correlationId?: string },
  scope: string,
  action: TransitionAction,
  input: TransitionRouteInput
): Promise<Response> {
  const actor = auth.context.tenantUserId;

  return runIdempotent(
    tx,
    tenantId,
    scope,
    input.idempotencyKey,
    actor,
    { id: input.id, reasonCode: input.reasonCode ?? null },
    async () => {
      const result = await transitionReservation(
        tx,
        {
          tenantId,
          actorTenantUserId: actor,
          // A transition claims nothing: no staff constraint is intended.
          staff: NO_OP_STAFF_AVAILABILITY,
          ...(locals.correlationId
            ? { correlationId: locals.correlationId }
            : {})
        },
        input.id,
        action,
        { reasonCode: input.reasonCode ?? null }
      );

      switch (result.outcome) {
        case "not_found":
          return reservationNotFound();
        case "refused":
          return refusalResponse(result);
        case "ok":
          return {
            status: 200,
            body: { reservation: result.reservation, replayed: result.replayed }
          };
      }
    }
  );
}
