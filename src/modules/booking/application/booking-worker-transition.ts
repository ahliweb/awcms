/**
 * Confirm and cancel as `awcms_worker` (Issue #1278, ADR-0131; booking.md
 * sections 3, 5.1 and 7.4).
 *
 * A consumer that confirms or cancels a reservation from `domain-events:dispatch`
 * runs as the background-job role, which deliberately holds NO privilege on the
 * booking tables (`sql/200`). So `BookingPort.confirm` / `.cancel`, when the
 * connection is that role, go through ONE narrow SECURITY DEFINER function
 * (`awcms_booking_worker_transition`, `sql/388`) instead of
 * `transitionReservation`, following the hold-expiry sweep (`sql/200`, `sql/209`).
 *
 * ## What is shared with the application path, and what is not
 *
 *   * the rule (state table, hold clock, late cancellation, history row) is
 *     written twice, once in the function and once in `transitionReservation`;
 *     `tests/integration/booking-worker-transition.integration.test.ts` runs both
 *     for every status and compares the rows they leave;
 *   * the audit row (`recordTransitionAudit`) and the domain event
 *     (`emitReservationEventFromFacts`) are written ONCE, here and there by the
 *     same functions. The function returns the non-personal event facts, as the
 *     sweep does, and the worker may already write the audit table and the outbox.
 *
 * Only `confirm` and `cancel` are offered. The function refuses every other verb,
 * and this file never asks for one.
 */
import { asUuid } from "../domain/booking-validation";
import { parseReservationFacts } from "../domain/booking-reservation-events";
import {
  databaseNowIso,
  emitReservationEventFromFacts
} from "./booking-event-emit";
import {
  recordTransitionAudit,
  type ReservationContext,
  type ServiceRefusal,
  type TransitionAction
} from "./booking-reservation-service";
import type { ReservationView } from "./booking-reservation-directory";

type Sql = Bun.SQL;

/** The role whose connection takes the function path. Fixed by `sql/022`. */
export const WORKER_ROLE_NAME = "awcms_worker";

/** The verbs the worker path offers; anything else keeps the application path. */
export function isWorkerTransitionAction(
  action: TransitionAction
): action is "confirm" | "cancel" {
  return action === "confirm" || action === "cancel";
}

/**
 * Is this transaction running as the background-job role? `current_user` (not
 * `session_user`): the function path is chosen by the privileges the statements
 * would run with. A transaction as any other role (the runtime role, the owner
 * in a single-role deployment) keeps `transitionReservation`.
 */
export async function isWorkerConnection(tx: Sql): Promise<boolean> {
  const rows = (await tx`SELECT current_user::text AS role`) as {
    role: string;
  }[];

  return rows[0]?.role === WORKER_ROLE_NAME;
}

export type WorkerTransitionOutcome =
  | {
      outcome: "ok";
      reservation: Pick<ReservationView, "id" | "status" | "holdExpiresAt">;
      replayed: boolean;
    }
  | { outcome: "not_found" }
  | ServiceRefusal;

type FunctionRow = {
  out_outcome: string;
  out_previous_status: string | null;
  out_status: string | null;
  out_hold_expires_at: string | null;
  out_reservation_no: string | null;
  out_late_cancellation: boolean;
  out_released_allocations: number;
  out_event_facts: unknown;
};

function refusal(
  code: "INVALID_STATE" | "HOLD_EXPIRED",
  message: string
): ServiceRefusal {
  return { outcome: "refused", code, message, httpStatus: 409 };
}

/**
 * `confirm` or `cancel` through `awcms_booking_worker_transition`. Runs in the
 * caller's tenant transaction (`withTenant*`, which sets the context the function
 * checks the tenant argument against).
 */
export async function workerTransitionReservation(
  tx: Sql,
  ctx: ReservationContext,
  reservationId: string,
  action: "confirm" | "cancel",
  input: { reasonCode?: string | null } = {}
): Promise<WorkerTransitionOutcome> {
  const reservation = asUuid(reservationId);

  // A malformed id is the same neutral answer as an unknown one, never a 22P02.
  if (reservation === null) {
    return { outcome: "not_found" };
  }

  const reasonCode = action === "cancel" ? (input.reasonCode ?? null) : null;
  const rows = (await tx`
    SELECT out_outcome, out_previous_status, out_status, out_hold_expires_at,
           out_reservation_no, out_late_cancellation,
           out_released_allocations, out_event_facts
    FROM awcms_booking_worker_transition(
      ${ctx.tenantId}::uuid, ${reservation}::uuid, ${action}::text,
      ${ctx.actorTenantUserId}::uuid,
      ${asUuid(ctx.correlationId) ?? null}::uuid,
      ${reasonCode}::text
    )
  `) as FunctionRow[];
  const row = rows[0];

  if (!row) {
    throw new Error("booking: the worker transition function returned no row");
  }

  switch (row.out_outcome) {
    case "not_found":
      return { outcome: "not_found" };
    case "hold_expired":
      return refusal("HOLD_EXPIRED", "The hold has expired.");
    case "invalid_state":
      return refusal(
        "INVALID_STATE",
        `Cannot ${action} a reservation that is ${row.out_previous_status}.`
      );
    case "replayed":
    case "ok":
      break;
    default:
      throw new Error(
        `booking: unexpected worker transition outcome ${row.out_outcome}`
      );
  }

  const status = row.out_status as ReservationView["status"];
  const view = {
    id: reservation,
    status,
    holdExpiresAt: row.out_hold_expires_at
  };

  if (row.out_outcome === "replayed") {
    return { outcome: "ok", reservation: view, replayed: true };
  }

  const facts = parseReservationFacts(row.out_event_facts);
  const lateCancellation = row.out_late_cancellation;

  await recordTransitionAudit(tx, ctx, {
    action,
    reservationId: reservation,
    reservationNo: row.out_reservation_no ?? facts.reservationNo,
    fromStatus: row.out_previous_status ?? "",
    toStatus: status,
    lateCancellation,
    releasedAllocations: Number(row.out_released_allocations)
  });

  await emitReservationEventFromFacts(tx, ctx.tenantId, facts, {
    kind: action === "confirm" ? "confirmed" : "cancelled",
    status: status as "confirmed" | "cancelled",
    previousStatus: row.out_previous_status as "held" | "confirmed",
    occurredAt: await databaseNowIso(tx),
    correlationId: ctx.correlationId ?? null,
    actorTenantUserId: ctx.actorTenantUserId,
    ...(action === "cancel" ? { lateCancellation } : {})
  });

  return { outcome: "ok", reservation: view, replayed: false };
}
