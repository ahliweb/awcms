/**
 * The working calendar of a follow-up rule revision (Issue #1165, ADR-0159
 * section 6). Pure module: no database, no I/O, no dependency on the host's
 * zone.
 *
 * A calendar is an IANA zone, a set of ISO weekdays (a bitmask, bit 0 = Monday
 * ... bit 6 = Sunday), a daily window `[startMinute, endMinute)` in minutes
 * after LOCAL midnight, and a list of LOCAL holiday dates (`YYYY-MM-DD`). Every
 * answer is a UTC instant.
 *
 * Local-to-UTC conversion is done per day with the zone's offset AT that local
 * time (re-checked once, so a window that starts on a daylight-saving boundary
 * still lands on a real instant), never with the host's zone. A day whose
 * window collapses because of a daylight-saving gap simply contributes less
 * working time; nothing is invented.
 */

export type WorkingCalendar = {
  timeZone: string;
  /** Bit 0 = Monday ... bit 6 = Sunday. 1..127. */
  workingDays: number;
  /** Minutes after local midnight, inclusive. */
  workStartMinute: number;
  /** Minutes after local midnight, exclusive. */
  workEndMinute: number;
  /** Local dates `YYYY-MM-DD` on which no work happens. */
  holidays: readonly string[];
};

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
/** How far ahead a search may walk before it is a configuration error. */
const MAX_DAYS_SCANNED = 800;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let cached = formatterCache.get(timeZone);

  if (!cached) {
    cached = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
    formatterCache.set(timeZone, cached);
  }

  return cached;
}

/** True when the runtime's zone database knows `timeZone`. */
export function isKnownTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function localParts(instantMs: number, timeZone: string): LocalParts {
  const parts: Record<string, number> = {};

  for (const part of formatter(timeZone).formatToParts(new Date(instantMs))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }

  return {
    year: parts.year!,
    month: parts.month!,
    day: parts.day!,
    hour: parts.hour! % 24,
    minute: parts.minute!,
    second: parts.second!
  };
}

/** The zone's offset (local minus UTC) at an instant, in milliseconds. */
function offsetAt(instantMs: number, timeZone: string): number {
  const p = localParts(instantMs, timeZone);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second
  );

  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/** The UTC instant of a local wall-clock time on a local date. */
export function localToUtc(
  year: number,
  month: number,
  day: number,
  minuteOfDay: number,
  timeZone: string
): number {
  const wall = Date.UTC(year, month - 1, day, 0, minuteOfDay);
  const first = wall - offsetAt(wall, timeZone);
  const second = wall - offsetAt(first, timeZone);

  return second;
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

function isoDate(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** ISO weekday 1 (Monday) .. 7 (Sunday) of a civil date. */
function isoWeekday(year: number, month: number, day: number): number {
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  return weekday === 0 ? 7 : weekday;
}

function isWorkingDate(
  calendar: WorkingCalendar,
  year: number,
  month: number,
  day: number
): boolean {
  const bit = 1 << (isoWeekday(year, month, day) - 1);

  return (
    (calendar.workingDays & bit) !== 0 &&
    !calendar.holidays.includes(isoDate(year, month, day))
  );
}

type Window = { startMs: number; endMs: number };

/** The working windows from the local day containing `fromMs`, one per local day. */
function* windowsFrom(
  calendar: WorkingCalendar,
  fromMs: number
): Generator<Window> {
  const start = localParts(fromMs, calendar.timeZone);
  let civil = Date.UTC(start.year, start.month - 1, start.day);

  for (let scanned = 0; scanned < MAX_DAYS_SCANNED; scanned += 1) {
    const date = new Date(civil);
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();

    if (isWorkingDate(calendar, year, month, day)) {
      const startMs = localToUtc(
        year,
        month,
        day,
        calendar.workStartMinute,
        calendar.timeZone
      );
      const endMs = localToUtc(
        year,
        month,
        day,
        calendar.workEndMinute,
        calendar.timeZone
      );

      if (endMs > startMs) yield { startMs, endMs };
    }

    civil += DAY_MS;
  }
}

/**
 * The first instant at or after `from` that is inside working time. Used for
 * quiet hours: a notification outside the window waits for the next one.
 */
export function nextWorkingInstant(
  calendar: WorkingCalendar,
  from: Date
): Date {
  const fromMs = from.getTime();

  for (const window of windowsFrom(calendar, fromMs)) {
    if (window.endMs <= fromMs) continue;

    return new Date(Math.max(window.startMs, fromMs));
  }

  throw new RangeError("The working calendar has no working time ahead.");
}

/** True when `at` is inside a working window. */
export function isWithinWorkingTime(
  calendar: WorkingCalendar,
  at: Date
): boolean {
  return nextWorkingInstant(calendar, at).getTime() === at.getTime();
}

/**
 * `from` plus `minutes` of WORKING time. Zero minutes means "the next working
 * instant". Time before the first window, outside windows and on holidays does
 * not count.
 */
export function addWorkingMinutes(
  calendar: WorkingCalendar,
  from: Date,
  minutes: number
): Date {
  if (!Number.isInteger(minutes) || minutes < 0) {
    throw new RangeError("minutes must be a non-negative integer.");
  }

  const fromMs = from.getTime();
  let remainingMs = minutes * MINUTE_MS;

  for (const window of windowsFrom(calendar, fromMs)) {
    if (window.endMs <= fromMs) continue;

    const effectiveStart = Math.max(window.startMs, fromMs);
    const available = window.endMs - effectiveStart;

    if (remainingMs <= available) {
      return new Date(effectiveStart + remainingMs);
    }

    remainingMs -= available;
  }

  throw new RangeError("The working calendar has no working time ahead.");
}

/** Weekday bitmask from ISO weekday numbers (1 = Monday .. 7 = Sunday). */
export function weekdaysToMask(days: readonly number[]): number {
  return days.reduce((mask, day) => mask | (1 << (day - 1)), 0);
}

/** ISO weekday numbers from a bitmask, ascending. */
export function maskToWeekdays(mask: number): number[] {
  const days: number[] = [];

  for (let day = 1; day <= 7; day += 1) {
    if ((mask & (1 << (day - 1))) !== 0) days.push(day);
  }

  return days;
}
