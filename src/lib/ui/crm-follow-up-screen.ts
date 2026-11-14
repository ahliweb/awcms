/**
 * Pure rules of the follow-up screens (Issue #1165, ADR-0159): how a stored
 * minute-of-day and a working-minute offset become text. No database, no
 * network; unit-tested without rendering.
 */

/** `540` -> `09:00`; `1440` -> `24:00` (a window may end at midnight). */
export function minutesToClock(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/**
 * A working-minute offset as `{ hours, minutes }` parts (`90` -> 1 h 30 min), so
 * the screen can say "1 h 30 min of working time" without a raw number of
 * minutes. `0` is `{ hours: 0, minutes: 0 }`.
 */
export function offsetParts(totalMinutes: number): {
  hours: number;
  minutes: number;
} {
  const safe = Number.isFinite(totalMinutes) ? Math.max(0, totalMinutes) : 0;

  return { hours: Math.floor(safe / 60), minutes: Math.floor(safe % 60) };
}

/** The request body of the tenant switch (`PATCH /settings`). */
export function switchBody(currentlyOn: boolean): { enabled: boolean } {
  return { enabled: !currentlyOn };
}
