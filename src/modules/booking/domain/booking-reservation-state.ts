/**
 * The `booking` reservation state machine as a PURE function (Issue #937,
 * ADR-0131; docs/awcms/booking.md section 3).
 *
 * No I/O, no clock of its own: the caller passes `now` (the DATABASE clock, per
 * section 5.1) and the hold expiry. The same rules are enforced a second time by
 * the `awcms_booking_reservations_update_guard` trigger (sql/180), so a handler
 * that forgets this function still cannot commit an illegal transition; this
 * function is what lets a handler REFUSE with the right code instead of
 * surfacing a raw trigger error. `tests/integration/booking-database.integration.test.ts`
 * asserts the two agree for every state pair.
 *
 * Payment state is not modelled: a reservation is a claim on capacity, and a
 * commerce adapter decides when to ask for a confirm.
 */
export const RESERVATION_STATUSES = [
  "held",
  "confirmed",
  "checked_in",
  "completed",
  "cancelled",
  "rescheduled",
  "no_show",
  "expired"
] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

/** The verbs that move a reservation. `create` is not one: it has no `from`. */
export const RESERVATION_ACTIONS = [
  "extend",
  "confirm",
  "expire",
  "cancel",
  "reschedule",
  "check_in",
  "complete",
  "no_show"
] as const;
export type ReservationAction = (typeof RESERVATION_ACTIONS)[number];

export const TERMINAL_RESERVATION_STATUSES: readonly ReservationStatus[] = [
  "completed",
  "cancelled",
  "rescheduled",
  "no_show",
  "expired"
];

/** Event kinds appended to the history table (a `created` row has no `from`). */
export const RESERVATION_EVENT_KINDS = [
  "created",
  "held",
  "confirmed",
  "rescheduled",
  "cancelled",
  "checked_in",
  "completed",
  "no_show",
  "expired"
] as const;
export type ReservationEventKind = (typeof RESERVATION_EVENT_KINDS)[number];

export type AllocationEffect = "keep" | "release";

type TransitionRule = {
  from: readonly ReservationStatus[];
  to: ReservationStatus;
  /** What happens to the reservation's live allocations. */
  allocations: AllocationEffect;
  /** Why they are released (the `released_reason` value) when `release`. */
  releasedReason?: "cancelled" | "expired" | "rescheduled";
  /** The history event kind this transition appends; `null` for an extension (no status change). */
  eventKind: ReservationEventKind | null;
  /** The permission action (`booking.reservations.<action>`) it requires; `null` = system. */
  permissionAction: string | null;
  severity: "info" | "warning";
};

/**
 * The whole legal table. Anything not here is `INVALID_STATE`. Mirrors the
 * transition table of booking.md section 3 row for row.
 */
export const RESERVATION_TRANSITIONS: Readonly<
  Record<ReservationAction, TransitionRule>
> = {
  extend: {
    from: ["held"],
    to: "held",
    allocations: "keep",
    eventKind: null,
    permissionAction: "create",
    severity: "info"
  },
  confirm: {
    from: ["held"],
    to: "confirmed",
    allocations: "keep",
    eventKind: "confirmed",
    permissionAction: "confirm",
    severity: "info"
  },
  expire: {
    from: ["held"],
    to: "expired",
    allocations: "release",
    releasedReason: "expired",
    eventKind: "expired",
    permissionAction: null,
    severity: "info"
  },
  cancel: {
    from: ["held", "confirmed"],
    to: "cancelled",
    allocations: "release",
    releasedReason: "cancelled",
    eventKind: "cancelled",
    permissionAction: "cancel",
    severity: "warning"
  },
  reschedule: {
    from: ["confirmed"],
    to: "rescheduled",
    allocations: "release",
    releasedReason: "rescheduled",
    eventKind: "rescheduled",
    permissionAction: "reschedule",
    severity: "warning"
  },
  check_in: {
    from: ["confirmed"],
    to: "checked_in",
    allocations: "keep",
    eventKind: "checked_in",
    permissionAction: "check_in",
    severity: "info"
  },
  complete: {
    from: ["checked_in"],
    to: "completed",
    allocations: "keep",
    eventKind: "completed",
    permissionAction: "complete",
    severity: "info"
  },
  no_show: {
    from: ["confirmed"],
    to: "no_show",
    allocations: "keep",
    eventKind: "no_show",
    permissionAction: "no_show",
    severity: "warning"
  }
};

export type TransitionRefusalCode = "INVALID_STATE" | "HOLD_EXPIRED";

export type TransitionResult =
  | {
      ok: true;
      to: ReservationStatus;
      allocations: AllocationEffect;
      releasedReason: "cancelled" | "expired" | "rescheduled" | null;
      eventKind: ReservationEventKind | null;
      permissionAction: string | null;
      severity: "info" | "warning";
      /** `confirm` clears the hold expiry; no other transition does. */
      clearsHoldExpiry: boolean;
    }
  | {
      ok: false;
      code: TransitionRefusalCode;
      message: string;
      /** Both refusals are HTTP 409 (booking.md section 3). */
      httpStatus: 409;
    };

export type TransitionInput = {
  from: ReservationStatus;
  action: ReservationAction;
  /** The database clock. Required for `held` reservations. */
  now: Date;
  /** The hold's expiry (`hold_expires_at`); `null` once confirmed. */
  holdExpiresAt: Date | null;
  /**
   * Whether the hold has elapsed, decided by the DATABASE in the statement that
   * locked the row (`hold_expires_at <= clock_timestamp()`). When given it wins
   * over comparing `holdExpiresAt` with `now`: a JS `Date` holds milliseconds
   * and the column microseconds, so a comparison in the same millisecond could
   * disagree with the trigger that is the final authority.
   */
  holdElapsed?: boolean;
};

/**
 * Decide a transition. A confirm of an expired hold is `HOLD_EXPIRED` even when
 * the sweep job has not run (the lazy-reclaim rule of section 5.1); an expire of
 * a hold that has NOT yet passed its expiry is `INVALID_STATE` (only an elapsed
 * hold may be reclaimed).
 */
export function evaluateTransition(input: TransitionInput): TransitionResult {
  const rule = RESERVATION_TRANSITIONS[input.action];
  if (!rule.from.includes(input.from)) {
    return {
      ok: false,
      code: "INVALID_STATE",
      message: `Cannot ${input.action} a reservation that is ${input.from}.`,
      httpStatus: 409
    };
  }

  if (input.from === "held") {
    if (input.holdExpiresAt === null) {
      // A held reservation always has an expiry (CHECK, sql/180); a null here is a
      // caller bug and must not read as "never expires".
      return {
        ok: false,
        code: "INVALID_STATE",
        message: "A held reservation has no hold expiry.",
        httpStatus: 409
      };
    }
    const expired =
      input.holdElapsed ?? input.holdExpiresAt.getTime() <= input.now.getTime();
    // Extending an elapsed hold would revive one whose units may have been
    // reclaimed (the trigger refuses it too): HOLD_EXPIRED, like a confirm.
    if ((input.action === "confirm" || input.action === "extend") && expired) {
      return {
        ok: false,
        code: "HOLD_EXPIRED",
        message: "The hold has expired.",
        httpStatus: 409
      };
    }
    if (input.action === "expire" && !expired) {
      return {
        ok: false,
        code: "INVALID_STATE",
        message: "The hold has not expired yet.",
        httpStatus: 409
      };
    }
  }

  return {
    ok: true,
    to: rule.to,
    allocations: rule.allocations,
    releasedReason: rule.releasedReason ?? null,
    eventKind: rule.eventKind,
    permissionAction: rule.permissionAction,
    severity: rule.severity,
    clearsHoldExpiry: input.action === "confirm"
  };
}

export function isTerminalReservationStatus(status: ReservationStatus) {
  return TERMINAL_RESERVATION_STATUSES.includes(status);
}

/**
 * What a newly created reservation starts as: `immediate` offerings are
 * `confirmed` in the creating transaction, everything else `held`.
 */
export function initialReservationStatus(
  confirmationMode: "immediate" | "hold_then_confirm"
): "held" | "confirmed" {
  return confirmationMode === "immediate" ? "confirmed" : "held";
}

/**
 * The history events a creation appends. `held` is skipped for an immediate
 * confirmation (both `created` and `confirmed` are emitted), per section 3.
 */
export function creationEventKinds(
  confirmationMode: "immediate" | "hold_then_confirm"
): readonly ReservationEventKind[] {
  return confirmationMode === "immediate"
    ? ["created", "confirmed"]
    : ["created", "held"];
}
