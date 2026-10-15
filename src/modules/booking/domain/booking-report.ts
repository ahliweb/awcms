/**
 * `booking` report rules (Issue #944, ADR-0131; docs/awcms/booking.md section
 * 7.2). Pure -- no database, no clock, no I/O.
 *
 * The figures a dashboard shows, and the definitions that make them mean one
 * thing. The SQL that fetches the raw facts lives in
 * `application/booking-report-directory.ts`; every ratio, every window and every
 * suppression decision is made HERE so a test can pin it without a database.
 *
 * ## What the definitions are (owner decision O8, answered 2026-10-10)
 *
 * - **Occupancy excludes holds.** A night is occupied only when a `confirmed`,
 *   `checked_in` or `completed` reservation claims the unit for it (`completed`
 *   so that a stay that has already been lived still counts on the nights it was
 *   lived; a `no_show` keeps its allocation but nobody used the unit, so it is
 *   not occupied). A hold is a separate PIPELINE figure and is never added.
 * - **Utilization is a separate metric** (booked time over available time) and
 *   is never reported as, or averaged with, occupancy.
 * - **Day windows are Asia/Jakarta** (`REPORT_TIMEZONE`). A day is the half-open
 *   interval `[00:00, next 00:00)` local time. Jakarta has no daylight saving,
 *   so every window is 24 hours; the windows are still derived through the
 *   zone rules rather than by adding 86 400 000, so the code stays correct if
 *   the zone's rules ever change.
 * - **A stay is counted per unit-night.** Two nights on one unit are two
 *   unit-nights; the same stay on three units is six.
 * - **No money.** Nothing here computes or carries a price, deposit or revenue
 *   (booking holds none, booking.md section 1); revenue follows the commerce
 *   ledgers.
 * - **Ratios over small groups are withheld.** A ratio or mean computed over
 *   fewer than {@link MIN_GROUP_SIZE} reservations is returned as `null` with
 *   `suppressed: true`, so a rate is not read off one or two bookings. Counts
 *   are NOT suppressed or anonymised: they are the tenant's own operational
 *   figures and the reader already holds `booking.reports.read` on that
 *   tenant's data.
 */
import {
  addDays,
  datesInRange,
  daysBetween,
  isLocalDate,
  resolveLocalInstant
} from "./booking-time";
import { asUuid } from "./booking-validation";
import type { ValidationError, Validated } from "./booking-schedule";

export const REPORT_TIMEZONE = "Asia/Jakarta";

/** A slice with fewer reservations than this reports no rate (ahliweb/awcms-one#389 acceptance: "where a slice is under 5"). */
export const MIN_GROUP_SIZE = 5;

export const REPORT_LIMITS = {
  /** Longest report window in days. */
  maxDays: 92,
  /** Resources one report covers; more are cut and `truncated` says so. */
  maxResources: 200
} as const;

/** Reservation statuses whose allocation counts as OCCUPIED (O8: never `held`). */
export const OCCUPYING_STATUSES = [
  "confirmed",
  "checked_in",
  "completed"
] as const;

/** Statuses whose booked time is NET booked (`booked - released` in the projection). */
export const NET_BOOKED_STATUSES = [
  "confirmed",
  "checked_in",
  "completed",
  "no_show"
] as const;

export type ReportRange = {
  /** First local date, inclusive. */
  from: string;
  /** Last local date, exclusive. */
  to: string;
  resourceId: string | null;
};

const KNOWN_PARAMS = ["from", "to", "resourceId"];

/** The query of the three report routes: `from`/`to` local dates (half-open, at most 92 days) and an optional `resourceId`. */
export function parseReportQuery(
  params: URLSearchParams
): Validated<ReportRange> {
  const errors: ValidationError[] = [];

  for (const key of params.keys()) {
    if (!KNOWN_PARAMS.includes(key)) {
      errors.push({
        field: key,
        message: `${key} is not an accepted parameter.`
      });
    }
  }

  const from = params.get("from");
  const to = params.get("to");

  if (!isLocalDate(from)) {
    errors.push({ field: "from", message: "from must be a date YYYY-MM-DD." });
  }

  if (!isLocalDate(to)) {
    errors.push({ field: "to", message: "to must be a date YYYY-MM-DD." });
  }

  if (isLocalDate(from) && isLocalDate(to)) {
    const days = daysBetween(from, to);

    if (days < 1) {
      errors.push({ field: "to", message: "to must be after from." });
    } else if (days > REPORT_LIMITS.maxDays) {
      errors.push({
        field: "to",
        message: `The window is at most ${REPORT_LIMITS.maxDays} days.`
      });
    }
  }

  let resourceId: string | null = null;

  if (params.has("resourceId")) {
    resourceId = asUuid(params.get("resourceId"));

    if (!resourceId) {
      errors.push({
        field: "resourceId",
        message: "resourceId must be a UUID."
      });
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, value: { from: from!, to: to!, resourceId } };
}

export type DayWindow = {
  /** Local date in {@link REPORT_TIMEZONE}. */
  date: string;
  startMs: number;
  endMs: number;
};

/** The report days in `[from, to)` as half-open instant windows in {@link REPORT_TIMEZONE}. */
export function reportDayWindows(from: string, to: string): DayWindow[] {
  return datesInRange(from, to).map((date) => ({
    date,
    startMs: resolveLocalInstant(REPORT_TIMEZONE, date, 0).instantMs,
    endMs: resolveLocalInstant(REPORT_TIMEZONE, addDays(date, 1), 0).instantMs
  }));
}

/** The instants `[from 00:00, to 00:00)` of a report range in {@link REPORT_TIMEZONE}. */
export function reportRangeInstants(
  from: string,
  to: string
): { startMs: number; endMs: number } {
  return {
    startMs: resolveLocalInstant(REPORT_TIMEZONE, from, 0).instantMs,
    endMs: resolveLocalInstant(REPORT_TIMEZONE, to, 0).instantMs
  };
}

/** Whole seconds of `[startMs, endMs)` that fall inside `window` (0 when disjoint). */
export function overlapSeconds(
  startMs: number,
  endMs: number,
  window: { startMs: number; endMs: number }
): number {
  const from = Math.max(startMs, window.startMs);
  const to = Math.min(endMs, window.endMs);

  return to > from ? Math.floor((to - from) / 1000) : 0;
}

/**
 * Open windows clipped to `window`, in seconds, summed over `units` identical
 * units. The windows are the resource's schedule expansion (a superset that may
 * straddle the window edge); overlapping windows must already be merged.
 */
export function availableSeconds(
  openWindows: readonly { startMs: number; endMs: number }[],
  window: { startMs: number; endMs: number },
  units: number
): number {
  let seconds = 0;

  for (const open of openWindows) {
    seconds += overlapSeconds(open.startMs, open.endMs, window);
  }

  return seconds * Math.max(0, units);
}

/** `part / whole` rounded to 4 decimals, or `null` when `whole` is 0. */
export function ratio(part: number, whole: number): number | null {
  if (whole <= 0) {
    return null;
  }

  return Math.round((part / whole) * 10_000) / 10_000;
}

export type Suppressible<T> =
  { suppressed: false; value: T } | { suppressed: true; value: null };

/** Withholds `value` when the group it was computed over is smaller than {@link MIN_GROUP_SIZE}. */
export function suppressSmall<T>(groupSize: number, value: T): Suppressible<T> {
  return groupSize < MIN_GROUP_SIZE
    ? { suppressed: true, value: null }
    : { suppressed: false, value };
}

/** A ratio over a group of `groupSize` reservations, withheld under {@link MIN_GROUP_SIZE}. */
export function suppressedRatio(
  part: number,
  groupSize: number
): Suppressible<number | null> {
  return suppressSmall(groupSize, ratio(part, groupSize));
}

// -- Lead time ----------------------------------------------------------------

export const LEAD_TIME_BUCKETS = [
  { key: "same_day", fromSeconds: 0, toSeconds: 86_400 },
  { key: "1_3_days", fromSeconds: 86_400, toSeconds: 4 * 86_400 },
  { key: "4_7_days", fromSeconds: 4 * 86_400, toSeconds: 8 * 86_400 },
  { key: "8_30_days", fromSeconds: 8 * 86_400, toSeconds: 31 * 86_400 },
  { key: "31_plus_days", fromSeconds: 31 * 86_400, toSeconds: Infinity }
] as const;

export type LeadTimeBucketKey = (typeof LEAD_TIME_BUCKETS)[number]["key"];

/**
 * The bucket a lead time falls in. Lead time is `starts_at - confirmed_at`; a
 * negative value (a booking confirmed after its start, which a staff override
 * can create) counts as same-day -- it is the shortest lead there is.
 */
export function leadTimeBucket(leadSeconds: number): LeadTimeBucketKey {
  const lead = Math.max(0, leadSeconds);

  for (const bucket of LEAD_TIME_BUCKETS) {
    if (lead < bucket.toSeconds) {
      return bucket.key;
    }
  }

  return "31_plus_days";
}

export type LeadTimeReport = {
  reservations: number;
  /** Mean lead time in days (1 decimal); `null` and `suppressed` under the minimum group. */
  meanDays: Suppressible<number | null>;
  buckets: { key: LeadTimeBucketKey; reservations: number }[];
};

/** Lead times already grouped by the database: `count` reservations whose lead time lies in the hour starting at `leadSeconds`, summing to `sumSeconds`. */
export type LeadTimeGroup = {
  leadSeconds: number;
  count: number;
  sumSeconds: number;
};

/**
 * Shapes grouped lead times into buckets and a mean, withholding any slice under
 * {@link MIN_GROUP_SIZE}. Every bucket boundary is a whole number of days, so
 * grouping by the hour loses nothing about which bucket a reservation is in.
 */
export function shapeLeadTimeGroups(
  groups: readonly LeadTimeGroup[]
): LeadTimeReport {
  const counts = new Map<LeadTimeBucketKey, number>(
    LEAD_TIME_BUCKETS.map((bucket) => [bucket.key, 0])
  );
  let reservations = 0;
  let total = 0;

  for (const group of groups) {
    const key = leadTimeBucket(group.leadSeconds);

    counts.set(key, (counts.get(key) ?? 0) + group.count);
    reservations += group.count;
    total += Math.max(0, group.sumSeconds);
  }

  const mean =
    reservations === 0
      ? null
      : Math.round((total / reservations / 86_400) * 10) / 10;

  return {
    reservations,
    meanDays: suppressSmall(reservations, mean),
    buckets: LEAD_TIME_BUCKETS.map((bucket) => ({
      key: bucket.key,
      reservations: counts.get(bucket.key) ?? 0
    }))
  };
}

/** {@link shapeLeadTimeGroups} over individual lead times in seconds. */
export function shapeLeadTime(leadSeconds: readonly number[]): LeadTimeReport {
  return shapeLeadTimeGroups(
    leadSeconds.map((lead) => ({
      leadSeconds: lead,
      count: 1,
      sumSeconds: Math.max(0, lead)
    }))
  );
}

// -- Outcomes of a confirmation cohort ------------------------------------------

export type OutcomeFacts = {
  /** Reservations confirmed in the window (the cohort). */
  confirmed: number;
  /** Of them, now `cancelled`. */
  cancelled: number;
  /** Of them, cancelled late (inside the offering's cutoff). */
  lateCancelled: number;
  /** Of them, now `no_show`. */
  noShow: number;
  /** Of them, `checked_in` or `completed` (the guest arrived). */
  arrived: number;
};

export type OutcomeReport = OutcomeFacts & {
  /** cancelled / confirmed. */
  cancellationRate: Suppressible<number | null>;
  /** lateCancelled / confirmed. */
  lateCancellationRate: Suppressible<number | null>;
  /** noShow / (noShow + arrived): of the reservations whose arrival day came, how many did not arrive. */
  noShowRate: Suppressible<number | null>;
};

/**
 * Cancellation and no-show rates of the reservations confirmed in the window.
 * The no-show rate's denominator is the RESOLVED arrivals (`no_show` plus
 * `checked_in`/`completed`), not the whole cohort: a still-`confirmed` booking
 * whose day has not come has not had the chance to show or not.
 */
export function shapeOutcomes(facts: OutcomeFacts): OutcomeReport {
  const resolved = facts.noShow + facts.arrived;

  return {
    ...facts,
    cancellationRate: suppressedRatio(facts.cancelled, facts.confirmed),
    lateCancellationRate: suppressedRatio(facts.lateCancelled, facts.confirmed),
    noShowRate: suppressSmall(resolved, ratio(facts.noShow, resolved))
  };
}

// -- Hold pipeline ------------------------------------------------------------------

export type PipelineFacts = {
  /** Holds placed in the window. */
  placed: number;
  /** Of them, now confirmed (or beyond). */
  converted: number;
  /** Of them, expired unconfirmed. */
  expired: number;
  /** Of them, cancelled while still held. */
  cancelledHeld: number;
};

export type PipelineReport = PipelineFacts & {
  /** converted / placed. */
  conversionRate: Suppressible<number | null>;
  /** Holds still in force right now (a live figure, not windowed). */
  openHoldsNow: number;
  /** Units those holds claim right now. A pipeline figure, never added to occupancy. */
  heldUnitsNow: number;
};

/** The hold pipeline of the window plus the holds still open right now. Never added to occupancy. */
export function shapePipeline(
  facts: PipelineFacts,
  open: { holds: number; units: number }
): PipelineReport {
  return {
    ...facts,
    conversionRate: suppressedRatio(facts.converted, facts.placed),
    openHoldsNow: open.holds,
    heldUnitsNow: open.units
  };
}

// -- Occupancy ----------------------------------------------------------------------

export type OccupancyDayFacts = {
  date: string;
  /** Active units of the resource. */
  units: number;
  /** Unit-nights under a confirmed / checked-in / completed allocation. */
  occupiedUnitNights: number;
  /** Unit-nights under a live hold: the PIPELINE, reported beside occupancy and never in it. */
  heldUnitNights: number;
  /** Unit-nights under an active block (maintenance, owner use). */
  blockedUnitNights: number;
};

export type OccupancyDay = OccupancyDayFacts & {
  /** occupied / units; `null` for a resource with no units. Holds excluded (O8). */
  occupancyRate: number | null;
};

/**
 * One day of occupancy. The rate's denominator is ALL active units: whether a
 * maintenance closure comes out of the denominator is still open under O8, so
 * `blockedUnitNights` is reported beside the rate for a consumer that wants
 * `occupied / (units - blocked)`. The rate never includes `heldUnitNights`.
 */
export function shapeOccupancyDay(facts: OccupancyDayFacts): OccupancyDay {
  return {
    ...facts,
    occupancyRate: ratio(facts.occupiedUnitNights, facts.units)
  };
}

export type UtilizationDay = {
  date: string;
  /** Service-interval seconds of net-booked reservations inside the day, buffers excluded. */
  bookedSeconds: number;
  /** Open schedule seconds inside the day, times active units. */
  availableSeconds: number;
  /** booked / available; `null` when nothing was available. A separate metric from occupancy. */
  utilization: number | null;
};

export function shapeUtilizationDay(
  date: string,
  bookedSeconds: number,
  available: number
): UtilizationDay {
  return {
    date,
    bookedSeconds,
    availableSeconds: available,
    utilization: ratio(bookedSeconds, available)
  };
}
