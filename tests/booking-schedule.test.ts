/**
 * `booking` schedules, closures and exceptions (Issue #938, booking.md section
 * 2.2 and 4): the closed rules schema, which schedule applies to a date, and the
 * expansion of local weekly windows into UTC windows, DST included.
 */
import { describe, expect, test } from "bun:test";

import {
  closedDates,
  effectiveRangesOverlap,
  expandOpenWindows,
  selectSchedule,
  validateExceptionRange,
  validateOverrideWindows,
  validateScheduleRules,
  type ExceptionRecord,
  type ScheduleRecord,
  type ValidationError
} from "../src/modules/booking/domain/booking-schedule";

const RESOURCE = "11111111-1111-4111-8111-111111111111";
const OTHER_RESOURCE = "22222222-2222-4222-8222-222222222222";
const iso = (ms: number): string => new Date(ms).toISOString();

function schedule(overrides: Partial<ScheduleRecord> = {}): ScheduleRecord {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    resourceId: RESOURCE,
    timezone: "Asia/Pontianak",
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    status: "active",
    rules: {
      weekly: {
        mon: [{ from: "09:00", to: "17:00" }],
        tue: [{ from: "09:00", to: "17:00" }],
        wed: [{ from: "09:00", to: "17:00" }],
        thu: [{ from: "09:00", to: "17:00" }],
        fri: [{ from: "09:00", to: "17:00" }]
      }
    },
    ...overrides
  };
}

function exception(overrides: Partial<ExceptionRecord>): ExceptionRecord {
  return {
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    scheduleId: null,
    resourceId: RESOURCE,
    localFrom: "2026-10-12",
    localTo: "2026-10-13",
    kind: "closed",
    windows: null,
    ...overrides
  };
}

function windows(
  schedules: ScheduleRecord[],
  exceptions: ExceptionRecord[],
  fromIso: string,
  toIso: string,
  timezone = "Asia/Pontianak"
): string[] {
  return expandOpenWindows({
    resourceId: RESOURCE,
    timezone,
    schedules,
    exceptions,
    fromMs: Date.parse(fromIso),
    toMs: Date.parse(toIso)
  }).map((window) => `${iso(window.startMs)}..${iso(window.endMs)}`);
}

describe("the closed rules schema", () => {
  function errorsOf(raw: unknown): ValidationError[] {
    const result = validateScheduleRules(raw);

    return result.valid ? [] : result.errors;
  }

  test("accepts weekly windows, an empty weekday and the 24:00 end of day", () => {
    expect(
      validateScheduleRules({
        weekly: {
          mon: [
            { from: "08:00", to: "12:00" },
            { from: "13:00", to: "24:00" }
          ],
          sun: []
        }
      }).valid
    ).toBe(true);
    expect(validateScheduleRules({ weekly: {} }).valid).toBe(true);
  });

  test.each([
    ["not an object", "mon"],
    ["an array", []],
    ["missing weekly", {}],
    ["a recurrence string", { weekly: {}, rrule: "FREQ=WEEKLY" }],
    ["an unknown weekday", { weekly: { monday: [] } }],
    ["windows not an array", { weekly: { mon: "09:00-17:00" } }],
    [
      "a window that ends before it starts",
      { weekly: { mon: [{ from: "17:00", to: "09:00" }] } }
    ],
    [
      "a zero-length window",
      { weekly: { mon: [{ from: "09:00", to: "09:00" }] } }
    ],
    [
      "a window crossing midnight",
      { weekly: { mon: [{ from: "22:00", to: "02:00" }] } }
    ],
    ["from at 24:00", { weekly: { mon: [{ from: "24:00", to: "24:00" }] } }],
    ["a bad time", { weekly: { mon: [{ from: "9am", to: "17:00" }] } }],
    [
      "an extra key in a window",
      { weekly: { mon: [{ from: "09:00", to: "10:00", note: "x" }] } }
    ],
    [
      "overlapping windows",
      {
        weekly: {
          mon: [
            { from: "09:00", to: "12:00" },
            { from: "11:00", to: "13:00" }
          ]
        }
      }
    ],
    [
      "descending windows",
      {
        weekly: {
          mon: [
            { from: "13:00", to: "14:00" },
            { from: "09:00", to: "10:00" }
          ]
        }
      }
    ],
    [
      "more than eight windows",
      {
        weekly: {
          mon: Array.from({ length: 9 }, (_, index) => ({
            from: `${String(index).padStart(2, "0")}:00`,
            to: `${String(index).padStart(2, "0")}:30`
          }))
        }
      }
    ]
  ])("refuses %s", (_name, raw) => {
    expect(errorsOf(raw).length).toBeGreaterThan(0);
  });

  test("touching windows are allowed (half-open)", () => {
    expect(
      validateScheduleRules({
        weekly: {
          mon: [
            { from: "09:00", to: "12:00" },
            { from: "12:00", to: "17:00" }
          ]
        }
      }).valid
    ).toBe(true);
  });

  test("override windows share the weekday-window shape", () => {
    expect(
      validateOverrideWindows([{ from: "10:00", to: "14:00" }]).valid
    ).toBe(true);
    expect(
      validateOverrideWindows([{ from: "14:00", to: "10:00" }]).valid
    ).toBe(false);
    expect(validateOverrideWindows("nope").valid).toBe(false);
  });

  test("exception ranges are half-open local dates, at most 366 days", () => {
    const check = (from: unknown, to: unknown): boolean => {
      const errors: ValidationError[] = [];

      return validateExceptionRange(from, to, errors) && errors.length === 0;
    };

    expect(check("2026-12-24", "2026-12-27")).toBe(true);
    expect(check("2026-12-24", "2026-12-24")).toBe(false);
    expect(check("2026-12-27", "2026-12-24")).toBe(false);
    expect(check("2026-12-24", "2026-12-24T00:00:00Z")).toBe(false);
    expect(check("2026-01-01", "2027-01-02")).toBe(true);
    expect(check("2026-01-01", "2027-01-03")).toBe(false);
  });
});

describe("overlap of effective windows (the twin of the exclusion constraint)", () => {
  test.each([
    [["2026-01-01", "2026-02-01"], ["2026-02-01", "2026-03-01"], false],
    [["2026-01-01", "2026-02-02"], ["2026-02-01", "2026-03-01"], true],
    [["2026-01-01", null], ["2030-01-01", "2030-02-01"], true],
    [["2026-01-01", "2026-02-01"], ["2025-01-01", null], true],
    [["2026-02-01", null], ["2025-01-01", "2026-02-01"], false],
    [["2026-01-01", null], ["2026-01-01", null], true]
  ] as const)("%j vs %j overlap = %p", (left, right, expected) => {
    expect(
      effectiveRangesOverlap(
        { effectiveFrom: left[0], effectiveTo: left[1] },
        { effectiveFrom: right[0], effectiveTo: right[1] }
      )
    ).toBe(expected);
  });
});

describe("which schedule applies to a date", () => {
  const bound = schedule({ id: "b", resourceId: RESOURCE });
  const tenantDefault = schedule({ id: "d", resourceId: null });

  test("a resource-bound schedule beats the tenant default", () => {
    expect(
      selectSchedule(
        [tenantDefault, bound],
        RESOURCE,
        "Asia/Pontianak",
        "2026-10-12"
      )?.id
    ).toBe("b");
  });

  test("a tenant default applies when none is bound", () => {
    expect(
      selectSchedule([tenantDefault], RESOURCE, "Asia/Pontianak", "2026-10-12")
        ?.id
    ).toBe("d");
  });

  test("another resource's schedule never applies", () => {
    expect(
      selectSchedule(
        [schedule({ id: "x", resourceId: OTHER_RESOURCE })],
        RESOURCE,
        "Asia/Pontianak",
        "2026-10-12"
      )
    ).toBeNull();
  });

  test("a schedule in another zone is ignored, not guessed at", () => {
    expect(
      selectSchedule([tenantDefault], RESOURCE, "Asia/Jakarta", "2026-10-12")
    ).toBeNull();
  });

  test("the effective window is half-open and inactive schedules never apply", () => {
    const ending = schedule({
      effectiveFrom: "2026-01-01",
      effectiveTo: "2026-10-12"
    });

    expect(
      selectSchedule([ending], RESOURCE, "Asia/Pontianak", "2026-10-11")
    ).not.toBeNull();
    expect(
      selectSchedule([ending], RESOURCE, "Asia/Pontianak", "2026-10-12")
    ).toBeNull();
    expect(
      selectSchedule(
        [schedule({ effectiveFrom: "2026-10-13" })],
        RESOURCE,
        "Asia/Pontianak",
        "2026-10-12"
      )
    ).toBeNull();
    expect(
      selectSchedule(
        [schedule({ status: "inactive" })],
        RESOURCE,
        "Asia/Pontianak",
        "2026-10-12"
      )
    ).toBeNull();
  });
});

describe("expansion to UTC windows", () => {
  test("Mon-Fri 09:00-17:00 in Asia/Pontianak (UTC+7) is 02:00Z-10:00Z", () => {
    // Mon 12 Oct 2026 .. Wed 14 Oct 2026
    expect(
      windows([schedule()], [], "2026-10-12T00:00:00Z", "2026-10-15T00:00:00Z")
    ).toEqual([
      "2026-10-12T02:00:00.000Z..2026-10-12T10:00:00.000Z",
      "2026-10-13T02:00:00.000Z..2026-10-13T10:00:00.000Z",
      "2026-10-14T02:00:00.000Z..2026-10-14T10:00:00.000Z"
    ]);
  });

  test("weekend days have no windows", () => {
    // Sat 17 Oct and Sun 18 Oct 2026
    expect(
      windows([schedule()], [], "2026-10-17T00:00:00Z", "2026-10-19T00:00:00Z")
    ).toEqual([]);
  });

  test("a window whose UTC date differs from its local date is not lost at the query edge", () => {
    // Mon 09:00 local is Mon 02:00Z, but a query for Sun 17:00Z-Mon 03:00Z (Mon 00:00-10:00 local) must still see it.
    expect(
      windows([schedule()], [], "2026-10-11T17:00:00Z", "2026-10-12T03:00:00Z")
    ).toEqual(["2026-10-12T02:00:00.000Z..2026-10-12T10:00:00.000Z"]);
  });

  test("touching windows merge into one", () => {
    const split = schedule({
      rules: {
        weekly: {
          mon: [
            { from: "09:00", to: "12:00" },
            { from: "12:00", to: "17:00" }
          ]
        }
      }
    });

    expect(
      windows([split], [], "2026-10-12T00:00:00Z", "2026-10-13T00:00:00Z")
    ).toEqual(["2026-10-12T02:00:00.000Z..2026-10-12T10:00:00.000Z"]);
  });

  test("a rule that does not validate opens nothing (fail closed)", () => {
    const broken = schedule({
      rules: { weekly: { mon: [{ from: "17:00", to: "09:00" }] }, rrule: "x" }
    });

    expect(
      windows([broken], [], "2026-10-12T00:00:00Z", "2026-10-13T00:00:00Z")
    ).toEqual([]);
  });

  test("no schedule, no windows", () => {
    expect(
      windows([], [], "2026-10-12T00:00:00Z", "2026-10-13T00:00:00Z")
    ).toEqual([]);
  });

  describe("across daylight saving (America/New_York)", () => {
    const newYork = schedule({
      timezone: "America/New_York",
      rules: {
        weekly: {
          sun: [{ from: "01:00", to: "04:00" }],
          sat: [{ from: "09:00", to: "17:00" }]
        }
      }
    });
    const expand = (from: string, to: string): string[] =>
      windows([newYork], [], from, to, "America/New_York");

    test("the spring-forward Sunday 01:00-04:00 local is two real hours", () => {
      expect(expand("2026-03-08T00:00:00Z", "2026-03-09T00:00:00Z")).toEqual([
        "2026-03-08T06:00:00.000Z..2026-03-08T08:00:00.000Z"
      ]);
    });

    test("the fall-back Sunday 01:00-04:00 local is four real hours", () => {
      expect(expand("2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z")).toEqual([
        "2026-11-01T05:00:00.000Z..2026-11-01T09:00:00.000Z"
      ]);
    });

    test("a Saturday window moves by an hour across the change in UTC, not in local time", () => {
      expect(expand("2026-03-07T00:00:00Z", "2026-03-08T00:00:00Z")).toEqual([
        "2026-03-07T14:00:00.000Z..2026-03-07T22:00:00.000Z"
      ]);
      expect(expand("2026-03-14T00:00:00Z", "2026-03-15T00:00:00Z")).toEqual([
        "2026-03-14T13:00:00.000Z..2026-03-14T21:00:00.000Z"
      ]);
    });

    test("a window whose start falls in the gap starts after it (offset before the gap)", () => {
      const inGap = schedule({
        timezone: "America/New_York",
        rules: { weekly: { sun: [{ from: "02:30", to: "05:00" }] } }
      });

      // 02:30 EST = 07:30Z; 05:00 EDT = 09:00Z.
      expect(
        windows(
          [inGap],
          [],
          "2026-03-08T00:00:00Z",
          "2026-03-09T00:00:00Z",
          "America/New_York"
        )
      ).toEqual(["2026-03-08T07:30:00.000Z..2026-03-08T09:00:00.000Z"]);
    });
  });

  describe("exceptions", () => {
    test("a closed day removes that date's windows only (a resource-owned closure)", () => {
      expect(
        windows(
          [schedule()],
          [exception({})],
          "2026-10-12T00:00:00Z",
          "2026-10-14T00:00:00Z"
        )
      ).toEqual(["2026-10-13T02:00:00.000Z..2026-10-13T10:00:00.000Z"]);
    });

    test("a schedule-owned closure applies only when that schedule is the selected one", () => {
      const own = schedule({ id: "s1" });
      const closure = exception({ scheduleId: "s1", resourceId: null });
      const foreign = exception({ scheduleId: "other", resourceId: null });

      expect(
        windows(
          [own],
          [closure],
          "2026-10-12T00:00:00Z",
          "2026-10-13T00:00:00Z"
        )
      ).toEqual([]);
      expect(
        windows(
          [own],
          [foreign],
          "2026-10-12T00:00:00Z",
          "2026-10-13T00:00:00Z"
        )
      ).toHaveLength(1);
    });

    test("closure ranges are half-open: the day after localTo is open", () => {
      expect(
        windows(
          [schedule()],
          [exception({ localFrom: "2026-10-12", localTo: "2026-10-14" })],
          "2026-10-12T00:00:00Z",
          "2026-10-15T00:00:00Z"
        )
      ).toEqual(["2026-10-14T02:00:00.000Z..2026-10-14T10:00:00.000Z"]);
    });

    test("override hours replace the day's windows", () => {
      const override = exception({
        kind: "override_hours",
        windows: [{ from: "10:00", to: "12:00" }]
      });

      expect(
        windows(
          [schedule()],
          [override],
          "2026-10-12T00:00:00Z",
          "2026-10-13T00:00:00Z"
        )
      ).toEqual(["2026-10-12T03:00:00.000Z..2026-10-12T05:00:00.000Z"]);
    });

    test("override hours can open a weekend day the schedule keeps closed", () => {
      const override = exception({
        localFrom: "2026-10-17",
        localTo: "2026-10-18",
        kind: "override_hours",
        windows: [{ from: "10:00", to: "12:00" }]
      });

      expect(
        windows(
          [schedule()],
          [override],
          "2026-10-17T00:00:00Z",
          "2026-10-18T00:00:00Z"
        )
      ).toEqual(["2026-10-17T03:00:00.000Z..2026-10-17T05:00:00.000Z"]);
    });

    test("a closure beats an override on the same date", () => {
      const override = exception({
        id: "o",
        kind: "override_hours",
        windows: [{ from: "10:00", to: "12:00" }]
      });

      expect(
        windows(
          [schedule()],
          [override, exception({ id: "c" })],
          "2026-10-12T00:00:00Z",
          "2026-10-13T00:00:00Z"
        )
      ).toEqual([]);
    });

    test("an override does not conjure a schedule where none covers the date", () => {
      const override = exception({
        kind: "override_hours",
        windows: [{ from: "10:00", to: "12:00" }]
      });

      expect(
        windows([], [override], "2026-10-12T00:00:00Z", "2026-10-13T00:00:00Z")
      ).toEqual([]);
    });
  });
});

describe("closed dates for a stay (a soft closure, booking.md section 2.5)", () => {
  const input = {
    resourceId: RESOURCE,
    timezone: "Asia/Pontianak",
    schedules: [schedule()],
    fromDate: "2026-10-10",
    toDate: "2026-10-16"
  };

  test("lists the closed dates in the range, half-open", () => {
    expect(
      closedDates({
        ...input,
        exceptions: [
          exception({ localFrom: "2026-10-12", localTo: "2026-10-14" })
        ]
      })
    ).toEqual(["2026-10-12", "2026-10-13"]);
  });

  test("counts a closure even where no schedule covers the date, and ignores an override", () => {
    expect(
      closedDates({ ...input, schedules: [], exceptions: [exception({})] })
    ).toEqual(["2026-10-12"]);
    expect(
      closedDates({
        ...input,
        exceptions: [
          exception({
            kind: "override_hours",
            windows: [{ from: "10:00", to: "12:00" }]
          })
        ]
      })
    ).toEqual([]);
  });
});
