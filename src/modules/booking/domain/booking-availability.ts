/**
 * `booking` availability as PURE functions (Issue #938, booking.md section 2.1,
 * 2.2, 2.3 and 2.5; ADR-0135).
 *
 * Every function here takes already-loaded facts and returns a value. There is
 * no clock (the caller passes `nowMs`, read from the DATABASE clock by the
 * application layer), no query, no network: the same input always yields the
 * same answer, which is what makes the DST fixtures in the table tests mean
 * something. The application layer (`application/booking-availability-
 * directory.ts`) is the only place that reads rows.
 *
 * This is availability, not allocation. It answers "is there room?"; it claims
 * nothing, and the answer can be stale the moment it is returned. The allocator
 * (Issue #939) is what actually wins a unit, under the database's exclusion
 * constraints; the constraint -- never this function -- is the guarantee against
 * double-booking.
 *
 * ## Slot mode: UTC half-open intervals
 *
 * Every interval is `[start, end)`. A booking 10:00-11:00 and one 11:00-12:00
 * share a boundary and do not overlap. A slot is the SERVICE interval; what is
 * tested against other bookings is the OCCUPIED range, the service interval
 * widened by the offering's setup before and cleanup after (section 2.3). The
 * service interval must lie inside one open window; its buffers need not (a
 * cleanup may run past closing time). A unit is free for a slot when no live
 * occupied range on it overlaps the candidate's occupied range.
 *
 * ## Stay mode: local date intervals
 *
 * A stay is `[check_in_date, check_out_date)`; its nights are exactly those
 * dates, so `nights = check_out - check_in` is date arithmetic and never depends
 * on the length of a day. Check-in and check-out TIMES derive the arrival and
 * departure instants (display, lead time, horizon) and NEVER enter an overlap
 * test or a night count. Same-day turnover is allowed by construction:
 * `[10th, 12th)` and `[12th, 14th)` do not overlap.
 *
 * Two things take a night out of sale and they differ in strength:
 *   * a BLOCK (maintenance, owner use) is a HARD exclusion: it makes a unit
 *     unavailable and nothing overrides it;
 *   * a `closed` schedule exception is a SOFT closure: the stay is refused
 *     `OUTSIDE_SCHEDULE`, flagged overridable (`reservations.override`).
 */
import type { OpenWindow } from "./booking-schedule";
import {
  daysBetween,
  isLocalDate,
  localDateExists,
  localDateOf,
  resolveLocalInstant
} from "./booking-time";

const MS_PER_SECOND = 1000;
const MS_PER_DAY = 86_400_000;

export const AVAILABILITY_LIMITS = {
  /** Module defaults when neither the offering nor the tenant policy says (booking.md section 4, `settings`: NULL = module default). */
  defaultMinLeadSeconds: 0,
  defaultMaxHorizonDays: 365,
  /** A slot search spans at most this many days. */
  maxSlotWindowDays: 31,
  /** A slot search returns at most this many candidate slots. */
  maxSlots: 500,
  /** Candidates one search EVALUATES, free or not; beyond it the answer is `truncated`. */
  maxCandidates: 20_000,
  /** The finest slot step an offering may declare (sql/186 CHECK `slot_step_seconds >= 300`). */
  minSlotStepSeconds: 300,
  /** A stay spans at most this many nights (a CHECK in sql/180). */
  maxNights: 366
} as const;

export type OccupiedRange = { fromMs: number; toMs: number };
export type OccupiedStay = { from: string; to: string };

export type UnitFacts = {
  unitId: string;
  /** LIVE (unreleased) occupied ranges on this unit, slot mode. */
  occupied: readonly OccupiedRange[];
  /** LIVE date intervals on this unit, stay mode. */
  stays: readonly OccupiedStay[];
};

/** A block of nights, stay resources only. `unitId` null = every unit of the resource. */
export type StayBlock = { unitId: string | null; from: string; to: string };

/** Half-open overlap: `[aFrom, aTo)` and `[bFrom, bTo)` share an instant. Pure twin of `&&`. */
export function intervalsOverlap(
  aFrom: number,
  aTo: number,
  bFrom: number,
  bTo: number
): boolean {
  return aFrom < bTo && bFrom < aTo;
}

/** Half-open overlap of two local date intervals (ISO dates compare lexically). Pure twin of `daterange && daterange`. */
export function dateIntervalsOverlap(
  aFrom: string,
  aTo: string,
  bFrom: string,
  bTo: string
): boolean {
  return aFrom < bTo && bFrom < aTo;
}

export type Slot = { startMs: number; endMs: number; freeUnits: number };

export type SlotQuery = {
  /** Search window `[fromMs, toMs)`: a slot's service interval must lie inside it. */
  fromMs: number;
  toMs: number;
  nowMs: number;
  durationSeconds: number;
  setupSeconds: number;
  cleanupSeconds: number;
  stepSeconds: number;
  /** Units a booking claims at once (>= 1). */
  quantity: number;
  minLeadSeconds: number;
  maxHorizonDays: number;
  openWindows: readonly OpenWindow[];
  units: readonly UnitFacts[];
  /** Cap on returned slots; `AVAILABILITY_LIMITS.maxSlots` at most. */
  limit: number;
  /**
   * Optional narrowing from a staff-availability port (the no-op seam of
   * `booking-staff-availability.ts` returns `null`: no constraint). Pure: it is
   * a predicate over the slot's service interval, evaluated by the caller's
   * already-fetched data, never a call out of this function.
   */
  staffAllows?: ((startMs: number, endMs: number) => boolean) | null;
};

export type SlotResult = { slots: Slot[]; truncated: boolean };

function unitFreeForSlot(
  unit: UnitFacts,
  occupiedFrom: number,
  occupiedTo: number
): boolean {
  return !unit.occupied.some((range) =>
    intervalsOverlap(range.fromMs, range.toMs, occupiedFrom, occupiedTo)
  );
}

/**
 * The bookable slots in the search window, ascending, each with how many units
 * are free for it. A candidate slot starts at a window opening plus a whole
 * number of steps, ends `duration` later and must lie inside one open window,
 * inside the search window, no sooner than `now + minLead` and before
 * `now + maxHorizon`.
 */
export function computeSlotAvailability(query: SlotQuery): SlotResult {
  const durationMs = query.durationSeconds * MS_PER_SECOND;
  const stepMs = query.stepSeconds * MS_PER_SECOND;
  const setupMs = query.setupSeconds * MS_PER_SECOND;
  const cleanupMs = query.cleanupSeconds * MS_PER_SECOND;
  const earliestStart = Math.max(
    query.fromMs,
    query.nowMs + query.minLeadSeconds * MS_PER_SECOND
  );
  // Exclusive: an arrival AT the horizon instant is already beyond it.
  const horizonEnd = query.nowMs + query.maxHorizonDays * MS_PER_DAY;
  const limit = Math.min(query.limit, AVAILABILITY_LIMITS.maxSlots);
  const slots: Slot[] = [];
  let evaluated = 0;

  if (
    durationMs <= 0 ||
    stepMs <= 0 ||
    query.quantity < 1 ||
    query.units.length < query.quantity
  ) {
    return { slots, truncated: false };
  }

  for (const window of query.openWindows) {
    // First step index whose start is not before the earliest allowed start.
    const first =
      earliestStart > window.startMs
        ? Math.ceil((earliestStart - window.startMs) / stepMs)
        : 0;

    for (
      let start = window.startMs + first * stepMs;
      start + durationMs <= window.endMs;
      start += stepMs
    ) {
      const end = start + durationMs;

      if (start >= horizonEnd || end > query.toMs) {
        break;
      }

      evaluated += 1;

      if (evaluated > AVAILABILITY_LIMITS.maxCandidates) {
        return { slots, truncated: true };
      }

      if (query.staffAllows && !query.staffAllows(start, end)) {
        continue;
      }

      const occupiedFrom = start - setupMs;
      const occupiedTo = end + cleanupMs;
      const freeUnits = query.units.filter((unit) =>
        unitFreeForSlot(unit, occupiedFrom, occupiedTo)
      ).length;

      if (freeUnits < query.quantity) {
        continue;
      }

      if (slots.length >= limit) {
        return { slots, truncated: true };
      }

      slots.push({ startMs: start, endMs: end, freeUnits });
    }
  }

  return { slots, truncated: false };
}

export type StayReasonCode =
  | "STAY_DATES_INVALID"
  | "MIN_STAY_VIOLATION"
  | "MAX_STAY_EXCEEDED"
  | "LEAD_TIME_NOT_MET"
  | "BEYOND_HORIZON"
  | "OUTSIDE_SCHEDULE"
  | "BLOCKED"
  | "NO_UNIT_AVAILABLE";

export type StayReason = {
  code: StayReasonCode;
  /** `reservations.override` lifts it (a business rule); never true for an allocation conflict or a block. */
  overridable: boolean;
  detail?: string;
};

export type StayQuery = {
  checkInDate: string;
  checkOutDate: string;
  timezone: string;
  /** Local check-in / check-out times as seconds since midnight (configuration, not occupancy). */
  checkInSeconds: number;
  checkOutSeconds: number;
  nowMs: number;
  minLeadSeconds: number;
  maxHorizonDays: number;
  minNights: number;
  maxNights: number;
  quantity: number;
  units: readonly UnitFacts[];
  blocks: readonly StayBlock[];
  /** `closed` exception dates (soft closures) in the resource's zone. */
  closedDates: readonly string[];
};

export type StayEvaluation = {
  /** `true` when the stay can be booked as asked (no reason at all). */
  available: boolean;
  nights: number | null;
  /** Derived from the check-in / check-out times; display, lead time and horizon only. */
  arrivalMs: number | null;
  departureMs: number | null;
  /** Units free for every night (not booked, not blocked); `null` when the dates were invalid. */
  freeUnits: number | null;
  reasons: StayReason[];
};

function invalid(detail: string): StayEvaluation {
  return {
    available: false,
    nights: null,
    arrivalMs: null,
    departureMs: null,
    freeUnits: null,
    reasons: [{ code: "STAY_DATES_INVALID", overridable: false, detail }]
  };
}

function blockedForUnit(
  unit: UnitFacts,
  blocks: readonly StayBlock[],
  from: string,
  to: string
): boolean {
  return blocks.some(
    (block) =>
      (block.unitId === null || block.unitId === unit.unitId) &&
      dateIntervalsOverlap(block.from, block.to, from, to)
  );
}

function bookedForStay(unit: UnitFacts, from: string, to: string): boolean {
  return unit.stays.some((stay) =>
    dateIntervalsOverlap(stay.from, stay.to, from, to)
  );
}

/**
 * Evaluates one asked-for stay. Date validation first (nothing else is
 * meaningful on malformed dates), then the offering's night limits, lead time
 * and horizon against the derived arrival instant, the soft closures, and last
 * the units: how many are free for every night.
 */
export function evaluateStay(query: StayQuery): StayEvaluation {
  const { checkInDate, checkOutDate, timezone } = query;

  if (!isLocalDate(checkInDate) || !isLocalDate(checkOutDate)) {
    return invalid("Dates must be calendar dates YYYY-MM-DD.");
  }

  if (checkInDate >= checkOutDate) {
    return invalid("check_out_date must be after check_in_date.");
  }

  const nights = daysBetween(checkInDate, checkOutDate);

  if (nights > AVAILABILITY_LIMITS.maxNights) {
    return invalid(
      `A stay spans at most ${AVAILABILITY_LIMITS.maxNights} nights.`
    );
  }

  if (
    !localDateExists(timezone, checkInDate) ||
    !localDateExists(timezone, checkOutDate)
  ) {
    return invalid("A date does not exist in the resource's time zone.");
  }

  // "Today" is the local date in the resource's zone; arriving late on the
  // check-in date is allowed, a check-in date already past is not.
  if (checkInDate < localDateOf(timezone, query.nowMs)) {
    return invalid(
      "check_in_date is before today in the resource's time zone."
    );
  }

  const arrivalMs = resolveLocalInstant(
    timezone,
    checkInDate,
    query.checkInSeconds
  ).instantMs;
  const departureMs = resolveLocalInstant(
    timezone,
    checkOutDate,
    query.checkOutSeconds
  ).instantMs;
  const reasons: StayReason[] = [];

  if (nights < query.minNights) {
    reasons.push({
      code: "MIN_STAY_VIOLATION",
      overridable: false,
      detail: `Minimum stay is ${query.minNights} night(s).`
    });
  }

  if (nights > query.maxNights) {
    reasons.push({
      code: "MAX_STAY_EXCEEDED",
      overridable: false,
      detail: `Maximum stay is ${query.maxNights} night(s).`
    });
  }

  if (arrivalMs < query.nowMs + query.minLeadSeconds * MS_PER_SECOND) {
    reasons.push({ code: "LEAD_TIME_NOT_MET", overridable: true });
  }

  if (arrivalMs >= query.nowMs + query.maxHorizonDays * MS_PER_DAY) {
    reasons.push({ code: "BEYOND_HORIZON", overridable: true });
  }

  const closed = query.closedDates.filter(
    (date) => checkInDate <= date && date < checkOutDate
  );

  if (closed.length > 0) {
    reasons.push({
      code: "OUTSIDE_SCHEDULE",
      overridable: true,
      detail: `Closed on ${closed.join(", ")}.`
    });
  }

  const free = query.units.filter(
    (unit) =>
      !bookedForStay(unit, checkInDate, checkOutDate) &&
      !blockedForUnit(unit, query.blocks, checkInDate, checkOutDate)
  ).length;

  if (free < query.quantity) {
    // Name the strongest cause: would the stay fit if nothing were blocked?
    const freeIgnoringBlocks = query.units.filter(
      (unit) => !bookedForStay(unit, checkInDate, checkOutDate)
    ).length;

    reasons.push({
      code:
        freeIgnoringBlocks >= query.quantity ? "BLOCKED" : "NO_UNIT_AVAILABLE",
      overridable: false
    });
  }

  return {
    available: reasons.length === 0,
    nights,
    arrivalMs,
    departureMs,
    freeUnits: free,
    reasons
  };
}
