/**
 * `booking` schedules, closures and exceptions as PURE functions (Issue #938,
 * booking.md section 2.2 and 4).
 *
 * A schedule is written in LOCAL wall-clock time ("Mon-Fri 09:00-17:00") in an
 * IANA zone and expanded to UTC instants here, by one function, using the
 * RFC 5545 gap and fold rules of `booking-time.ts`. Nothing in this file reads a
 * clock, a database or the network.
 *
 * ## The closed `rules` schema
 *
 * ```json
 * { "weekly": { "mon": [{ "from": "09:00", "to": "17:00" }], "sat": [] } }
 * ```
 *
 * A weekday key is `sun`..`sat`; each value is a list of local `[from, to)`
 * windows (at most 8), ascending and non-overlapping, `from < to`, `to` up to
 * `24:00`. A window never crosses midnight: split it across two weekdays. A
 * missing weekday is closed. Anything else in the object is refused, so a client
 * cannot smuggle a recurrence string past the validator (RFC 5545 is the
 * vocabulary, not the parser -- booking.md section 2.4; the DAILY/WEEKLY
 * recurrence of a reservation SERIES arrives with the allocator).
 *
 * `sql/186` repeats the shape check that CAN be stated in SQL (only a `weekly`
 * key) so a direct write cannot store a free-form object; this validator stays
 * the stricter one, and the expander below FAILS CLOSED -- a rule that does not
 * validate opens nothing -- so a row the database accepted but this function
 * rejects can only ever reduce availability.
 *
 * ## Which schedule applies to a date
 *
 * Per local date, in the RESOURCE's zone: an ACTIVE schedule bound to the
 * resource whose `[effective_from, effective_to)` covers the date wins; failing
 * that, an active tenant-default schedule (no resource) in the SAME zone. A
 * schedule in another zone is ignored for the resource rather than guessed at.
 * The database holds the same non-overlap fact for one scope as an exclusion
 * constraint (`sql/186`): at most one active schedule covers a date per
 * (tenant, resource-or-default), so "the schedule" is well defined.
 *
 * ## Exceptions
 *
 * `closed` removes the date's windows (always, whichever schedule is selected);
 * `override_hours` REPLACES them, and only when a schedule covers the date --
 * an override modifies a schedule, it does not conjure one. A closure beats an
 * override on the same date. Exceptions are owned by a schedule (they apply when
 * that schedule is the selected one) or by a resource (they apply whatever
 * schedule is selected). For a stay resource the weekly windows are ignored and
 * only `closed` matters, as a SOFT closure (booking.md section 2.5).
 */
import {
  WEEKDAY_KEYS,
  addDays,
  datesInRange,
  isLocalDate,
  localDateOf,
  parseLocalTime,
  resolveLocalInstant,
  weekdayOf,
  type WeekdayKey
} from "./booking-time";

export type ValidationError = { field: string; message: string };
export type Validated<T> =
  { valid: true; value: T } | { valid: false; errors: ValidationError[] };

export const SCHEDULE_LIMITS = {
  windowsPerDay: 8,
  /** Mirrors `awcms_booking_schedule_exceptions` and the 366-day expansion cap (booking.md section 2.4). */
  exceptionMaxDays: 366,
  /** `reason_code`: a short code, never free text. */
  reasonCode: /^[a-z][a-z0-9_]{0,31}$/
} as const;

export type LocalWindow = { from: string; to: string };
export type WeeklyRules = Partial<Record<WeekdayKey, LocalWindow[]>>;
export type ScheduleRules = { weekly: WeeklyRules };

/** An open interval of real time: `[startMs, endMs)` in epoch milliseconds. */
export type OpenWindow = { startMs: number; endMs: number };

export type ScheduleRecord = {
  id: string;
  resourceId: string | null;
  timezone: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  rules: unknown;
  status: "active" | "inactive";
};

export type ExceptionRecord = {
  id: string;
  scheduleId: string | null;
  resourceId: string | null;
  localFrom: string;
  localTo: string;
  kind: "closed" | "override_hours";
  windows: unknown;
};

function windowsOf(
  value: unknown,
  field: string,
  errors: ValidationError[]
): LocalWindow[] | null {
  if (!Array.isArray(value)) {
    errors.push({ field, message: `${field} must be an array of windows.` });
    return null;
  }

  if (value.length > SCHEDULE_LIMITS.windowsPerDay) {
    errors.push({
      field,
      message: `${field} holds at most ${SCHEDULE_LIMITS.windowsPerDay} windows.`
    });
    return null;
  }

  const windows: LocalWindow[] = [];
  let previousEnd = -1;
  let clean = true;

  value.forEach((entry, index) => {
    const where = `${field}[${index}]`;

    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      errors.push({ field: where, message: `${where} must be an object.` });
      clean = false;
      return;
    }

    const record = entry as Record<string, unknown>;

    for (const key of Object.keys(record)) {
      if (key !== "from" && key !== "to") {
        errors.push({
          field: `${where}.${key}`,
          message: `${key} is not accepted.`
        });
        clean = false;
      }
    }

    const from = parseLocalTime(record.from);
    const to = parseLocalTime(record.to);

    if (from === null || from >= 86_400) {
      errors.push({
        field: `${where}.from`,
        message: "from must be a local time HH:MM before 24:00."
      });
      clean = false;
      return;
    }

    if (to === null) {
      errors.push({
        field: `${where}.to`,
        message:
          "to must be a local time HH:MM, or 24:00 for the end of the day."
      });
      clean = false;
      return;
    }

    if (from >= to) {
      errors.push({
        field: where,
        message:
          "A window is half-open [from, to) and must end after it starts; split a window that crosses midnight across two days."
      });
      clean = false;
      return;
    }

    if (from < previousEnd) {
      errors.push({
        field: where,
        message: "Windows must be ascending and must not overlap."
      });
      clean = false;
      return;
    }

    previousEnd = to;
    windows.push({ from: record.from as string, to: record.to as string });
  });

  return clean ? windows : null;
}

/** Validates the closed `rules` schema. */
export function validateScheduleRules(raw: unknown): Validated<ScheduleRules> {
  const errors: ValidationError[] = [];

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {
      valid: false,
      errors: [{ field: "rules", message: "rules must be an object." }]
    };
  }

  const rules = raw as Record<string, unknown>;

  for (const key of Object.keys(rules)) {
    if (key !== "weekly") {
      errors.push({
        field: `rules.${key}`,
        message: `${key} is not accepted; a schedule has only weekly windows.`
      });
    }
  }

  const weekly: WeeklyRules = {};
  const rawWeekly = rules.weekly;

  if (
    typeof rawWeekly !== "object" ||
    rawWeekly === null ||
    Array.isArray(rawWeekly)
  ) {
    errors.push({
      field: "rules.weekly",
      message: "rules.weekly must be an object."
    });
  } else {
    for (const [key, value] of Object.entries(rawWeekly)) {
      if (!(WEEKDAY_KEYS as readonly string[]).includes(key)) {
        errors.push({
          field: `rules.weekly.${key}`,
          message: "A weekday key is one of sun, mon, tue, wed, thu, fri, sat."
        });
        continue;
      }

      const windows = windowsOf(value, `rules.weekly.${key}`, errors);

      if (windows) {
        weekly[key as WeekdayKey] = windows;
      }
    }
  }

  return errors.length > 0
    ? { valid: false, errors }
    : { valid: true, value: { weekly } };
}

export type ScheduleInput = {
  resourceId: string | null;
  timezone: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  rules: ScheduleRules;
};

export type ExceptionInput = {
  scheduleId: string | null;
  resourceId: string | null;
  localFrom: string;
  localTo: string;
  kind: "closed" | "override_hours";
  windows: LocalWindow[] | null;
  reasonCode: string | null;
};

/** `date + 1` style helper for the exclusive end of a single-day range. */
export function nextDate(date: string): string {
  return addDays(date, 1);
}

export function validateExceptionRange(
  localFrom: unknown,
  localTo: unknown,
  errors: ValidationError[]
): boolean {
  let ok = true;

  if (!isLocalDate(localFrom)) {
    errors.push({
      field: "localFrom",
      message: "localFrom must be a calendar date YYYY-MM-DD."
    });
    ok = false;
  }

  if (!isLocalDate(localTo)) {
    errors.push({
      field: "localTo",
      message: "localTo must be a calendar date YYYY-MM-DD."
    });
    ok = false;
  }

  if (ok) {
    const from = localFrom as string;
    const to = localTo as string;

    if (from >= to) {
      errors.push({
        field: "localTo",
        message:
          "The range is half-open [localFrom, localTo); localTo must be after localFrom."
      });
      ok = false;
    } else if (
      datesInRange(from, to).length > SCHEDULE_LIMITS.exceptionMaxDays
    ) {
      errors.push({
        field: "localTo",
        message: `An exception spans at most ${SCHEDULE_LIMITS.exceptionMaxDays} days.`
      });
      ok = false;
    }
  }

  return ok;
}

/** Validates the windows of an `override_hours` exception (same shape as one weekday). */
export function validateOverrideWindows(
  raw: unknown
): Validated<LocalWindow[]> {
  const errors: ValidationError[] = [];
  const windows = windowsOf(raw, "windows", errors);

  return windows && errors.length === 0
    ? { valid: true, value: windows }
    : { valid: false, errors };
}

/**
 * The half-open `[from, to)` ranges on one owner that two active records would
 * share; the pure twin of the exclusion constraint on `awcms_booking_schedules`
 * (`daterange(effective_from, effective_to, '[)') &&`, a NULL end is unbounded).
 */
export function effectiveRangesOverlap(
  left: { effectiveFrom: string; effectiveTo: string | null },
  right: { effectiveFrom: string; effectiveTo: string | null }
): boolean {
  const leftEndsBeforeRight =
    left.effectiveTo !== null && left.effectiveTo <= right.effectiveFrom;
  const rightEndsBeforeLeft =
    right.effectiveTo !== null && right.effectiveTo <= left.effectiveFrom;

  return !leftEndsBeforeRight && !rightEndsBeforeLeft;
}

function coversDate(schedule: ScheduleRecord, date: string): boolean {
  return (
    schedule.status === "active" &&
    schedule.effectiveFrom <= date &&
    (schedule.effectiveTo === null || date < schedule.effectiveTo)
  );
}

/**
 * The schedule in force for `date` for this resource (resource-bound first, then
 * a same-zone tenant default), or `null`.
 */
export function selectSchedule(
  schedules: readonly ScheduleRecord[],
  resourceId: string,
  timezone: string,
  date: string
): ScheduleRecord | null {
  const bound = schedules.find(
    (schedule) =>
      schedule.resourceId === resourceId &&
      schedule.timezone === timezone &&
      coversDate(schedule, date)
  );

  if (bound) {
    return bound;
  }

  return (
    schedules.find(
      (schedule) =>
        schedule.resourceId === null &&
        schedule.timezone === timezone &&
        coversDate(schedule, date)
    ) ?? null
  );
}

function exceptionsOn(
  exceptions: readonly ExceptionRecord[],
  resourceId: string,
  schedule: ScheduleRecord | null,
  date: string
): ExceptionRecord[] {
  return exceptions.filter(
    (exception) =>
      exception.localFrom <= date &&
      date < exception.localTo &&
      (exception.resourceId === resourceId ||
        (schedule !== null && exception.scheduleId === schedule.id))
  );
}

function mergeWindows(windows: OpenWindow[]): OpenWindow[] {
  const sorted = [...windows].sort((a, b) => a.startMs - b.startMs);
  const merged: OpenWindow[] = [];

  for (const window of sorted) {
    const last = merged[merged.length - 1];

    if (last && window.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, window.endMs);
    } else {
      merged.push({ ...window });
    }
  }

  return merged;
}

function localWindowsToOpen(
  timezone: string,
  date: string,
  windows: readonly LocalWindow[]
): OpenWindow[] {
  const open: OpenWindow[] = [];

  for (const window of windows) {
    const from = parseLocalTime(window.from);
    const to = parseLocalTime(window.to);

    if (from === null || to === null) {
      continue;
    }

    const start = resolveLocalInstant(timezone, date, from).instantMs;
    const end = resolveLocalInstant(timezone, date, to).instantMs;

    // A gap can collapse a short window onto itself; an empty window opens nothing.
    if (end > start) {
      open.push({ startMs: start, endMs: end });
    }
  }

  return open;
}

/** The weekly windows `schedule` declares for `date`'s weekday, validated (fails closed). */
function weeklyWindowsFor(
  schedule: ScheduleRecord,
  date: string
): LocalWindow[] {
  const validation = validateScheduleRules(schedule.rules);

  if (!validation.valid) {
    return [];
  }

  return validation.value.weekly[weekdayOf(date)] ?? [];
}

/**
 * The real-time windows in which `resourceId` is open between `fromMs` and
 * `toMs` (a superset: a window that straddles either edge is returned whole;
 * the caller clips). Dates are iterated in `timezone`, one day either side, so a
 * window whose UTC instants fall across the query edge is not lost.
 */
export function expandOpenWindows(input: {
  resourceId: string;
  timezone: string;
  schedules: readonly ScheduleRecord[];
  exceptions: readonly ExceptionRecord[];
  fromMs: number;
  toMs: number;
}): OpenWindow[] {
  const firstDate = addDays(localDateOf(input.timezone, input.fromMs), -1);
  const lastDate = addDays(localDateOf(input.timezone, input.toMs), 1);
  const open: OpenWindow[] = [];

  for (const date of datesInRange(firstDate, addDays(lastDate, 1))) {
    const schedule = selectSchedule(
      input.schedules,
      input.resourceId,
      input.timezone,
      date
    );
    const matching = exceptionsOn(
      input.exceptions,
      input.resourceId,
      schedule,
      date
    );

    if (matching.some((exception) => exception.kind === "closed")) {
      continue;
    }

    if (schedule === null) {
      continue;
    }

    const overrides = matching.filter(
      (exception) => exception.kind === "override_hours"
    );
    let local: LocalWindow[];

    if (overrides.length > 0) {
      local = overrides.flatMap((exception) => {
        const validation = validateOverrideWindows(exception.windows);

        return validation.valid ? validation.value : [];
      });
    } else {
      local = weeklyWindowsFor(schedule, date);
    }

    open.push(...localWindowsToOpen(input.timezone, date, local));
  }

  return mergeWindows(open).filter(
    (window) => window.endMs > input.fromMs && window.startMs < input.toMs
  );
}

/**
 * The local dates in `[fromDate, toDate)` closed by a `closed` exception that
 * applies to this resource: the SOFT closures of a stay resource (booking.md
 * section 2.5). A closure counts whichever schedule is selected, and also when
 * no schedule covers the date.
 */
export function closedDates(input: {
  resourceId: string;
  timezone: string;
  schedules: readonly ScheduleRecord[];
  exceptions: readonly ExceptionRecord[];
  fromDate: string;
  toDate: string;
}): string[] {
  return datesInRange(input.fromDate, input.toDate).filter((date) => {
    const schedule = selectSchedule(
      input.schedules,
      input.resourceId,
      input.timezone,
      date
    );

    return exceptionsOn(
      input.exceptions,
      input.resourceId,
      schedule,
      date
    ).some((exception) => exception.kind === "closed");
  });
}
