/**
 * Workforce metrics -- the pure arithmetic and the small-group rule (Issue #953,
 * `docs/awcms/workforce-metrics.md`). No database.
 *
 * The things worth pinning: every definition of the contract gives the number it
 * says, a forgotten clock-out never becomes a long day, a group under the
 * threshold carries NO number, and the shape of a figure cannot carry a score or
 * anything about a device, photo or location.
 */
import { describe, expect, test } from "bun:test";

import {
  buildSessions,
  computeFacts,
  contributorBand,
  hasContribution,
  MIN_CONTRIBUTION_MINUTES,
  parseAggregateWindow,
  EMPTY_FACTS,
  LATE_GRACE_MINUTES,
  MAX_WINDOW_DAYS,
  parseMetricsWindow,
  ratio,
  SMALL_GROUP_MIN_CONTRIBUTORS,
  sumFacts,
  suppressIfSmall,
  WORKFORCE_METRIC_KEYS,
  type MetricEvent,
  type MetricShift,
  type WorkforceFacts
} from "../src/modules/hr-workforce/domain/hr-workforce-metrics";

const at = (iso: string) => new Date(`2026-10-05T${iso}:00Z`);
const event = (kind: MetricEvent["kind"], time: string): MetricEvent => ({
  kind,
  occurredAt: at(time)
});
const shift = (
  start: string,
  end: string,
  breakStart?: string,
  breakEnd?: string
): MetricShift => ({
  startsAt: at(start),
  endsAt: at(end),
  breakStartsAt: breakStart ? at(breakStart) : null,
  breakEndsAt: breakEnd ? at(breakEnd) : null
});

const WINDOW = {
  from: new Date("2026-10-05T00:00:00Z"),
  to: new Date("2026-10-06T00:00:00Z")
};
// Evening of the same day: every shift below has ended.
const NOW = new Date("2026-10-05T23:00:00Z");

describe("worked time and breaks", () => {
  test("a clock-in/clock-out pair is the minutes between, less the break taken", () => {
    const facts = computeFacts(
      [
        event("clock_in", "08:00"),
        event("break_start", "12:00"),
        event("break_end", "12:30"),
        event("clock_out", "16:00")
      ],
      [],
      WINDOW,
      NOW
    );

    expect(facts.workedMinutes).toBe(7 * 60 + 30);
    expect(facts.breakMinutes).toBe(30);
    expect(facts.incompleteSessions).toBe(0);
  });

  test("events are ordered by the claimed instant, not by the order they arrive", () => {
    const facts = computeFacts(
      [event("clock_out", "16:00"), event("clock_in", "08:00")],
      [],
      WINDOW,
      NOW
    );

    expect(facts.workedMinutes).toBe(8 * 60);
  });

  test("a break still open at the clock-out ends there", () => {
    const facts = computeFacts(
      [
        event("clock_in", "08:00"),
        event("break_start", "15:00"),
        event("clock_out", "16:00")
      ],
      [],
      WINDOW,
      NOW
    );

    expect(facts.breakMinutes).toBe(60);
    expect(facts.workedMinutes).toBe(7 * 60);
  });

  test("a duplicate clock-in, an orphan clock-out and a stray break are ignored, not corrected", () => {
    const { sessions } = buildSessions(
      [
        event("clock_out", "07:00"),
        event("break_start", "07:30"),
        event("clock_in", "08:00"),
        event("clock_in", "08:05"),
        event("clock_out", "16:00")
      ],
      NOW
    );

    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.clockIn).toEqual(at("08:00"));
  });

  test("a clock-in with no clock-out for over 24 hours is incomplete, never worked time", () => {
    const facts = computeFacts(
      [event("clock_in", "08:00")],
      [],
      WINDOW,
      new Date("2026-10-07T12:00:00Z")
    );

    expect(facts.workedMinutes).toBe(0);
    expect(facts.incompleteSessions).toBe(1);
  });

  test("a session still open and recent is simply not a fact yet", () => {
    const facts = computeFacts([event("clock_in", "20:00")], [], WINDOW, NOW);

    expect(facts.workedMinutes).toBe(0);
    expect(facts.incompleteSessions).toBe(0);
  });

  test("a session belongs to the window by its clock-in", () => {
    const facts = computeFacts(
      [
        event("clock_in", "23:00"),
        {
          kind: "clock_out",
          occurredAt: new Date("2026-10-06T03:00:00Z")
        }
      ],
      [],
      WINDOW,
      new Date("2026-10-06T12:00:00Z")
    );

    expect(facts.workedMinutes).toBe(4 * 60);
  });
});

describe("attendance and shift coverage", () => {
  test("a shift with a clock-in inside its range is attended; one with none that has ended is missed", () => {
    const facts = computeFacts(
      [event("clock_in", "08:00"), event("clock_out", "12:00")],
      [shift("08:00", "12:00"), shift("13:00", "17:00")],
      WINDOW,
      NOW
    );

    expect(facts.scheduledShifts).toBe(2);
    expect(facts.attendedShifts).toBe(1);
    expect(facts.missedShifts).toBe(1);
    expect(facts.coverageRatio).toBe(0.5);
  });

  test("a late arrival is a clock-in after the grace period, not before it", () => {
    const onTime = computeFacts(
      [event("clock_in", "08:05"), event("clock_out", "12:00")],
      [shift("08:00", "12:00")],
      WINDOW,
      NOW
    );
    const late = computeFacts(
      [event("clock_in", "08:06"), event("clock_out", "12:00")],
      [shift("08:00", "12:00")],
      WINDOW,
      NOW
    );

    expect(LATE_GRACE_MINUTES).toBe(5);
    expect(onTime.lateArrivals).toBe(0);
    expect(late.lateArrivals).toBe(1);
    expect(late.attendedShifts).toBe(1);
  });

  test("an early clock-in within two hours still belongs to the shift", () => {
    const facts = computeFacts(
      [event("clock_in", "06:30"), event("clock_out", "12:00")],
      [shift("08:00", "12:00")],
      WINDOW,
      NOW
    );

    expect(facts.attendedShifts).toBe(1);
    expect(facts.lateArrivals).toBe(0);
  });

  test("one clock-in matches at most one shift", () => {
    const facts = computeFacts(
      [event("clock_in", "08:00"), event("clock_out", "17:00")],
      [shift("08:00", "12:00"), shift("09:00", "13:00")],
      WINDOW,
      NOW
    );

    expect(facts.attendedShifts).toBe(1);
    expect(facts.missedShifts).toBe(1);
  });

  test("a shift that has not started, or is in progress and unmatched, is not a miss", () => {
    const facts = computeFacts(
      [],
      [shift("10:00", "14:00"), shift("22:00", "23:59")],
      WINDOW,
      new Date("2026-10-05T11:00:00Z")
    );

    // The 22:00 shift has not started and is not counted at all; the 10:00 one
    // is in progress, counted as scheduled, and not yet missed.
    expect(facts.scheduledShifts).toBe(1);
    expect(facts.missedShifts).toBe(0);
    expect(facts.coverageRatio).toBeNull();
  });

  test("scheduled minutes are the planned length less the planned break, of shifts that have ended", () => {
    const facts = computeFacts(
      [],
      [shift("08:00", "16:00", "12:00", "12:30")],
      WINDOW,
      NOW
    );

    expect(facts.scheduledMinutes).toBe(7 * 60 + 30);
  });
});

describe("productivity facts are ratios of two stated numbers", () => {
  test("worked over scheduled minutes, null when nothing was scheduled, and it may exceed one", () => {
    const overtime = computeFacts(
      [event("clock_in", "08:00"), event("clock_out", "18:00")],
      [shift("08:00", "16:00")],
      WINDOW,
      NOW
    );
    const unscheduled = computeFacts(
      [event("clock_in", "08:00"), event("clock_out", "16:00")],
      [],
      WINDOW,
      NOW
    );

    expect(overtime.workedToScheduledRatio).toBe(1.25);
    expect(unscheduled.workedToScheduledRatio).toBeNull();
    expect(ratio(1, 0)).toBeNull();
    expect(ratio(1, 3)).toBe(0.3333);
  });

  test("the reported figures are exactly the contract's keys: no score, rank or flag", () => {
    const facts = computeFacts([], [], WINDOW, NOW);
    const camel = (key: string) =>
      key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

    expect(Object.keys(facts).sort()).toEqual(
      [...WORKFORCE_METRIC_KEYS].map(camel).sort()
    );
    for (const forbidden of [
      "score",
      "rank",
      "rating",
      "grade",
      "flag",
      "risk",
      "photo",
      "biometric",
      "device",
      "latitude",
      "longitude",
      "location"
    ]) {
      expect(Object.keys(facts).some((key) => key.includes(forbidden))).toBe(
        false
      );
    }
  });
});

function contributor(shifts: number): WorkforceFacts {
  return {
    ...EMPTY_FACTS,
    scheduledShifts: shifts,
    attendedShifts: shifts,
    // A full eight-hour shift each: over the contributor floor.
    scheduledMinutes: shifts * 480,
    workedMinutes: shifts * 480
  };
}

describe("small-group suppression", () => {
  test("the threshold is five contributing employees", () => {
    expect(SMALL_GROUP_MIN_CONTRIBUTORS).toBe(5);
  });

  test("a group under the threshold carries NO number: not the facts, not even the count", () => {
    const figure = suppressIfSmall({ officeId: "oa" }, [
      contributor(3),
      contributor(2),
      contributor(4),
      contributor(1)
    ]);

    expect(figure).toEqual({
      group: { officeId: "oa" },
      suppressed: true,
      reason: "small_group"
    });
    expect(JSON.stringify(figure)).not.toMatch(/\d/);
  });

  test("a group at the threshold is reported, summed, with ratios recomputed from the sums", () => {
    const figure = suppressIfSmall({ officeId: "oa" }, [
      contributor(2),
      contributor(2),
      contributor(2),
      contributor(2),
      {
        ...EMPTY_FACTS,
        scheduledShifts: 2,
        missedShifts: 2,
        scheduledMinutes: 960
      }
    ]);

    expect(figure.suppressed).toBe(false);
    if (!figure.suppressed) {
      expect(figure.contributorsBand).toBe("5-9");
      expect(figure.facts.scheduledShifts).toBe(10);
      // 8 attended of 10 settled -- recomputed, not an average of ratios.
      expect(figure.facts.coverageRatio).toBe(0.8);
    }
  });

  test("an employee with nothing to report does not count toward the threshold", () => {
    const figure = suppressIfSmall({ officeId: "oa" }, [
      contributor(1),
      contributor(1),
      contributor(1),
      contributor(1),
      EMPTY_FACTS,
      EMPTY_FACTS
    ]);

    expect(figure.suppressed).toBe(true);
  });

  test("planted short shifts or sessions do not lift a group over the threshold", () => {
    const planted: WorkforceFacts = {
      ...EMPTY_FACTS,
      scheduledShifts: 1,
      attendedShifts: 1,
      scheduledMinutes: 1,
      workedMinutes: 1
    };
    const figure = suppressIfSmall({ officeId: "oa" }, [
      contributor(1),
      planted,
      planted,
      planted,
      planted,
      planted,
      planted
    ]);

    expect(MIN_CONTRIBUTION_MINUTES).toBe(240);
    expect(hasContribution(planted)).toBe(false);
    expect(figure.suppressed).toBe(true);
  });

  test("an employee just under the floor is out, one at the floor is in", () => {
    const at = (minutes: number): WorkforceFacts => ({
      ...EMPTY_FACTS,
      workedMinutes: minutes
    });

    expect(hasContribution(at(239))).toBe(false);
    expect(hasContribution(at(240))).toBe(true);
  });

  test("the contributor count is only ever a band", () => {
    expect(contributorBand(5)).toBe("5-9");
    expect(contributorBand(9)).toBe("5-9");
    expect(contributorBand(10)).toBe("10-19");
    expect(contributorBand(19)).toBe("10-19");
    expect(contributorBand(20)).toBe("20+");
    expect(contributorBand(400)).toBe("20+");
  });

  test("sliding-window differencing can no longer isolate a person: only whole closed buckets are accepted", () => {
    const now = new Date("2026-10-16T12:00:00Z");
    const ask = (from: string, to: string) =>
      parseAggregateWindow(new URLSearchParams({ from, to }), now);

    // The attack: the same range, one second (or one day) apart at the tail.
    expect(ask("2026-09-28T00:00:00Z", "2026-10-05T00:00:00Z").valid).toBe(
      true
    );
    expect(ask("2026-09-28T00:00:00Z", "2026-10-04T23:59:59Z").valid).toBe(
      false
    );
    expect(ask("2026-09-28T00:00:00Z", "2026-10-04T00:00:00Z").valid).toBe(
      false
    );
    expect(ask("2026-09-28T00:00:01Z", "2026-10-05T00:00:01Z").valid).toBe(
      false
    );
    // A week that starts on a Tuesday, a two-week span and a sub-week span.
    expect(ask("2026-09-29T00:00:00Z", "2026-10-06T00:00:00Z").valid).toBe(
      false
    );
    expect(ask("2026-09-28T00:00:00Z", "2026-10-12T00:00:00Z").valid).toBe(
      false
    );
    expect(ask("2026-09-28T00:00:00Z", "2026-09-29T00:00:00Z").valid).toBe(
      false
    );
    // A calendar month is NOT a bucket: month minus the whole weeks inside it
    // would leave the edge days, so only weeks are accepted and every accepted
    // window is disjoint from or identical to every other.
    expect(ask("2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z").valid).toBe(
      false
    );
    expect(ask("2026-09-02T00:00:00Z", "2026-10-02T00:00:00Z").valid).toBe(
      false
    );
    expect(ask("2026-09-01T00:00:00Z", "2026-09-30T00:00:00Z").valid).toBe(
      false
    );
    // A bucket still in progress is refused: its sums grow with the clock.
    expect(ask("2026-10-12T00:00:00Z", "2026-10-19T00:00:00Z").valid).toBe(
      false
    );
    expect(ask("2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z").valid).toBe(
      false
    );

    const accepted = ask("2026-09-28T00:00:00Z", "2026-10-05T00:00:00Z");

    expect(accepted.valid && accepted.value.bucket).toBe("iso_week");
  });

  test("sumFacts of nothing is the empty fact set", () => {
    expect(sumFacts([])).toEqual(EMPTY_FACTS);
  });
});

describe("window parsing", () => {
  const parse = (query: string) =>
    parseMetricsWindow(new URLSearchParams(query));

  test("accepts a UTC window and refuses everything else", () => {
    expect(
      parse("from=2026-10-01T00:00:00Z&to=2026-10-08T00:00:00Z").valid
    ).toBe(true);
    expect(parse("").valid).toBe(false);
    expect(parse("from=2026-10-01&to=2026-10-08").valid).toBe(false);
    expect(
      parse("from=2026-10-08T00:00:00Z&to=2026-10-01T00:00:00Z").valid
    ).toBe(false);
    expect(
      parse("from=2026-10-01T00:00:00+07:00&to=2026-10-08T00:00:00Z").valid
    ).toBe(false);
  });

  test("a window over the maximum is refused", () => {
    expect(MAX_WINDOW_DAYS).toBe(31);
    expect(
      parse("from=2026-09-01T00:00:00Z&to=2026-10-02T00:00:01Z").valid
    ).toBe(false);
    expect(
      parse("from=2026-09-01T00:00:00Z&to=2026-10-02T00:00:00Z").valid
    ).toBe(true);
  });
});
