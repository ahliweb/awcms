/**
 * Pure rules of the omnichannel inbox screens (Issue #1164, ADR-0160, UP-14).
 *
 * Kept out of the `.astro` files so each rule is unit-tested without
 * rendering: how a minute-of-day becomes a clock time, how a policy's working
 * week is summarised, and how the policy form's fields become the API body.
 * No database, no network.
 */
import type { WorkingHours } from "../../modules/omnichannel-inbox/domain/sla-calendar";

/** `540` -> `09:00`; `1440` -> `24:00` (a window may end at midnight). */
export function minutesToClock(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/** `09:30` -> `570`; anything else (or a minute outside 0-59, an hour above 24) -> `null`. */
export function clockToMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());

  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (minutes > 59 || hours > 24 || (hours === 24 && minutes !== 0)) {
    return null;
  }

  return hours * 60 + minutes;
}

/**
 * One entry per OPEN weekday, in week order: `{ isoWeekday: 1, window: "09:00-17:00" }`.
 * A closed day is absent, so a screen can say "closed" for the rest.
 */
export function openDays(
  hours: WorkingHours
): { isoWeekday: number; window: string }[] {
  const days: { isoWeekday: number; window: string }[] = [];

  hours.forEach((window, index) => {
    if (window) {
      days.push({
        isoWeekday: index + 1,
        window: `${minutesToClock(window.start)}-${minutesToClock(window.end)}`
      });
    }
  });

  return days;
}

export type PolicyFormFields = {
  name: string;
  timezone: string;
  firstResponseMinutes: number;
  nextResponseMinutes: number;
  /** ISO weekdays 1..7 that are open. */
  openWeekdays: number[];
  opensAt: string;
  closesAt: string;
  /** One `YYYY-MM-DD` per line. */
  holidays: string;
};

/**
 * The request body for `POST /sla-policies` (tenant default, `businessScope`
 * omitted), or `null` when the fields are not a usable window. The server
 * validates again and stays the authority; this only avoids a round trip for
 * the obvious mistakes (no open day, closing before opening).
 */
export function buildPolicyBody(fields: PolicyFormFields): {
  name: string;
  timezone: string;
  firstResponseMinutes: number;
  nextResponseMinutes: number;
  workingHours: ({ start: number; end: number } | null)[];
  holidays: string[];
} | null {
  const start = clockToMinutes(fields.opensAt);
  const end = clockToMinutes(fields.closesAt);

  if (start === null || end === null || start >= end) return null;

  if (fields.openWeekdays.length === 0) return null;

  const open = new Set(fields.openWeekdays);

  return {
    name: fields.name.trim(),
    timezone: fields.timezone.trim(),
    firstResponseMinutes: fields.firstResponseMinutes,
    nextResponseMinutes: fields.nextResponseMinutes,
    workingHours: [1, 2, 3, 4, 5, 6, 7].map((day) =>
      open.has(day) ? { start, end } : null
    ),
    holidays: [
      ...new Set(
        fields.holidays
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
      )
    ]
  };
}

/**
 * Where the next click on "rebuild" starts. The rebuild is batched and the
 * screen bounds how many batches one click runs, so a tenant with more events
 * than that must CONTINUE from where the last click stopped; starting from the
 * beginning every time would replay the same first events forever. A finished
 * rebuild resets to the beginning (a later rebuild is a fresh one), and so does
 * a malformed cursor (never resume from something the server did not say).
 */
export function rebuildResumePoint(
  complete: boolean,
  nextAfterSequence: unknown
): string {
  if (complete) return "0";

  return typeof nextAfterSequence === "string" &&
    /^[0-9]{1,20}$/.test(nextAfterSequence)
    ? nextAfterSequence
    : "0";
}
