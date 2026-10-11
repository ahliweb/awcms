/**
 * Interval algebra and the working-time rule behind `StaffAvailabilityPort`
 * (Issue #946, `docs/awcms/hr-payroll.md` section 5.3). Pure — instants in, instants out.
 *
 * Every interval is half-open `[start, end)` in epoch milliseconds, so two
 * intervals where one ends exactly where the next begins are ADJACENT and merge:
 * a consumer never sees a zero-width seam.
 *
 * WORKING TIME = (union of the work assignments, each minus its own break)
 *                minus (union of the time-off assignments),
 * clipped to the window. The caller has already dropped drafts, cancelled rows
 * and employments that were not active; this file knows none of that.
 */

export type Span = { start: number; end: number };

export type ScheduledAssignment = {
  kind: "work" | "time_off";
  start: number;
  end: number;
  breakStart: number | null;
  breakEnd: number | null;
};

/** Sorted, disjoint, merged (adjacent spans join). Empty and inverted spans are dropped. */
export function mergeSpans(spans: readonly Span[]): Span[] {
  const sorted = spans
    .filter((span) => span.end > span.start)
    .map((span) => ({ ...span }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Span[] = [];

  for (const span of sorted) {
    const last = merged[merged.length - 1];

    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
    } else {
      merged.push(span);
    }
  }

  return merged;
}

/** `from` minus `remove`, both treated as sets of instants. */
export function subtractSpans(
  from: readonly Span[],
  remove: readonly Span[]
): Span[] {
  const cuts = mergeSpans(remove);
  const result: Span[] = [];

  for (const span of mergeSpans(from)) {
    let cursor = span.start;

    for (const cut of cuts) {
      if (cut.end <= cursor || cut.start >= span.end) {
        continue;
      }

      if (cut.start > cursor) {
        result.push({ start: cursor, end: cut.start });
      }

      cursor = Math.max(cursor, cut.end);
    }

    if (cursor < span.end) {
      result.push({ start: cursor, end: span.end });
    }
  }

  return result;
}

export function clipSpans(spans: readonly Span[], window: Span): Span[] {
  return spans
    .map((span) => ({
      start: Math.max(span.start, window.start),
      end: Math.min(span.end, window.end)
    }))
    .filter((span) => span.end > span.start);
}

/** The working time of one person inside a window. See the header for the rule. */
export function computeWorkingTime(
  assignments: readonly ScheduledAssignment[],
  window: Span
): Span[] {
  const work: Span[] = [];
  const off: Span[] = [];

  for (const assignment of assignments) {
    if (assignment.kind === "time_off") {
      off.push({ start: assignment.start, end: assignment.end });
      continue;
    }

    const whole = { start: assignment.start, end: assignment.end };

    if (assignment.breakStart !== null && assignment.breakEnd !== null) {
      work.push(
        ...subtractSpans(
          [whole],
          [{ start: assignment.breakStart, end: assignment.breakEnd }]
        )
      );
    } else {
      work.push(whole);
    }
  }

  return clipSpans(mergeSpans(subtractSpans(mergeSpans(work), off)), window);
}
