/**
 * Wall-clock to UTC resolution for shift templates (Issue #946,
 * `docs/awcms/hr-payroll.md` section 4.4). Pure — no database, no clock.
 *
 * ## Why this exists
 *
 * A template says "starts 22:00 local, 480 minutes, zone Asia/Makassar". An
 * assignment stores UTC instants, resolved ONCE at assignment time, so a later
 * edit of the template (or of the zone rules) never moves an assignment that
 * already exists. The Indonesian zones have no daylight saving, but the schema
 * accepts any IANA zone, and a tenant in a zone that does must not get a shift
 * that is silently an hour wrong.
 *
 * ## The two awkward local times, decided and tested
 *
 *   * A GAP (spring forward: 02:30 never happens) resolves to the instant the
 *     wall clock would have reached had the clock not jumped: the offset in
 *     force BEFORE the change is used, so 02:30 becomes 03:30 local.
 *   * An OVERLAP (fall back: 01:30 happens twice) resolves to the EARLIER
 *     occurrence, the same convention `Temporal` calls "compatible".
 *
 * A duration is ELAPSED time: the end is the start plus the minutes, so a shift
 * that spans a clock change is 8 real hours long, whatever the wall clock says.
 */

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(zone);

  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric"
    });
    formatters.set(zone, formatter);
  }

  return formatter;
}

/** An IANA-looking zone the runtime knows. The database re-checks it against `pg_timezone_names`. */
export function isValidTimeZone(zone: unknown): zone is string {
  if (typeof zone !== "string" || !/^[A-Za-z0-9_+\-/]{1,64}$/.test(zone)) {
    return false;
  }

  try {
    formatterFor(zone);
    return true;
  } catch {
    return false;
  }
}

/** The zone's UTC offset in minutes at an instant (positive east of Greenwich). */
export function zoneOffsetMinutes(utcMs: number, zone: string): number {
  const whole = Math.floor(utcMs / 1000) * 1000;
  const parts = formatterFor(zone).formatToParts(new Date(whole));
  const read = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour"),
    read("minute"),
    read("second")
  );

  return Math.round((asUtc - whole) / MINUTE_MS);
}

/** A local wall-clock `YYYY-MM-DD` + `HH:MM` in `zone`, as a UTC epoch (ms). See the header for gap and overlap. */
export function localToUtcMs(
  localDate: string,
  localTime: string,
  zone: string
): number {
  const [year, month, day] = localDate.split("-").map(Number) as [
    number,
    number,
    number
  ];
  const [hour, minute] = localTime.split(":").map(Number) as [number, number];
  const asIfUtc = Date.UTC(year, month - 1, day, hour, minute);
  const before = zoneOffsetMinutes(asIfUtc - DAY_MS, zone);
  const after = zoneOffsetMinutes(asIfUtc + DAY_MS, zone);
  const valid = new Set<number>();

  for (const offset of new Set([before, after])) {
    const candidate = asIfUtc - offset * MINUTE_MS;

    if (zoneOffsetMinutes(candidate, zone) === offset) {
      valid.add(candidate);
    }
  }

  if (valid.size > 0) {
    // Overlap: two instants read the same wall clock; the earlier one wins.
    return Math.min(...valid);
  }

  // Gap: the wall clock skipped this time. Use the offset in force before the change.
  return asIfUtc - before * MINUTE_MS;
}

export type TemplateShape = {
  localStart: string; // HH:MM
  durationMinutes: number;
  breakOffsetMinutes: number | null;
  breakMinutes: number | null;
  timeZone: string;
};

export type MaterialisedShift = {
  startsAt: Date;
  endsAt: Date;
  breakStartsAt: Date | null;
  breakEndsAt: Date | null;
};

/** Resolve a template on a local date to the UTC instants an assignment stores. */
export function materialiseTemplate(
  template: TemplateShape,
  localDate: string
): MaterialisedShift {
  const start = localToUtcMs(localDate, template.localStart, template.timeZone);
  const hasBreak =
    template.breakOffsetMinutes !== null && template.breakMinutes !== null;

  return {
    startsAt: new Date(start),
    endsAt: new Date(start + template.durationMinutes * MINUTE_MS),
    breakStartsAt: hasBreak
      ? new Date(start + template.breakOffsetMinutes! * MINUTE_MS)
      : null,
    breakEndsAt: hasBreak
      ? new Date(
          start +
            (template.breakOffsetMinutes! + template.breakMinutes!) * MINUTE_MS
        )
      : null
  };
}
