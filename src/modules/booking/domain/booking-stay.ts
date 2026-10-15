/**
 * `booking` stay and block rules as PURE functions (Issue #940, ADR-0135;
 * docs/awcms/booking.md section 2.5, 3.1 and 8.1 rule 7).
 *
 * Nothing here touches a database, a clock or the network. The application layer
 * (`application/booking-hold-service.ts`, `booking-block-service.ts`) reads the
 * facts, calls these functions and writes the answer.
 *
 * ## A stay is dates; the instants are display
 *
 * A stay is the half-open local date interval `[check_in_date, check_out_date)`
 * in the resource's IANA zone. Its nights are `check_out_date - check_in_date`,
 * date arithmetic that no daylight-saving change can alter. The arrival and
 * departure INSTANTS this module derives (check-in time on the check-in date,
 * check-out time on the check-out date, RFC 5545 gap and fold rules) serve
 * display, the arrival window, lead time and the late-cancellation cutoff. They
 * never enter an overlap test and nothing reads their difference.
 *
 * The date checks here are the ones `evaluateStay` (availability) applies, in
 * the same order, so a stay that availability offered is one a claim accepts;
 * `tests/booking-stay.test.ts` asserts the two agree on a table of cases.
 */
import { AVAILABILITY_LIMITS } from "./booking-availability";
import type { ValidationIssue } from "./booking-allocation";
import {
  daysBetween,
  isLocalDate,
  localDateExists,
  localDateOf,
  resolveLocalInstant,
  type LocalResolution
} from "./booking-time";

/** What claiming a stay or a block can refuse with, and the HTTP status a route will answer it with. */
export const STAY_REFUSALS = {
  STAY_DATES_INVALID: 400,
  MIN_STAY_VIOLATION: 409,
  MAX_STAY_EXCEEDED: 409,
  STAY_POOL_INCONSISTENT: 409
} as const;

export const BLOCK_REFUSALS = {
  /** A live stay (or another block) already holds a night of the range; nothing was cancelled. */
  BLOCK_CONFLICT: 409,
  CONTENTION_RETRY: 409,
  STAY_DATES_INVALID: 400,
  BOOKING_MODE_MISMATCH: 409,
  RESOURCE_NOT_FOUND: 404,
  UNIT_NOT_FOUND: 404,
  BLOCK_NOT_FOUND: 404
} as const;

export type StayRefusalCode = keyof typeof STAY_REFUSALS;
export type BlockRefusalCode = keyof typeof BLOCK_REFUSALS;

/** The closed list of reasons a block may carry (`sql/186` CHECK): a code, never free text. */
export const BLOCK_REASON_CODES = [
  "maintenance",
  "owner_use",
  "other"
] as const;
export type BlockReasonCode = (typeof BLOCK_REASON_CODES)[number];

export type StayDatesInput = {
  checkInDate: string;
  checkOutDate: string;
  timezone: string;
  /** Local check-in / check-out times as seconds since midnight (configuration, not occupancy). */
  checkInSeconds: number;
  checkOutSeconds: number;
  /** The DATABASE clock, epoch milliseconds: "today" is its local date in `timezone`. */
  nowMs: number;
};

export type StayDerivation =
  | {
      ok: true;
      nights: number;
      /** Arrival instant: the check-in time on the check-in date, in the resource's zone. */
      startsAtMs: number;
      /** Departure instant: the check-out time on the check-out date. */
      endsAtMs: number;
      /** How each local time resolved (`gap` / `fold` are the RFC 5545 cases), for the snapshot's audit trail. */
      checkIn: LocalResolution["kind"];
      checkOut: LocalResolution["kind"];
    }
  | { ok: false; code: "STAY_DATES_INVALID"; detail: string };

function invalid(detail: string): StayDerivation {
  return { ok: false, code: "STAY_DATES_INVALID", detail };
}

/**
 * Validates the dates of a stay and derives its night count and arrival /
 * departure instants. The checks and their order mirror `evaluateStay`:
 * well-formed calendar dates, check-out after check-in, at most 366 nights,
 * both dates exist in the zone (a zone that skipped a whole day has no such
 * date), and the check-in date is not already past in the zone.
 */
export function deriveStay(input: StayDatesInput): StayDerivation {
  const { checkInDate, checkOutDate, timezone } = input;

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

  if (checkInDate < localDateOf(timezone, input.nowMs)) {
    return invalid(
      "check_in_date is before today in the resource's time zone."
    );
  }

  const arrival = resolveLocalInstant(
    timezone,
    checkInDate,
    input.checkInSeconds
  );
  const departure = resolveLocalInstant(
    timezone,
    checkOutDate,
    input.checkOutSeconds
  );

  return {
    ok: true,
    nights,
    startsAtMs: arrival.instantMs,
    endsAtMs: departure.instantMs,
    checkIn: arrival.kind,
    checkOut: departure.kind
  };
}

/** The offering's night limits (`min_nights` / `max_nights`): too short is `MIN_STAY_VIOLATION`, too long `MAX_STAY_EXCEEDED`. */
export function checkNightLimits(
  nights: number,
  limits: { minNights: number; maxNights: number }
): { code: "MIN_STAY_VIOLATION" | "MAX_STAY_EXCEEDED"; detail: string } | null {
  if (nights < limits.minNights) {
    return {
      code: "MIN_STAY_VIOLATION",
      detail: `Minimum stay is ${limits.minNights} night(s).`
    };
  }

  if (nights > limits.maxNights) {
    return {
      code: "MAX_STAY_EXCEEDED",
      detail: `Maximum stay is ${limits.maxNights} night(s).`
    };
  }

  return null;
}

export type StayTerms = {
  timezone: string;
  /** `HH:MM:SS` as the database renders a `time` column. */
  checkInTime: string;
  checkOutTime: string;
};

/**
 * Whether the resources a stay may land on (a pool's) agree on ONE set of terms.
 * A stay's item snapshots a single zone and a single pair of local times; a pool
 * that mixes zones or times would make "the dates" mean different things on
 * different units, so such a claim is refused instead of snapshotting the first
 * resource's terms by accident. Returns the agreed terms, or `null`.
 */
export function agreedStayTerms(
  resources: readonly StayTerms[]
): StayTerms | null {
  const first = resources[0];

  if (!first) {
    return null;
  }

  return resources.every(
    (resource) =>
      resource.timezone === first.timezone &&
      resource.checkInTime === first.checkInTime &&
      resource.checkOutTime === first.checkOutTime
  )
    ? first
    : null;
}

// ---------------------------------------------------------------------------
// Blocked nights
// ---------------------------------------------------------------------------

export type CreateBlockInput = {
  resourceId: string;
  /** `null` / absent = every unit of the resource. */
  unitId?: string | null;
  /** Local dates in the resource's zone, half-open `[fromDate, toDate)`. */
  fromDate: string;
  toDate: string;
  reasonCode: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Structural validation of a block request (the shapes the CHECK constraints of
 * `sql/186` enforce, so a bad value is a 400 with a field name rather than a
 * database error). Whether the dates EXIST in the resource's zone needs the
 * zone, so that check is the service's (`STAY_DATES_INVALID`).
 */
export function validateCreateBlock(
  input: CreateBlockInput
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (field: string, message: string, code?: string) =>
    issues.push(code ? { field, message, code } : { field, message });

  if (!UUID_PATTERN.test(input.resourceId)) {
    add("resourceId", "resourceId must be a UUID.");
  }

  if (
    input.unitId !== undefined &&
    input.unitId !== null &&
    !UUID_PATTERN.test(input.unitId)
  ) {
    add("unitId", "unitId must be a UUID.");
  }

  const fromValid = isLocalDate(input.fromDate);
  const toValid = isLocalDate(input.toDate);

  if (!fromValid) {
    add(
      "fromDate",
      "fromDate must be a calendar date YYYY-MM-DD.",
      "STAY_DATES_INVALID"
    );
  }

  if (!toValid) {
    add(
      "toDate",
      "toDate must be a calendar date YYYY-MM-DD.",
      "STAY_DATES_INVALID"
    );
  }

  if (fromValid && toValid) {
    if (input.fromDate >= input.toDate) {
      add(
        "toDate",
        "toDate must be after fromDate (the range is half-open).",
        "STAY_DATES_INVALID"
      );
    } else if (
      daysBetween(input.fromDate, input.toDate) > AVAILABILITY_LIMITS.maxNights
    ) {
      add(
        "toDate",
        `A block spans at most ${AVAILABILITY_LIMITS.maxNights} nights.`,
        "STAY_DATES_INVALID"
      );
    }
  }

  if (!(BLOCK_REASON_CODES as readonly string[]).includes(input.reasonCode)) {
    add(
      "reasonCode",
      `reasonCode must be one of ${BLOCK_REASON_CODES.join(", ")}.`
    );
  }

  return issues;
}
