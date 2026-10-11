/**
 * `booking` availability (Issue #938, booking.md section 2.1, 2.3 and 2.5;
 * ADR-0135): table tests over the pure slot and stay functions. No database, no
 * clock: `nowMs` is a fixture.
 */
import { describe, expect, test } from "bun:test";

import {
  AVAILABILITY_LIMITS,
  computeSlotAvailability,
  dateIntervalsOverlap,
  evaluateStay,
  intervalsOverlap,
  type SlotQuery,
  type StayQuery,
  type UnitFacts
} from "../src/modules/booking/domain/booking-availability";
import {
  expandOpenWindows,
  type ScheduleRecord
} from "../src/modules/booking/domain/booking-schedule";
import { daysBetween } from "../src/modules/booking/domain/booking-time";

const HOUR = 3_600_000;
const t = (value: string): number => Date.parse(value);
const iso = (ms: number): string => new Date(ms).toISOString();

const unit = (id: string, occupied: [string, string][] = []): UnitFacts => ({
  unitId: id,
  occupied: occupied.map(([from, to]) => ({ fromMs: t(from), toMs: t(to) })),
  stays: []
});

function slotQuery(overrides: Partial<SlotQuery> = {}): SlotQuery {
  return {
    fromMs: t("2026-10-12T00:00:00Z"),
    toMs: t("2026-10-13T00:00:00Z"),
    nowMs: t("2026-10-01T00:00:00Z"),
    durationSeconds: 3600,
    setupSeconds: 0,
    cleanupSeconds: 0,
    stepSeconds: 3600,
    quantity: 1,
    minLeadSeconds: 0,
    maxHorizonDays: 365,
    // 09:00-12:00 local at UTC+7 = 02:00Z-05:00Z
    openWindows: [
      { startMs: t("2026-10-12T02:00:00Z"), endMs: t("2026-10-12T05:00:00Z") }
    ],
    units: [unit("u1")],
    limit: 100,
    ...overrides
  };
}

const starts = (query: SlotQuery): string[] =>
  computeSlotAvailability(query).slots.map((slot) => iso(slot.startMs));

describe("interval semantics are half-open", () => {
  test.each([
    [10, 11, 11, 12, false],
    [10, 12, 11, 13, true],
    [10, 11, 10, 11, true],
    [10, 14, 11, 12, true],
    [11, 12, 10, 11, false]
  ])("[%d,%d) vs [%d,%d) overlap = %p", (aFrom, aTo, bFrom, bTo, expected) => {
    expect(intervalsOverlap(aFrom, aTo, bFrom, bTo)).toBe(expected);
  });

  test.each([
    ["2026-10-10", "2026-10-12", "2026-10-12", "2026-10-14", false],
    ["2026-10-10", "2026-10-13", "2026-10-12", "2026-10-14", true],
    ["2026-10-12", "2026-10-13", "2026-10-12", "2026-10-13", true]
  ])("dates [%s,%s) vs [%s,%s) overlap = %p", (a1, a2, b1, b2, expected) => {
    expect(dateIntervalsOverlap(a1, a2, b1, b2)).toBe(expected);
  });
});

describe("slots", () => {
  test("hourly slots fill the window, the last one ending exactly at closing", () => {
    expect(starts(slotQuery())).toEqual([
      "2026-10-12T02:00:00.000Z",
      "2026-10-12T03:00:00.000Z",
      "2026-10-12T04:00:00.000Z"
    ]);
  });

  test("a slot that would end after closing is not offered", () => {
    expect(
      starts(slotQuery({ durationSeconds: 5400, stepSeconds: 1800 }))
    ).toEqual([
      "2026-10-12T02:00:00.000Z",
      "2026-10-12T02:30:00.000Z",
      "2026-10-12T03:00:00.000Z",
      "2026-10-12T03:30:00.000Z"
    ]);
  });

  test("a duration longer than the window offers nothing", () => {
    expect(starts(slotQuery({ durationSeconds: 4 * 3600 }))).toEqual([]);
  });

  test("the search window clips slots: a slot must lie inside [from, to)", () => {
    expect(
      starts(
        slotQuery({
          fromMs: t("2026-10-12T03:00:00Z"),
          toMs: t("2026-10-12T04:30:00Z")
        })
      )
    ).toEqual(["2026-10-12T03:00:00.000Z"]);
  });

  test("a booking 10:00-11:00 and a slot 11:00-12:00 share a boundary and do not overlap", () => {
    const booked = slotQuery({
      units: [unit("u1", [["2026-10-12T03:00:00Z", "2026-10-12T04:00:00Z"]])]
    });

    expect(starts(booked)).toEqual([
      "2026-10-12T02:00:00.000Z",
      "2026-10-12T04:00:00.000Z"
    ]);
  });

  test("an existing booking removes exactly the slots that overlap it", () => {
    const booked = slotQuery({
      stepSeconds: 1800,
      units: [unit("u1", [["2026-10-12T03:00:00Z", "2026-10-12T04:00:00Z"]])]
    });

    // 02:30-03:30 and 03:30-04:30 overlap 03:00-04:00; 03:00-04:00 itself too.
    expect(starts(booked)).toEqual([
      "2026-10-12T02:00:00.000Z",
      "2026-10-12T04:00:00.000Z"
    ]);
  });

  describe("buffers (booking.md section 2.3)", () => {
    test("the occupied range, not the service interval, is tested against bookings", () => {
      // Existing booking occupies 03:00-04:00. A slot 04:00-05:00 with 15 min setup
      // occupies 03:45-05:00 and collides.
      const withSetup = slotQuery({
        setupSeconds: 900,
        units: [unit("u1", [["2026-10-12T03:00:00Z", "2026-10-12T04:00:00Z"]])]
      });

      // 02:00-03:00 occupies 01:45-03:00 (free: it ends where the booking starts);
      // 03:00 collides; 04:00 occupies 03:45-05:00 and collides.
      expect(starts(withSetup)).toEqual(["2026-10-12T02:00:00.000Z"]);
    });

    test("cleanup after a slot also blocks the next one", () => {
      const withCleanup = slotQuery({
        cleanupSeconds: 900,
        units: [unit("u1", [["2026-10-12T04:00:00Z", "2026-10-12T05:00:00Z"]])]
      });

      // 03:00-04:00 occupies 03:00-04:15, overlapping the booking from 04:00.
      expect(starts(withCleanup)).toEqual(["2026-10-12T02:00:00.000Z"]);
    });

    test("buffers may extend past the window edge: only the service interval must fit", () => {
      const result = starts(
        slotQuery({ setupSeconds: 1800, cleanupSeconds: 1800 })
      );

      expect(result).toEqual([
        "2026-10-12T02:00:00.000Z",
        "2026-10-12T03:00:00.000Z",
        "2026-10-12T04:00:00.000Z"
      ]);
    });

    test("two buffered neighbours cannot overlap their buffers (no shared turnaround)", () => {
      const query = slotQuery({
        setupSeconds: 600,
        cleanupSeconds: 600,
        units: [unit("u1", [["2026-10-12T02:00:00Z", "2026-10-12T03:10:00Z"]])]
      });

      // The booking occupies to 03:10; the 03:00 slot occupies from 02:50, the 04:00 one from 03:50.
      expect(starts(query)).toEqual(["2026-10-12T04:00:00.000Z"]);
    });
  });

  describe("capacity and quantity", () => {
    const busy: [string, string][] = [
      ["2026-10-12T03:00:00Z", "2026-10-12T04:00:00Z"]
    ];

    test("a slot is offered while ANY unit is free, with the free count", () => {
      const result = computeSlotAvailability(
        slotQuery({ units: [unit("u1", busy), unit("u2"), unit("u3")] })
      );

      expect(result.slots.map((slot) => slot.freeUnits)).toEqual([3, 2, 3]);
    });

    test("quantity needs that many free units at once", () => {
      const query = slotQuery({
        quantity: 2,
        units: [unit("u1", busy), unit("u2")]
      });

      expect(starts(query)).toEqual([
        "2026-10-12T02:00:00.000Z",
        "2026-10-12T04:00:00.000Z"
      ]);
    });

    test("quantity above the unit count offers nothing", () => {
      expect(starts(slotQuery({ quantity: 2 }))).toEqual([]);
    });
  });

  describe("lead time and horizon", () => {
    test("a minimum lead time removes slots that start too soon", () => {
      // now 02:30Z + 1h lead => earliest start 03:30Z => the next whole step is 04:00Z.
      expect(
        starts(
          slotQuery({ nowMs: t("2026-10-12T02:30:00Z"), minLeadSeconds: 3600 })
        )
      ).toEqual(["2026-10-12T04:00:00.000Z"]);
      expect(
        starts(
          slotQuery({ nowMs: t("2026-10-12T01:30:00Z"), minLeadSeconds: 3600 })
        )
      ).toEqual(["2026-10-12T03:00:00.000Z", "2026-10-12T04:00:00.000Z"]);
    });

    test("a slot starting exactly at now + lead is allowed", () => {
      expect(
        starts(
          slotQuery({ nowMs: t("2026-10-12T01:00:00Z"), minLeadSeconds: 3600 })
        )
      ).toEqual([
        "2026-10-12T02:00:00.000Z",
        "2026-10-12T03:00:00.000Z",
        "2026-10-12T04:00:00.000Z"
      ]);
    });

    test("a slot in the past is never offered", () => {
      expect(starts(slotQuery({ nowMs: t("2026-10-12T03:00:00Z") }))).toEqual([
        "2026-10-12T03:00:00.000Z",
        "2026-10-12T04:00:00.000Z"
      ]);
    });

    test("the horizon is exclusive", () => {
      const now = t("2026-10-12T02:00:00Z") - 10 * 86_400_000;

      expect(starts(slotQuery({ nowMs: now, maxHorizonDays: 10 })).length).toBe(
        0
      );
      expect(starts(slotQuery({ nowMs: now, maxHorizonDays: 11 })).length).toBe(
        3
      );
    });
  });

  test("the staff seam only narrows", () => {
    const query = slotQuery({
      staffAllows: (startMs) => startMs !== t("2026-10-12T03:00:00Z")
    });

    expect(starts(query)).toEqual([
      "2026-10-12T02:00:00.000Z",
      "2026-10-12T04:00:00.000Z"
    ]);
    expect(starts(slotQuery({ staffAllows: null }))).toEqual(
      starts(slotQuery())
    );
  });

  test("the result is bounded and says when it is truncated", () => {
    const wide = slotQuery({
      openWindows: [
        { startMs: t("2026-10-12T00:00:00Z"), endMs: t("2026-10-13T00:00:00Z") }
      ],
      limit: 5
    });
    const result = computeSlotAvailability(wide);

    expect(result.slots).toHaveLength(5);
    expect(result.truncated).toBe(true);
    expect(computeSlotAvailability({ ...wide, limit: 24 }).truncated).toBe(
      false
    );
    expect(
      computeSlotAvailability({ ...wide, limit: 10_000 }).slots.length
    ).toBeLessThanOrEqual(AVAILABILITY_LIMITS.maxSlots);
  });

  test("candidates evaluated are capped: a pathological step is truncated, not a runaway loop", () => {
    const result = computeSlotAvailability(
      slotQuery({
        stepSeconds: 1,
        durationSeconds: 1,
        // everything is busy, so no slot is ever returned: only the cap stops the loop
        units: [unit("u1", [["2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z"]])],
        openWindows: [
          {
            startMs: t("2026-10-12T00:00:00Z"),
            endMs: t("2026-10-13T00:00:00Z")
          }
        ]
      })
    );

    expect(result.slots).toEqual([]);
    expect(result.truncated).toBe(true);
  });

  test("the same input yields the same answer (no hidden clock)", () => {
    expect(computeSlotAvailability(slotQuery())).toEqual(
      computeSlotAvailability(slotQuery())
    );
  });

  describe("slots across daylight saving, from a schedule (America/New_York)", () => {
    const newYork = (rules: ScheduleRecord["rules"]): ScheduleRecord => ({
      id: "s",
      resourceId: "r",
      timezone: "America/New_York",
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      status: "active",
      rules
    });
    const slotsFor = (
      rules: ScheduleRecord["rules"],
      from: string,
      to: string
    ): string[] => {
      const fromMs = t(from);
      const toMs = t(to);

      return computeSlotAvailability(
        slotQuery({
          fromMs,
          toMs,
          nowMs: t("2026-01-01T00:00:00Z"),
          openWindows: expandOpenWindows({
            resourceId: "r",
            timezone: "America/New_York",
            schedules: [newYork(rules)],
            exceptions: [],
            fromMs,
            toMs
          })
        })
      ).slots.map((slot) => iso(slot.startMs));
    };

    test("GAP: an hourly 01:00-04:00 local window on the spring-forward day has two real slots", () => {
      expect(
        slotsFor(
          { weekly: { sun: [{ from: "01:00", to: "04:00" }] } },
          "2026-03-08T00:00:00Z",
          "2026-03-09T00:00:00Z"
        )
      ).toEqual(["2026-03-08T06:00:00.000Z", "2026-03-08T07:00:00.000Z"]);
    });

    test("FOLD: the same window on the fall-back day has four real slots, 01:00 EDT repeated as 01:00 EST", () => {
      expect(
        slotsFor(
          { weekly: { sun: [{ from: "01:00", to: "04:00" }] } },
          "2026-11-01T00:00:00Z",
          "2026-11-02T00:00:00Z"
        )
      ).toEqual([
        "2026-11-01T05:00:00.000Z",
        "2026-11-01T06:00:00.000Z",
        "2026-11-01T07:00:00.000Z",
        "2026-11-01T08:00:00.000Z"
      ]);
    });

    test("a window starting inside the gap starts after it (02:30 EST = 07:30Z; the window ends 05:00 EDT = 09:00Z, so one hour fits)", () => {
      expect(
        slotsFor(
          { weekly: { sun: [{ from: "02:30", to: "05:00" }] } },
          "2026-03-08T00:00:00Z",
          "2026-03-09T00:00:00Z"
        )
      ).toEqual(["2026-03-08T07:30:00.000Z"]);
    });

    test("a normal day is unaffected: 09:00-12:00 local on a Saturday", () => {
      expect(
        slotsFor(
          { weekly: { sat: [{ from: "09:00", to: "12:00" }] } },
          "2026-03-07T00:00:00Z",
          "2026-03-08T00:00:00Z"
        )
      ).toEqual([
        "2026-03-07T14:00:00.000Z",
        "2026-03-07T15:00:00.000Z",
        "2026-03-07T16:00:00.000Z"
      ]);
    });
  });
});

function stayQuery(overrides: Partial<StayQuery> = {}): StayQuery {
  return {
    checkInDate: "2026-10-20",
    checkOutDate: "2026-10-23",
    timezone: "Asia/Pontianak",
    checkInSeconds: 14 * 3600,
    checkOutSeconds: 12 * 3600,
    nowMs: t("2026-10-12T00:00:00Z"),
    minLeadSeconds: 0,
    maxHorizonDays: 365,
    minNights: 1,
    maxNights: 30,
    quantity: 1,
    units: [{ unitId: "u1", occupied: [], stays: [] }],
    blocks: [],
    closedDates: [],
    ...overrides
  };
}

const codes = (query: StayQuery): string[] =>
  evaluateStay(query).reasons.map((reason) => reason.code);

describe("stays (ADR-0135)", () => {
  test("a free stay is available with nights = check-out minus check-in", () => {
    const evaluation = evaluateStay(stayQuery());

    expect(evaluation.available).toBe(true);
    expect(evaluation.nights).toBe(3);
    expect(evaluation.freeUnits).toBe(1);
    expect(evaluation.reasons).toEqual([]);
    // 14:00 / 12:00 local at UTC+7
    expect(iso(evaluation.arrivalMs!)).toBe("2026-10-20T07:00:00.000Z");
    expect(iso(evaluation.departureMs!)).toBe("2026-10-23T05:00:00.000Z");
  });

  describe("same-day turnover is allowed by construction", () => {
    const occupied = (from: string, to: string): UnitFacts => ({
      unitId: "u1",
      occupied: [],
      stays: [{ from, to }]
    });

    test("a stay may start on the day another checks out", () => {
      expect(
        evaluateStay(
          stayQuery({
            checkInDate: "2026-10-23",
            checkOutDate: "2026-10-25",
            units: [occupied("2026-10-20", "2026-10-23")]
          })
        ).available
      ).toBe(true);
    });

    test("a stay may end on the day another checks in", () => {
      expect(
        evaluateStay(
          stayQuery({
            checkInDate: "2026-10-18",
            checkOutDate: "2026-10-20",
            units: [occupied("2026-10-20", "2026-10-23")]
          })
        ).available
      ).toBe(true);
    });

    test("sharing one night is a conflict", () => {
      expect(
        codes(
          stayQuery({
            checkInDate: "2026-10-22",
            checkOutDate: "2026-10-24",
            units: [occupied("2026-10-20", "2026-10-23")]
          })
        )
      ).toEqual(["NO_UNIT_AVAILABLE"]);
    });

    test("a stay wholly inside another is a conflict", () => {
      expect(
        codes(stayQuery({ units: [occupied("2026-10-19", "2026-10-30")] }))
      ).toEqual(["NO_UNIT_AVAILABLE"]);
    });
  });

  describe("a block is a hard exclusion", () => {
    test("a block on the unit's nights makes it unavailable, and nothing overrides it", () => {
      const evaluation = evaluateStay(
        stayQuery({
          blocks: [{ unitId: "u1", from: "2026-10-21", to: "2026-10-22" }]
        })
      );

      expect(evaluation.available).toBe(false);
      expect(evaluation.reasons).toEqual([
        { code: "BLOCKED", overridable: false }
      ]);
    });

    test("a block of every unit (null unit) excludes the whole resource", () => {
      expect(
        codes(
          stayQuery({
            blocks: [{ unitId: null, from: "2026-10-22", to: "2026-10-25" }]
          })
        )
      ).toEqual(["BLOCKED"]);
    });

    test("a block is half-open too: checking in on the day a block ends is fine", () => {
      expect(
        evaluateStay(
          stayQuery({
            blocks: [{ unitId: null, from: "2026-10-15", to: "2026-10-20" }]
          })
        ).available
      ).toBe(true);
      expect(
        evaluateStay(
          stayQuery({
            blocks: [{ unitId: null, from: "2026-10-23", to: "2026-10-26" }]
          })
        ).available
      ).toBe(true);
    });

    test("another unit still sells; the stay needs only one free unit", () => {
      const evaluation = evaluateStay(
        stayQuery({
          units: [
            { unitId: "u1", occupied: [], stays: [] },
            { unitId: "u2", occupied: [], stays: [] }
          ],
          blocks: [{ unitId: "u1", from: "2026-10-20", to: "2026-10-30" }]
        })
      );

      expect(evaluation.available).toBe(true);
      expect(evaluation.freeUnits).toBe(1);
    });

    test("booked and blocked together report the allocation conflict, not the block", () => {
      expect(
        codes(
          stayQuery({
            units: [
              {
                unitId: "u1",
                occupied: [],
                stays: [{ from: "2026-10-19", to: "2026-10-30" }]
              }
            ],
            blocks: [{ unitId: "u1", from: "2026-10-21", to: "2026-10-22" }]
          })
        )
      ).toEqual(["NO_UNIT_AVAILABLE"]);
    });
  });

  describe("night limits of the offering", () => {
    test("below the minimum", () => {
      expect(codes(stayQuery({ minNights: 4 }))).toEqual([
        "MIN_STAY_VIOLATION"
      ]);
    });

    test("above the maximum", () => {
      expect(codes(stayQuery({ maxNights: 2 }))).toEqual(["MAX_STAY_EXCEEDED"]);
    });

    test("exactly the minimum and the maximum are fine", () => {
      expect(
        evaluateStay(stayQuery({ minNights: 3, maxNights: 3 })).available
      ).toBe(true);
    });

    test("a stay is at most 366 nights regardless of the offering", () => {
      expect(
        codes(
          stayQuery({
            checkInDate: "2026-10-20",
            checkOutDate: "2027-10-23",
            maxNights: 400
          })
        )
      ).toEqual(["STAY_DATES_INVALID"]);
      expect(
        evaluateStay(
          stayQuery({
            checkInDate: "2026-10-20",
            checkOutDate: "2027-10-21",
            maxNights: 400,
            maxHorizonDays: 3650
          })
        ).nights
      ).toBe(366);
    });
  });

  describe("STAY_DATES_INVALID", () => {
    test.each([
      ["out of order", "2026-10-23", "2026-10-20"],
      ["zero nights", "2026-10-20", "2026-10-20"],
      ["an instant", "2026-10-20T14:00:00Z", "2026-10-23"],
      ["malformed", "20-10-2026", "2026-10-23"],
      ["not a calendar date", "2026-02-30", "2026-03-02"],
      ["already past in the resource's zone", "2026-10-11", "2026-10-13"]
    ])("%s", (_name, checkIn, checkOut) => {
      const evaluation = evaluateStay(
        stayQuery({ checkInDate: checkIn, checkOutDate: checkOut })
      );

      expect(evaluation.available).toBe(false);
      expect(evaluation.reasons.map((reason) => reason.code)).toEqual([
        "STAY_DATES_INVALID"
      ]);
      expect(evaluation.reasons[0]!.overridable).toBe(false);
      expect(evaluation.nights).toBeNull();
    });

    test("a date that does not exist in the zone (Pacific/Apia skipped 30 Dec 2011)", () => {
      expect(
        codes(
          stayQuery({
            timezone: "Pacific/Apia",
            nowMs: t("2011-12-01T00:00:00Z"),
            checkInDate: "2011-12-29",
            checkOutDate: "2011-12-30"
          })
        )
      ).toEqual(["STAY_DATES_INVALID"]);
    });

    test("today is the resource's local date: arriving late on the check-in date is allowed", () => {
      // 2026-10-12T17:30Z is already 2026-10-13 00:30 in Pontianak.
      const lateNow = t("2026-10-12T17:30:00Z");

      expect(
        codes(
          stayQuery({
            nowMs: lateNow,
            checkInDate: "2026-10-12",
            checkOutDate: "2026-10-14"
          })
        )
      ).toEqual(["STAY_DATES_INVALID"]);
      expect(
        evaluateStay(
          stayQuery({
            nowMs: lateNow,
            checkInDate: "2026-10-13",
            checkOutDate: "2026-10-14"
          })
        ).reasons.map((reason) => reason.code)
      ).toEqual([]);
    });
  });

  describe("lead time and horizon apply to the derived arrival instant", () => {
    test("arrival earlier than now + lead is overridable", () => {
      // Arrival 2026-10-20T07:00Z; now 2026-10-19T07:00Z + lead 2 days
      const evaluation = evaluateStay(
        stayQuery({
          nowMs: t("2026-10-19T07:00:00Z"),
          minLeadSeconds: 2 * 86_400
        })
      );

      expect(evaluation.reasons).toEqual([
        { code: "LEAD_TIME_NOT_MET", overridable: true }
      ]);
    });

    test("arrival exactly at now + lead is allowed", () => {
      expect(
        evaluateStay(
          stayQuery({
            nowMs: t("2026-10-19T07:00:00Z"),
            minLeadSeconds: 86_400
          })
        ).available
      ).toBe(true);
    });

    test("arrival at or beyond the horizon is overridable", () => {
      const now = t("2026-10-20T07:00:00Z") - 30 * 86_400_000;

      expect(codes(stayQuery({ nowMs: now, maxHorizonDays: 30 }))).toEqual([
        "BEYOND_HORIZON"
      ]);
      expect(
        evaluateStay(stayQuery({ nowMs: now, maxHorizonDays: 31 })).available
      ).toBe(true);
    });
  });

  describe("a closed schedule exception is a SOFT closure", () => {
    test("a stay touching a closed night is OUTSIDE_SCHEDULE and overridable", () => {
      const evaluation = evaluateStay(
        stayQuery({ closedDates: ["2026-10-21"] })
      );

      expect(evaluation.available).toBe(false);
      expect(evaluation.reasons).toEqual([
        {
          code: "OUTSIDE_SCHEDULE",
          overridable: true,
          detail: "Closed on 2026-10-21."
        }
      ]);
    });

    test("the check-out date itself is not a night: a closure there does not touch the stay", () => {
      expect(
        evaluateStay(stayQuery({ closedDates: ["2026-10-23"] })).available
      ).toBe(true);
    });

    test("a soft closure and a hard conflict both show, and only the closure is overridable", () => {
      const evaluation = evaluateStay(
        stayQuery({
          closedDates: ["2026-10-21"],
          blocks: [{ unitId: null, from: "2026-10-20", to: "2026-10-23" }]
        })
      );

      expect(
        evaluation.reasons.map((reason) => [reason.code, reason.overridable])
      ).toEqual([
        ["OUTSIDE_SCHEDULE", true],
        ["BLOCKED", false]
      ]);
    });
  });

  describe("check-in and check-out times are configuration, not occupancy", () => {
    test("changing the times moves the instants and nothing else", () => {
      const base = evaluateStay(stayQuery());
      const moved = evaluateStay(
        stayQuery({ checkInSeconds: 20 * 3600, checkOutSeconds: 6 * 3600 })
      );

      expect(moved.arrivalMs).not.toBe(base.arrivalMs);
      expect(moved.nights).toBe(base.nights);
      expect(moved.available).toBe(base.available);
      expect(moved.freeUnits).toBe(base.freeUnits);
    });

    test("a check-out later than the next check-in on the same day is not a conflict", () => {
      const evaluation = evaluateStay(
        stayQuery({
          checkInSeconds: 8 * 3600,
          checkOutSeconds: 20 * 3600,
          checkInDate: "2026-10-23",
          checkOutDate: "2026-10-25",
          units: [
            {
              unitId: "u1",
              occupied: [],
              stays: [{ from: "2026-10-20", to: "2026-10-23" }]
            }
          ]
        })
      );

      expect(evaluation.available).toBe(true);
    });
  });

  describe("a stay across a daylight-saving change counts nights by date arithmetic", () => {
    test("America/New_York over the spring-forward night: 3 nights, though 71 hours elapse", () => {
      const evaluation = evaluateStay(
        stayQuery({
          timezone: "America/New_York",
          nowMs: t("2026-03-01T00:00:00Z"),
          checkInDate: "2026-03-07",
          checkOutDate: "2026-03-10",
          checkInSeconds: 15 * 3600,
          checkOutSeconds: 15 * 3600
        })
      );

      expect(evaluation.available).toBe(true);
      expect(evaluation.nights).toBe(3);
      expect(daysBetween("2026-03-07", "2026-03-10")).toBe(3);
      // 15:00 EST 7 March = 20:00Z; 15:00 EDT 10 March = 19:00Z: 71 hours, not 72.
      expect(evaluation.departureMs! - evaluation.arrivalMs!).toBe(71 * HOUR);
    });

    test("America/New_York over the fall-back night: 3 nights, though 73 hours elapse", () => {
      const evaluation = evaluateStay(
        stayQuery({
          timezone: "America/New_York",
          nowMs: t("2026-10-20T00:00:00Z"),
          checkInDate: "2026-10-31",
          checkOutDate: "2026-11-03",
          checkInSeconds: 15 * 3600,
          checkOutSeconds: 15 * 3600
        })
      );

      expect(evaluation.nights).toBe(3);
      expect(evaluation.departureMs! - evaluation.arrivalMs!).toBe(73 * HOUR);
    });

    test("the elapsed hours are never read: overlap is by date, so same-day turnover holds across the change", () => {
      const evaluation = evaluateStay(
        stayQuery({
          timezone: "America/New_York",
          nowMs: t("2026-03-01T00:00:00Z"),
          checkInDate: "2026-03-08",
          checkOutDate: "2026-03-10",
          units: [
            {
              unitId: "u1",
              occupied: [],
              stays: [{ from: "2026-03-06", to: "2026-03-08" }]
            }
          ]
        })
      );

      expect(evaluation.available).toBe(true);
      expect(evaluation.nights).toBe(2);
    });

    test("a configured check-in time inside the spring-forward gap takes the offset before the gap", () => {
      // 02:30 on 8 March does not exist; EST (-5) applies => 07:30Z.
      const evaluation = evaluateStay(
        stayQuery({
          timezone: "America/New_York",
          nowMs: t("2026-03-01T00:00:00Z"),
          checkInDate: "2026-03-08",
          checkOutDate: "2026-03-09",
          checkInSeconds: 2 * 3600 + 30 * 60
        })
      );

      expect(iso(evaluation.arrivalMs!)).toBe("2026-03-08T07:30:00.000Z");
    });

    test("a repeated check-in time (fall back) takes its first occurrence", () => {
      const evaluation = evaluateStay(
        stayQuery({
          timezone: "America/New_York",
          nowMs: t("2026-10-20T00:00:00Z"),
          checkInDate: "2026-11-01",
          checkOutDate: "2026-11-02",
          checkInSeconds: 3600 + 30 * 60
        })
      );

      expect(iso(evaluation.arrivalMs!)).toBe("2026-11-01T05:30:00.000Z");
    });
  });

  test("quantity needs that many free units", () => {
    const two = [
      { unitId: "u1", occupied: [], stays: [] },
      {
        unitId: "u2",
        occupied: [],
        stays: [{ from: "2026-10-20", to: "2026-10-21" }]
      }
    ];

    expect(evaluateStay(stayQuery({ units: two, quantity: 2 })).available).toBe(
      false
    );
    expect(evaluateStay(stayQuery({ units: two, quantity: 1 })).available).toBe(
      true
    );
  });

  test("the same input yields the same answer (no hidden clock)", () => {
    expect(evaluateStay(stayQuery())).toEqual(evaluateStay(stayQuery()));
  });
});
