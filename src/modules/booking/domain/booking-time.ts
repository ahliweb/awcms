/**
 * `booking` time semantics as PURE functions (Issue #938, booking.md section
 * 2.1, 2.2 and 2.5; ADR-0135).
 *
 * No I/O, no clock, no database: every function takes its inputs and returns a
 * value, so the DST fixtures in `tests/booking-time.test.ts` pin the behaviour
 * for any host timezone. The only ambient input is the runtime's IANA tz
 * database, reached through `Intl.DateTimeFormat` -- the same source the module
 * validates zone names against.
 *
 * ## Wall-clock to instant: RFC 5545 section 3.3.5
 *
 * A local date-time maps to zero, one or two instants:
 *
 *   * a NONEXISTENT local time (spring forward) is read with the offset in
 *     effect BEFORE the gap -- `02:30` on a night the clock jumps `02:00 ->
 *     03:00` is `03:30` local after the jump;
 *   * an AMBIGUOUS local time (fall back) takes its FIRST occurrence -- the
 *     earlier instant, the one still on summer time.
 *
 * Indonesian zones have no daylight saving; the rule exists because the module
 * is generic and the code must not assume it.
 *
 * ## Dates are not instants
 *
 * A stay is a half-open local DATE interval. `daysBetween` is calendar
 * arithmetic on `YYYY-MM-DD` (proleptic Gregorian, via UTC midnights), so a 23-
 * or 25-hour day, or a skipped or repeated hour, can never change a night count.
 */

/** An IANA zone name as the database CHECK spells it: `UTC` or `Area/Location`. */
const IANA_SHAPE = /^(UTC|[A-Za-z_]+(\/[A-Za-z0-9_+-]+)+)$/;
const DATE_SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_SHAPE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;
const MS_PER_DAY = 86_400_000;

export const WEEKDAY_KEYS = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat"
] as const;
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timezone);

  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
    formatterCache.set(timezone, formatter);
  }

  return formatter;
}

/**
 * Whether `timezone` is an acceptable zone name: the database's shape (an IANA
 * `Area/Location` or `UTC`, never an offset like `+07:00` or an abbreviation
 * like `WIB`) AND known to this runtime's tz database. The write path
 * additionally checks `pg_timezone_names`; the two databases are allowed to
 * differ only by tzdata version.
 */
export function isValidTimezone(timezone: unknown): timezone is string {
  if (typeof timezone !== "string" || !IANA_SHAPE.test(timezone)) {
    return false;
  }

  try {
    formatterFor(timezone);
    return true;
  } catch {
    return false;
  }
}

export type LocalDateParts = { year: number; month: number; day: number };

/** Parses a strict `YYYY-MM-DD` that is a real calendar date, else `null`. */
export function parseLocalDate(value: unknown): LocalDateParts | null {
  if (typeof value !== "string") {
    return null;
  }

  const match = DATE_SHAPE.exec(value);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));

  // `Date.UTC` rolls 2026-02-30 over to March; round-tripping catches it.
  if (
    year < 1 ||
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

export function isLocalDate(value: unknown): value is string {
  return parseLocalDate(value) !== null;
}

function dateToUtcMidnight(date: string): number {
  const parts = parseLocalDate(date);

  if (!parts) {
    throw new RangeError(`not a local date: ${String(date)}`);
  }

  return Date.UTC(parts.year, parts.month - 1, parts.day);
}

function utcMidnightToDate(ms: number): string {
  const date = new Date(ms);
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

/** Calendar days from `from` to `to` (`to - from`); a stay's night count. */
export function daysBetween(from: string, to: string): number {
  return Math.round(
    (dateToUtcMidnight(to) - dateToUtcMidnight(from)) / MS_PER_DAY
  );
}

/** `date` plus `days` calendar days (negative allowed). */
export function addDays(date: string, days: number): string {
  return utcMidnightToDate(dateToUtcMidnight(date) + days * MS_PER_DAY);
}

/** The weekday of a local calendar date; zone-independent by construction. */
export function weekdayOf(date: string): WeekdayKey {
  return WEEKDAY_KEYS[new Date(dateToUtcMidnight(date)).getUTCDay()]!;
}

/** Every date in the half-open interval `[from, to)`, ascending. Empty when `to <= from`. */
export function datesInRange(from: string, to: string): string[] {
  const count = Math.max(0, daysBetween(from, to));
  const dates: string[] = [];

  for (let index = 0; index < count; index += 1) {
    dates.push(addDays(from, index));
  }

  return dates;
}

/**
 * Seconds since midnight for `HH:MM`, `HH:MM:SS` (a database `time` column
 * renders with seconds) or the end-of-day sentinel `24:00`, else `null`.
 */
export function parseLocalTime(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }

  if (value === "24:00" || value === "24:00:00") {
    return 86_400;
  }

  const match = TIME_SHAPE.exec(value);

  if (!match) {
    return null;
  }

  return (
    Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] ?? 0)
  );
}

/** The UTC offset, in milliseconds, in force in `timezone` at the instant `instantMs`. */
export function offsetAt(timezone: string, instantMs: number): number {
  const parts = formatterFor(timezone).formatToParts(new Date(instantMs));
  const value = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const wallAsUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
    value("second")
  );

  // The formatter drops milliseconds; compare against the whole second.
  return wallAsUtc - Math.floor(instantMs / 1000) * 1000;
}

export type LocalResolution = {
  instantMs: number;
  /** `exact` one instant; `gap` nonexistent, read with the offset before the gap; `fold` ambiguous, first occurrence. */
  kind: "exact" | "gap" | "fold";
};

/**
 * Resolves a local `date` + seconds-since-midnight in `timezone` to an instant
 * under the RFC 5545 rules above. `secondsOfDay` may be `86400` (end of day),
 * which is midnight of the next date.
 */
export function resolveLocalInstant(
  timezone: string,
  date: string,
  secondsOfDay: number
): LocalResolution {
  const wallAsUtc = dateToUtcMidnight(date) + secondsOfDay * 1000;
  // Offsets a day either side bracket any single transition (no zone changes
  // offset twice inside 48 hours), so one of them is in force on each side.
  const before = offsetAt(timezone, wallAsUtc - MS_PER_DAY);
  const after = offsetAt(timezone, wallAsUtc + MS_PER_DAY);
  const candidates = [...new Set([before, after])]
    .map((offset) => wallAsUtc - offset)
    .filter((instant) => wallAsUtc - instant === offsetAt(timezone, instant))
    .sort((left, right) => left - right);

  if (candidates.length === 0) {
    return { instantMs: wallAsUtc - before, kind: "gap" };
  }

  if (candidates.length === 1) {
    return { instantMs: candidates[0]!, kind: "exact" };
  }

  return { instantMs: candidates[0]!, kind: "fold" };
}

/** The local calendar date and seconds-of-day `instantMs` falls on in `timezone`. */
export function localPartsOf(
  timezone: string,
  instantMs: number
): { date: string; secondsOfDay: number } {
  const wall = instantMs + offsetAt(timezone, instantMs);
  const day = Math.floor(wall / MS_PER_DAY);

  return {
    date: utcMidnightToDate(day * MS_PER_DAY),
    secondsOfDay: Math.floor((wall - day * MS_PER_DAY) / 1000)
  };
}

/** The local date `instantMs` falls on in `timezone` ("today" for a stay). */
export function localDateOf(timezone: string, instantMs: number): string {
  return localPartsOf(timezone, instantMs).date;
}

/**
 * Whether the calendar date exists in `timezone`. A zone that skipped a whole
 * day (Pacific/Apia on 2011-12-30) has no instant whose wall date is that day;
 * such a date is `STAY_DATES_INVALID` (booking.md section 2.5, edge case 5).
 */
export function localDateExists(timezone: string, date: string): boolean {
  const resolved = resolveLocalInstant(timezone, date, 12 * 3600);

  return localDateOf(timezone, resolved.instantMs) === date;
}
