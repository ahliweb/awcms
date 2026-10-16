/**
 * Workforce metrics (Issue #953; `docs/awcms/workforce-metrics.md`): the
 * TRANSPARENT BUSINESS FACTS the `hr_workforce` module reports about attendance,
 * hours, shift coverage and productivity.
 *
 * ## What this file is
 *
 * Pure functions and constants -- no I/O. The directory
 * (`application/hr-workforce-metrics-directory.ts`) loads rows; this file turns
 * rows into facts, so the arithmetic is testable without a database and so the
 * HTTP surface and any future consumer cannot disagree about a definition.
 *
 * ## What it deliberately is not
 *
 *   * NOT a score. There is no composite, no ranking, no weighting, no
 *     threshold, no "good/bad" flag. Every figure is a count, a number of
 *     minutes, or a ratio of two such numbers whose definition is written in
 *     the contract. Two employees' figures are never combined into a verdict.
 *   * NOT evidence of anything beyond the attendance events and published
 *     shifts it reads. No photo, no biometric, no device, no location, no
 *     network identifier -- the source tables hold none (owner decision O6,
 *     ADR-0138) and this file has no input that could carry one.
 *   * NOT payroll. It reads `awcms_hr_attendance_events` and
 *     `awcms_hr_shift_assignments` only; compensation, commission and payroll
 *     tables are out of reach (the #978/#1015 payroll-boundary gates).
 *
 * ## Governance
 *
 * These facts describe a person's working time. A fact is not a judgement: a
 * missed shift can be an unrecorded clock-in, a late arrival a transit
 * disruption. Using any of them for a consequential decision (discipline, pay,
 * promotion, termination) needs the governance review in
 * `docs/awcms/workforce-metrics.md` section 7 first. The API says so in every
 * response (`governance`).
 */

/** Bumped when a metric's definition changes (never silently). */
export const WORKFORCE_METRICS_CONTRACT_VERSION = 1;

/**
 * Small-group suppression threshold: a group aggregate computed from fewer than
 * this many contributing employees is withheld entirely.
 *
 * Five is the figure the `booking` reports already use for withholding a ratio
 * (`booking/reports/utilization`) and a common floor in public-statistics
 * practice. It is a CONSTANT, not a tenant setting, on purpose: a tenant that
 * could lower it to 1 would make suppression a switch the party being
 * protected against can flip. Raising it is a code change with a contract
 * version bump.
 */
export const SMALL_GROUP_MIN_CONTRIBUTORS = 5;

/**
 * Contributor floor: an employee counts toward a group's threshold only when
 * their own scheduled OR worked minutes in the bucket reach this many (four
 * hours). Without it one real employee plus a few planted one-minute shifts or
 * sessions would lift a group over {@link SMALL_GROUP_MIN_CONTRIBUTORS}. Below
 * the floor an employee is also left out of the sums.
 */
export const MIN_CONTRIBUTION_MINUTES = 240;

/** A clock-in this many minutes after a shift starts is a late arrival. */
export const LATE_GRACE_MINUTES = 5;

/** A clock-in this early before a shift starts still belongs to that shift. */
export const SHIFT_MATCH_EARLY_MINUTES = 120;

/**
 * A clock-in with no clock-out for longer than this is an incomplete session:
 * counted as such, never as worked time (a forgotten clock-out must not become
 * a 40-hour day).
 */
export const MAX_SESSION_MINUTES = 24 * 60;

/** The longest window one request may ask about. */
export const MAX_WINDOW_DAYS = 31;

/** Employees per page of the per-employee list. */
export const METRICS_PAGE_SIZE = 50;

/**
 * Most employments one group aggregate will read. A tenant larger than this
 * gets 422 rather than a request that outlives the statement timeout.
 */
export const MAX_AGGREGATED_EMPLOYMENTS = 10_000;

export const WORKFORCE_GOVERNANCE_NOTICE =
  "These are business facts about recorded attendance and published shifts, not an assessment of a person. Do not use them for a consequential decision (discipline, pay, promotion, termination) without the governance review described in docs/awcms/workforce-metrics.md.";

/** The metric keys, in the order they are reported. Contract section 4. */
export const WORKFORCE_METRIC_KEYS = [
  "scheduled_shifts",
  "attended_shifts",
  "missed_shifts",
  "late_arrivals",
  "scheduled_minutes",
  "worked_minutes",
  "break_minutes",
  "incomplete_sessions",
  "coverage_ratio",
  "worked_to_scheduled_ratio"
] as const;

export type WorkforceMetricKey = (typeof WORKFORCE_METRIC_KEYS)[number];

export type WorkforceFacts = {
  /** Published work shifts that have started inside the window. */
  scheduledShifts: number;
  /** Of those, the ones with a clock-in in the match range. */
  attendedShifts: number;
  /** Of those, the ones that have ENDED with no matching clock-in. */
  missedShifts: number;
  /** Attended shifts whose clock-in came after the grace period. */
  lateArrivals: number;
  /** Planned minutes (length minus planned break) of shifts that have ended. */
  scheduledMinutes: number;
  /** Minutes between a clock-in and its clock-out, less breaks taken. */
  workedMinutes: number;
  /** Minutes of breaks taken inside completed sessions. */
  breakMinutes: number;
  /** Clock-ins that never got a plausible clock-out. */
  incompleteSessions: number;
  /** attended / (attended + missed); null when no shift has settled. */
  coverageRatio: number | null;
  /** worked / scheduled minutes; null when nothing was scheduled. May exceed 1. */
  workedToScheduledRatio: number | null;
};

export type MetricEvent = {
  kind: "clock_in" | "clock_out" | "break_start" | "break_end";
  occurredAt: Date;
};

export type MetricShift = {
  startsAt: Date;
  endsAt: Date;
  breakStartsAt: Date | null;
  breakEndsAt: Date | null;
};

export type MetricWindow = { from: Date; to: Date };

const MS_PER_MINUTE = 60_000;

/** Whole minutes, rounded half up, never negative. */
function minutes(ms: number): number {
  return Math.max(0, Math.round(ms / MS_PER_MINUTE));
}

/** A ratio rounded to four decimals, or null when the denominator is zero. */
export function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) {
    return null;
  }

  return Math.round((numerator / denominator) * 10_000) / 10_000;
}

type Session = {
  clockIn: Date;
  clockOut: Date | null;
  workedMs: number;
  breakMs: number;
};

/**
 * Turns an employment's EFFECTIVE events (a superseded event is already gone)
 * into sessions.
 *
 * A small state machine, forgiving by construction: a second clock-in while a
 * session is open is ignored (the first stands), a clock-out with nothing open
 * is ignored, a break outside a session is ignored, and a break still open at
 * the clock-out ends there. The result is a fact about what the events SAY,
 * never a correction of them -- a correction is the approval workflow's job.
 */
export function buildSessions(
  events: readonly MetricEvent[],
  now: Date
): { sessions: Session[]; incomplete: Date[] } {
  const ordered = [...events].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime()
  );
  const maxMs = MAX_SESSION_MINUTES * MS_PER_MINUTE;
  const sessions: Session[] = [];
  const incomplete: Date[] = [];
  let open: Date | null = null;
  let breakOpen: Date | null = null;
  let breakMs = 0;

  const reset = () => {
    open = null;
    breakOpen = null;
    breakMs = 0;
  };

  for (const event of ordered) {
    const at = event.occurredAt;

    switch (event.kind) {
      case "clock_in":
        // A new clock-in after an abandoned one: the old one is incomplete.
        if (open !== null && at.getTime() - open.getTime() > maxMs) {
          incomplete.push(open);
          reset();
        }
        if (open === null) {
          open = at;
        }
        break;
      case "break_start":
        if (open !== null && breakOpen === null) {
          breakOpen = at;
        }
        break;
      case "break_end":
        if (open !== null && breakOpen !== null) {
          breakMs += Math.max(0, at.getTime() - breakOpen.getTime());
          breakOpen = null;
        }
        break;
      case "clock_out": {
        if (open === null) {
          break;
        }

        const lengthMs = at.getTime() - open.getTime();

        if (lengthMs > maxMs) {
          incomplete.push(open);
        } else {
          if (breakOpen !== null) {
            breakMs += Math.max(0, at.getTime() - breakOpen.getTime());
          }

          sessions.push({
            clockIn: open,
            clockOut: at,
            workedMs: Math.max(0, lengthMs - breakMs),
            breakMs
          });
        }

        reset();
        break;
      }
    }
  }

  // Still open at the end: forgotten if older than the cap, otherwise simply
  // in progress (counted nowhere yet -- it is not a fact until it closes).
  const stillOpen = open as Date | null;

  if (stillOpen !== null && now.getTime() - stillOpen.getTime() > maxMs) {
    incomplete.push(stillOpen);
  }

  return { sessions, incomplete };
}

/**
 * The facts of ONE employment over `window`, as of `now`.
 *
 * `events` should cover `[from - SHIFT_MATCH_EARLY_MINUTES, to + MAX_SESSION]`
 * so a session that straddles an edge can close; `shifts` are the PUBLISHED,
 * non-cancelled WORK shifts starting inside the window. Both are the caller's
 * job to filter; this function only does the arithmetic.
 *
 * Attribution rules (the contract, section 4):
 *   * a session belongs to the window by its CLOCK-IN instant;
 *   * a shift belongs to the window by its START instant, and counts once it has
 *     started (`startsAt < now`);
 *   * a clock-in matches the earliest unmatched shift whose range
 *     `[startsAt - SHIFT_MATCH_EARLY, endsAt)` contains it, each clock-in at
 *     most one shift.
 */
export function computeFacts(
  events: readonly MetricEvent[],
  shifts: readonly MetricShift[],
  window: MetricWindow,
  now: Date
): WorkforceFacts {
  const { sessions, incomplete } = buildSessions(events, now);
  const earlyMs = SHIFT_MATCH_EARLY_MINUTES * MS_PER_MINUTE;
  const graceMs = LATE_GRACE_MINUTES * MS_PER_MINUTE;
  const fromMs = window.from.getTime();
  const toMs = window.to.getTime();
  const nowMs = now.getTime();

  const inWindowSessions = sessions.filter(
    (session) =>
      session.clockIn.getTime() >= fromMs && session.clockIn.getTime() < toMs
  );
  const incompleteInWindow = incomplete.filter(
    (at) => at.getTime() >= fromMs && at.getTime() < toMs
  );
  // Matching may use a clock-in up to the early margin BEFORE the window.
  const matchable = sessions
    .filter(
      (session) =>
        session.clockIn.getTime() >= fromMs - earlyMs &&
        session.clockIn.getTime() < toMs
    )
    .map((session) => session.clockIn);
  const used = new Set<number>();
  const started = [...shifts]
    .filter(
      (shift) =>
        shift.startsAt.getTime() >= fromMs &&
        shift.startsAt.getTime() < toMs &&
        shift.startsAt.getTime() < nowMs
    )
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  let attended = 0;
  let missed = 0;
  let late = 0;
  let scheduledMs = 0;

  for (const shift of started) {
    const startMs = shift.startsAt.getTime();
    const endMs = shift.endsAt.getTime();
    let matchedIndex = -1;

    for (let index = 0; index < matchable.length; index += 1) {
      const at = matchable[index]!.getTime();

      if (!used.has(index) && at >= startMs - earlyMs && at < endMs) {
        matchedIndex = index;
        break;
      }
    }

    if (matchedIndex >= 0) {
      used.add(matchedIndex);
      attended += 1;

      if (matchable[matchedIndex]!.getTime() > startMs + graceMs) {
        late += 1;
      }
    } else if (endMs <= nowMs) {
      missed += 1;
    }

    if (endMs <= nowMs) {
      const plannedBreak =
        shift.breakStartsAt && shift.breakEndsAt
          ? shift.breakEndsAt.getTime() - shift.breakStartsAt.getTime()
          : 0;

      scheduledMs += Math.max(0, endMs - startMs - plannedBreak);
    }
  }

  const workedMinutes = inWindowSessions.reduce(
    (sum, session) => sum + minutes(session.workedMs),
    0
  );
  const breakMinutes = inWindowSessions.reduce(
    (sum, session) => sum + minutes(session.breakMs),
    0
  );
  const scheduledMinutes = minutes(scheduledMs);

  return {
    scheduledShifts: started.length,
    attendedShifts: attended,
    missedShifts: missed,
    lateArrivals: late,
    scheduledMinutes,
    workedMinutes,
    breakMinutes,
    incompleteSessions: incompleteInWindow.length,
    coverageRatio: ratio(attended, attended + missed),
    workedToScheduledRatio: ratio(workedMinutes, scheduledMinutes)
  };
}

/** Whether an employment meets the contributor floor in the bucket. */
export function hasContribution(facts: WorkforceFacts): boolean {
  return (
    Math.max(facts.scheduledMinutes, facts.workedMinutes) >=
    MIN_CONTRIBUTION_MINUTES
  );
}

export const EMPTY_FACTS: WorkforceFacts = {
  scheduledShifts: 0,
  attendedShifts: 0,
  missedShifts: 0,
  lateArrivals: 0,
  scheduledMinutes: 0,
  workedMinutes: 0,
  breakMinutes: 0,
  incompleteSessions: 0,
  coverageRatio: null,
  workedToScheduledRatio: null
};

/** Sums per-employee facts into one group's facts; the ratios are recomputed from the sums, never averaged. */
export function sumFacts(list: readonly WorkforceFacts[]): WorkforceFacts {
  const total = list.reduce(
    (acc, facts) => ({
      ...acc,
      scheduledShifts: acc.scheduledShifts + facts.scheduledShifts,
      attendedShifts: acc.attendedShifts + facts.attendedShifts,
      missedShifts: acc.missedShifts + facts.missedShifts,
      lateArrivals: acc.lateArrivals + facts.lateArrivals,
      scheduledMinutes: acc.scheduledMinutes + facts.scheduledMinutes,
      workedMinutes: acc.workedMinutes + facts.workedMinutes,
      breakMinutes: acc.breakMinutes + facts.breakMinutes,
      incompleteSessions: acc.incompleteSessions + facts.incompleteSessions
    }),
    EMPTY_FACTS
  );

  return {
    ...total,
    coverageRatio: ratio(
      total.attendedShifts,
      total.attendedShifts + total.missedShifts
    ),
    workedToScheduledRatio: ratio(total.workedMinutes, total.scheduledMinutes)
  };
}

/** The contributor count is only ever reported as a band, never exactly. */
export type ContributorBand = "5-9" | "10-19" | "20+";

export function contributorBand(count: number): ContributorBand {
  return count >= 20 ? "20+" : count >= 10 ? "10-19" : "5-9";
}

export type GroupFigure<TKey> =
  | {
      group: TKey;
      suppressed: false;
      contributorsBand: ContributorBand;
      facts: WorkforceFacts;
    }
  | { group: TKey; suppressed: true; reason: "small_group" };

/**
 * Applies small-group suppression to one group.
 *
 * A suppressed group carries NO number: not the facts, not the contributor
 * count (a count of 4 against a threshold of 5 would narrow the group), not a
 * partial figure. The only thing it says is that the group is too small.
 */
export function suppressIfSmall<TKey>(
  group: TKey,
  perEmployee: readonly WorkforceFacts[]
): GroupFigure<TKey> {
  const contributing = perEmployee.filter(hasContribution);

  if (contributing.length < SMALL_GROUP_MIN_CONTRIBUTORS) {
    return { group, suppressed: true, reason: "small_group" };
  }

  return {
    group,
    suppressed: false,
    contributorsBand: contributorBand(contributing.length),
    facts: sumFacts(contributing)
  };
}

// --- Query parsing -----------------------------------------------------------------

export type MetricsQuery = {
  from: Date;
  to: Date;
};

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

function parseInstant(text: string | null): Date | null {
  if (!text || !INSTANT.test(text)) {
    return null;
  }

  const date = new Date(text);

  return Number.isNaN(date.getTime()) ? null : date;
}

/** `from` (inclusive) and `to` (exclusive), UTC instants, at most {@link MAX_WINDOW_DAYS} apart. */
export function parseMetricsWindow(
  params: URLSearchParams
):
  | { valid: true; value: MetricsQuery }
  | { valid: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const from = parseInstant(params.get("from"));
  const to = parseInstant(params.get("to"));

  if (!from) {
    errors.from = "from is required: a UTC instant ending in Z.";
  }
  if (!to) {
    errors.to = "to is required: a UTC instant ending in Z.";
  }
  if (from && to) {
    if (to <= from) {
      errors.to = "to must be after from.";
    } else if (
      to.getTime() - from.getTime() >
      MAX_WINDOW_DAYS * 24 * 60 * MS_PER_MINUTE
    ) {
      errors.to = `The window may span at most ${MAX_WINDOW_DAYS} days.`;
    }
  }

  return Object.keys(errors).length > 0 || !from || !to
    ? { valid: false, errors }
    : { valid: true, value: { from, to } };
}

// --- Aggregate windows: fixed calendar buckets ---------------------------------------

export type AggregateBucket = "iso_week";

const DAY_MS = 24 * 60 * MS_PER_MINUTE;

/**
 * The window of the aggregate route: exactly ONE closed bucket, a whole UTC ISO
 * week (Monday 00:00 to the next Monday). Weeks are disjoint and never nest, so
 * no two accepted windows overlap partially and none can be subtracted from
 * another to leave a slice. (A calendar month was accepted once; a month minus
 * the whole weeks inside it leaves its edge days, which re-opened the attack.)
 *
 * Why not any window: with free `from`/`to` two requests differing by a tail
 * slice isolate one person (the difference of the sums IS that person's
 * contribution once the group sits near the threshold). Fixed buckets mean every
 * aggregate a caller can ask for covers the same set of days for everyone; a
 * bucket still in progress is refused because its sums grow with the clock and
 * two reads minutes apart would difference the same way.
 */
export function parseAggregateWindow(
  params: URLSearchParams,
  now: Date
):
  | { valid: true; value: MetricsQuery & { bucket: AggregateBucket } }
  | { valid: false; errors: Record<string, string> } {
  const base = parseMetricsWindow(params);

  if (!base.valid) {
    return base;
  }

  const { from, to } = base.value;
  const midnight = from.getTime() % DAY_MS === 0;
  const isWeek =
    midnight &&
    from.getUTCDay() === 1 &&
    to.getTime() - from.getTime() === 7 * DAY_MS;
  if (!isWeek) {
    return {
      valid: false,
      errors: {
        from: "Aggregates cover one whole UTC ISO week: from must be a Monday 00:00Z and to the next Monday 00:00Z."
      }
    };
  }

  if (to.getTime() > now.getTime()) {
    return {
      valid: false,
      errors: { to: "The week has not ended yet." }
    };
  }

  return {
    valid: true,
    value: { from, to, bucket: "iso_week" }
  };
}
