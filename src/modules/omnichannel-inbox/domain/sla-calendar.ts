/**
 * Business-time arithmetic for inbox SLA policies (Issue #1164, ADR-0160
 * section 4). Pure: no I/O.
 *
 * A due time is found by walking the policy's working windows, day by day, in
 * the policy's own IANA zone, skipping closed weekdays and holidays, and
 * spending the budget only inside a window. Local wall-clock times are turned
 * into instants through the zone's offset AT that instant, so a window that
 * crosses a DST change keeps its local meaning. The walk is bounded
 * (`MAX_CALENDAR_DAYS`); a policy with no working window at all is refused when
 * it is written (`validateWorkingHours`), so the bound is a backstop.
 *
 * ## The formatter cache is bounded and keyed canonically
 *
 * `Intl.DateTimeFormat` is expensive to build, so one per zone is kept. The key
 * is the zone's CANONICAL name (`resolvedOptions().timeZone`), never the
 * caller's spelling, and the cache is an LRU of `MAX_CACHED_ZONES` entries: a
 * stream of distinct zone names cannot grow it without bound. It is only filled
 * by `computeDueAt` / `localDateOf`, which run after authorisation (the
 * validation in `canonicalTimeZone` builds a throwaway formatter and caches
 * nothing).
 */

export type WorkingWindow = { start: number; end: number } | null;

/** Seven entries, ISO weekday 1 (Monday) .. 7 (Sunday). */
export type WorkingHours = readonly WorkingWindow[];

export type SlaCalendar = {
  timezone: string;
  workingHours: WorkingHours;
  /** Local `YYYY-MM-DD` dates that are not working days. */
  holidays: readonly string[];
};

export const MAX_CALENDAR_DAYS = 400;
export const MAX_CACHED_ZONES = 64;
export const MINUTES_PER_DAY = 1440;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

/**
 * The canonical IANA name for `zone`, or `null` when the runtime does not know
 * it. Builds a throwaway formatter; caches nothing.
 */
export function canonicalTimeZone(zone: unknown): string | null {
  if (typeof zone !== "string" || zone.length === 0 || zone.length > 64) {
    return null;
  }

  if (!/^[A-Za-z0-9_+\-/]+$/.test(zone)) return null;

  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: zone
    }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

function formatterFor(zone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(zone);

  if (cached) {
    // LRU: move to the most recent end.
    formatterCache.delete(zone);
    formatterCache.set(zone, cached);
    return cached;
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  const canonical = formatter.resolvedOptions().timeZone;

  if (canonical !== zone) {
    // Only canonical names are cached; resolve the canonical entry instead.
    return formatterFor(canonical);
  }

  formatterCache.set(zone, formatter);

  while (formatterCache.size > MAX_CACHED_ZONES) {
    const oldest = formatterCache.keys().next().value;

    if (oldest === undefined) break;

    formatterCache.delete(oldest);
  }

  return formatter;
}

/** Test-only: how many zones the cache holds. */
export function cachedZoneCountForTests(): number {
  return formatterCache.size;
}

type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function localParts(instantMs: number, zone: string): LocalParts {
  const parts = formatterFor(zone).formatToParts(new Date(instantMs));
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second")
  };
}

/** Milliseconds to ADD to UTC to get the zone's wall clock at `instantMs`. */
function zoneOffsetMs(instantMs: number, zone: string): number {
  const p = localParts(instantMs, zone);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second
  );
  // Drop sub-second precision so the offset is a whole number of seconds.
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/** The instant at which the zone's wall clock reads `minuteOfDay` on that local date. */
export function wallClockToInstant(
  year: number,
  month: number,
  day: number,
  minuteOfDay: number,
  zone: string
): number {
  const guess = Date.UTC(year, month - 1, day, 0, minuteOfDay);
  const first = guess - zoneOffsetMs(guess, zone);

  return guess - zoneOffsetMs(first, zone);
}

/** The zone's local calendar date of `instantMs`, as `YYYY-MM-DD`. */
export function localDateOf(instantMs: number, zone: string): string {
  const p = localParts(instantMs, zone);

  return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function isoWeekday(year: number, month: number, day: number): number {
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  return weekday === 0 ? 7 : weekday;
}

function addDays(
  year: number,
  month: number,
  day: number,
  days: number
): { year: number; month: number; day: number } {
  const date = new Date(Date.UTC(year, month - 1, day + days));

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

function formatDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The instant `budgetMinutes` BUSINESS minutes after `startMs` under `calendar`,
 * or `null` when no working time exists within `MAX_CALENDAR_DAYS` (a policy
 * that should never have been accepted).
 */
export function computeDueAt(
  startMs: number,
  budgetMinutes: number,
  calendar: SlaCalendar
): number | null {
  if (!Number.isFinite(startMs) || !(budgetMinutes > 0)) return null;

  const zone = calendar.timezone;
  const holidays = new Set(calendar.holidays);
  const start = localParts(startMs, zone);
  let remainingMs = budgetMinutes * 60_000;

  for (let offset = 0; offset < MAX_CALENDAR_DAYS; offset += 1) {
    const date = addDays(start.year, start.month, start.day, offset);

    if (holidays.has(formatDate(date.year, date.month, date.day))) continue;

    const window =
      calendar.workingHours[isoWeekday(date.year, date.month, date.day) - 1];

    if (!window) continue;

    const windowStart = wallClockToInstant(
      date.year,
      date.month,
      date.day,
      window.start,
      zone
    );
    const windowEnd = wallClockToInstant(
      date.year,
      date.month,
      date.day,
      window.end,
      zone
    );
    const from = Math.max(windowStart, startMs);

    if (from >= windowEnd) continue;

    const available = windowEnd - from;

    if (remainingMs <= available) return from + remainingMs;

    remainingMs -= available;
  }

  return null;
}

export type CalendarValidation =
  | { valid: true; value: SlaCalendar }
  | { valid: false; errors: { field: string; message: string }[] };

/** Validates and normalises a policy's calendar input. Never echoes a value. */
export function validateCalendar(input: {
  timezone: unknown;
  workingHours: unknown;
  holidays: unknown;
}): CalendarValidation {
  const errors: { field: string; message: string }[] = [];
  const timezone = canonicalTimeZone(input.timezone);

  if (!timezone) {
    errors.push({
      field: "timezone",
      message: "timezone must be a known IANA zone name."
    });
  }

  const hours = validateWorkingHours(input.workingHours);

  if (!hours) {
    errors.push({
      field: "workingHours",
      message:
        "workingHours must be 7 entries (Monday first), each null or {start, end} minutes of day with 0 <= start < end <= 1440, and at least one day open."
    });
  }

  const holidays = validateHolidays(input.holidays);

  if (!holidays) {
    errors.push({
      field: "holidays",
      message:
        "holidays must be at most 366 distinct real dates in YYYY-MM-DD form."
    });
  }

  if (errors.length > 0 || !timezone || !hours || !holidays) {
    return { valid: false, errors };
  }

  return { valid: true, value: { timezone, workingHours: hours, holidays } };
}

export function validateWorkingHours(raw: unknown): WorkingHours | null {
  if (!Array.isArray(raw) || raw.length !== 7) return null;

  const result: WorkingWindow[] = [];

  for (const entry of raw) {
    if (entry === null) {
      result.push(null);
      continue;
    }

    if (typeof entry !== "object" || Array.isArray(entry)) return null;

    const keys = Object.keys(entry);

    if (keys.length !== 2 || !keys.includes("start") || !keys.includes("end"))
      return null;

    const { start, end } = entry as { start: unknown; end: unknown };

    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      (start as number) < 0 ||
      (end as number) > MINUTES_PER_DAY ||
      (start as number) >= (end as number)
    ) {
      return null;
    }

    result.push({ start: start as number, end: end as number });
  }

  return result.some((window) => window !== null) ? result : null;
}

export function validateHolidays(raw: unknown): string[] | null {
  if (raw === undefined) return [];

  if (!Array.isArray(raw) || raw.length > 366) return null;

  const seen = new Set<string>();

  for (const entry of raw) {
    if (typeof entry !== "string") return null;

    const match = DATE_PATTERN.exec(entry);

    if (!match) return null;

    const [year, month, day] = [
      Number(match[1]),
      Number(match[2]),
      Number(match[3])
    ];
    const date = new Date(Date.UTC(year, month - 1, day));

    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() + 1 !== month ||
      date.getUTCDate() !== day
    ) {
      return null;
    }

    if (seen.has(entry)) return null;

    seen.add(entry);
  }

  return [...seen].sort();
}
