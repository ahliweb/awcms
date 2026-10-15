/**
 * `booking` business policy as PURE functions (Issue #941, ADR-0131;
 * docs/awcms/booking.md sections 3, 5.1 and 6).
 *
 * "Policy" is what `reservations.override` can lift: opening hours, lead time and
 * the booking horizon. It is deliberately separate from the CLAIM (the allocator
 * and the exclusion constraints), which nothing can lift: a refusal here is a
 * business rule an authorised person may waive; a conflict there is a fact.
 *
 * Nothing in this file reads a clock or a row. The application layer
 * (`application/booking-reservation-policy.ts`) loads the facts, passes the
 * DATABASE clock as `nowMs`, and acts on the answer.
 */
import type { StayReason } from "./booking-availability";
import type { OpenWindow } from "./booking-schedule";

const MS_PER_SECOND = 1000;
const MS_PER_DAY = 86_400_000;

/**
 * Defaults a tenant has not set (`awcms_booking_settings` column `NULL` = module
 * default, booking.md section 4). They are conservative on purpose.
 *
 * ## The default hold caps (booking.md section 13, left open by Issue #939)
 *
 * A hold occupies real inventory without any payment behind it, so the number of
 * holds one actor can place is the lever against hold flooding (section 9).
 * Until this change the caps defaulted to unlimited, which is not a safe default
 * for an endpoint a downstream public channel will front.
 *
 *   * **5 live holds per customer.** A person comparing dates or rooms holds
 *     two or three at once; five is generous for a person and small for a
 *     script. A hold without a customer reference (a walk-in, an anonymous
 *     caller) has no customer to count against, so only the tenant cap bounds it.
 *   * **500 live holds per tenant.** Holds last minutes (default 15, never more
 *     than a day), so this is the number of checkouts in progress AT ONE
 *     INSTANT. A property with a few hundred units and a busy site does not get
 *     near it; one actor cannot take more than 500 units out of sale for the
 *     length of a hold.
 *
 * The trade-off: a cap that is too low turns a legitimate burst (a flash sale, a
 * class registration that opens at noon) into `429 HOLD_LIMIT_EXCEEDED` for
 * honest customers; too high lets one hostile caller hold the shelf. The numbers
 * are per-tenant tunable (`booking.policy.configure`; a tenant that truly wants
 * no practical cap sets a very large value, since `NULL` now means "the default",
 * not "unlimited"). A cap counts only LIVE holds (a hold past its expiry is about
 * to be reclaimed and does not count), and an `immediate` confirmation is not a
 * hold, so neither is capped.
 */
export const POLICY_DEFAULTS = {
  maxActiveHoldsPerCustomer: 5,
  maxActiveHoldsPerTenant: 500,
  /**
   * How long after the arrival instant a person may mark a no-show, when the
   * tenant has not set `no_show_grace_seconds`. 15 minutes: long enough that a
   * receptionist cannot mark a guest who is parking the car, short enough that
   * a slot is not held for the whole day. For a stay the arrival instant is the
   * check-in time, so a property that holds a room until evening raises it.
   */
  noShowGraceSeconds: 900
} as const;

export type PolicyRefusalCode =
  "OUTSIDE_SCHEDULE" | "LEAD_TIME_VIOLATION" | "HORIZON_EXCEEDED";

/** All three are business rules `reservations.override` may lift, and all three are 409 (booking.md section 3). */
export const POLICY_REFUSALS: Readonly<Record<PolicyRefusalCode, 409>> = {
  OUTSIDE_SCHEDULE: 409,
  LEAD_TIME_VIOLATION: 409,
  HORIZON_EXCEEDED: 409
};

export type PolicyReason = { code: PolicyRefusalCode; detail: string };

export type SlotPolicyInput = {
  /** The service interval `[startMs, endMs)`. */
  startMs: number;
  endMs: number;
  nowMs: number;
  minLeadSeconds: number;
  maxHorizonDays: number;
  /** The offering's search grid, seconds. */
  stepSeconds: number;
  /** Open windows covering the interval, as `expandOpenWindows` returns them. */
  openWindows: readonly OpenWindow[];
};

/**
 * The policy reasons a slot start trips, in a stable order. Mirrors what the
 * availability search would have offered (`computeSlotAvailability`): the service
 * interval lies inside one open window, starts on that window's step grid, no
 * sooner than `now + lead` and before `now + horizon`. A start the search would
 * never have offered is therefore a start the create route refuses -- unless a
 * person with `reservations.override` lifts it.
 */
export function evaluateSlotPolicy(input: SlotPolicyInput): PolicyReason[] {
  const reasons: PolicyReason[] = [];
  const window = input.openWindows.find(
    (candidate) =>
      candidate.startMs <= input.startMs && input.endMs <= candidate.endMs
  );

  if (!window) {
    reasons.push({
      code: "OUTSIDE_SCHEDULE",
      detail: "The service interval is not inside one open window."
    });
  } else if (
    input.stepSeconds > 0 &&
    (input.startMs - window.startMs) % (input.stepSeconds * MS_PER_SECOND) !== 0
  ) {
    reasons.push({
      code: "OUTSIDE_SCHEDULE",
      detail: "The start is not on the offering's slot grid."
    });
  }

  if (input.startMs < input.nowMs + input.minLeadSeconds * MS_PER_SECOND) {
    reasons.push({
      code: "LEAD_TIME_VIOLATION",
      detail: "The start is sooner than the minimum lead time allows."
    });
  }

  if (input.startMs >= input.nowMs + input.maxHorizonDays * MS_PER_DAY) {
    reasons.push({
      code: "HORIZON_EXCEEDED",
      detail: "The start is beyond the booking horizon."
    });
  }

  return reasons;
}

const STAY_REASON_TO_POLICY: Readonly<Record<string, PolicyRefusalCode>> = {
  LEAD_TIME_NOT_MET: "LEAD_TIME_VIOLATION",
  BEYOND_HORIZON: "HORIZON_EXCEEDED",
  OUTSIDE_SCHEDULE: "OUTSIDE_SCHEDULE"
};

/**
 * The policy subset of a stay evaluation: only the reasons flagged
 * `overridable` (lead time, horizon, a soft closure). A block, an allocation
 * conflict and the night limits are the claim's to refuse, never policy.
 */
export function stayPolicyReasons(
  reasons: readonly StayReason[]
): PolicyReason[] {
  const policy: PolicyReason[] = [];

  for (const reason of reasons) {
    const code = STAY_REASON_TO_POLICY[reason.code];

    if (reason.overridable && code) {
      policy.push({ code, detail: reason.detail ?? reason.code });
    }
  }

  return policy;
}

/**
 * A cancellation inside the offering's cutoff is late (booking.md section 3,
 * "late cancellation"): the module records the fact, any fee is commerce's. A
 * `null` cutoff means the offering defines none, so no cancellation is late.
 * Measured against the arrival instant (`starts_at`), also for a stay.
 */
export function isLateCancellation(input: {
  nowMs: number;
  startsAtMs: number;
  cutoffSeconds: number | null;
}): boolean {
  return (
    input.cutoffSeconds !== null &&
    input.nowMs >= input.startsAtMs - input.cutoffSeconds * MS_PER_SECOND
  );
}

/** The earliest instant a person may mark a no-show: arrival plus the grace. */
export function noShowEarliestMs(
  startsAtMs: number,
  graceSeconds: number
): number {
  return startsAtMs + graceSeconds * MS_PER_SECOND;
}
