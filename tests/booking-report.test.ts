/**
 * The pure rules of the `booking` reports (Issue #944, ADR-0131; booking.md
 * section 7.2): Asia/Jakarta day windows, clipping, the O8 definitions, small
 * group suppression and the projection descriptors. No database -- the SQL that
 * feeds these functions is proven in
 * `tests/integration/booking-reporting.integration.test.ts`.
 */
import { describe, expect, test } from "bun:test";

import {
  BOOKING_EVENTS_TABLE,
  BOOKING_REPORTING_PROJECTIONS,
  netOf
} from "../src/modules/booking/domain/booking-reporting";
import {
  availableSeconds,
  leadTimeBucket,
  MIN_GROUP_SIZE,
  OCCUPYING_STATUSES,
  overlapSeconds,
  parseReportQuery,
  ratio,
  reportDayWindows,
  reportRangeInstants,
  shapeLeadTime,
  shapeOccupancyDay,
  shapeOutcomes,
  shapePipeline,
  shapeUtilizationDay,
  suppressedRatio
} from "../src/modules/booking/domain/booking-report";
import { bookingModule } from "../src/modules/booking/module";
import { validateProjectionRegistry } from "../src/modules/reporting/domain/projection-registry";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const JAKARTA_OFFSET = 7 * HOUR;

describe("report day windows are Asia/Jakarta and DST-free", () => {
  test("a day is [00:00, next 00:00) at UTC+7", () => {
    const [day] = reportDayWindows("2026-03-29", "2026-03-30");

    expect(day).toEqual({
      date: "2026-03-29",
      startMs: Date.UTC(2026, 2, 29) - JAKARTA_OFFSET,
      endMs: Date.UTC(2026, 2, 30) - JAKARTA_OFFSET
    });
    expect(new Date(day!.startMs).toISOString()).toBe(
      "2026-03-28T17:00:00.000Z"
    );
  });

  test("every day of a year is exactly 24 hours, including the dates other zones shift on", () => {
    const windows = reportDayWindows("2026-01-01", "2027-01-01");

    expect(windows).toHaveLength(365);

    for (const window of windows) {
      expect(window.endMs - window.startMs).toBe(DAY);
    }

    // The windows tile the range with no gap and no overlap.
    for (let index = 1; index < windows.length; index += 1) {
      expect(windows[index]!.startMs).toBe(windows[index - 1]!.endMs);
    }
  });

  test("a reservation at 23:30 Jakarta belongs to that Jakarta day, not the UTC one", () => {
    const [day] = reportDayWindows("2026-06-10", "2026-06-11");
    // 2026-06-10 23:30 +07:00 is 16:30Z the same UTC date; 00:30 +07 on the 11th is 17:30Z the 10th.
    const lateNight = Date.parse("2026-06-10T23:30:00+07:00");
    const justAfterMidnight = Date.parse("2026-06-11T00:30:00+07:00");

    expect(lateNight >= day!.startMs && lateNight < day!.endMs).toBe(true);
    expect(
      justAfterMidnight >= day!.startMs && justAfterMidnight < day!.endMs
    ).toBe(false);
    expect(new Date(justAfterMidnight).toISOString()).toBe(
      "2026-06-10T17:30:00.000Z"
    );
  });

  test("the range instants span the first window start to the last window end", () => {
    const span = reportRangeInstants("2026-02-27", "2026-03-02");
    const windows = reportDayWindows("2026-02-27", "2026-03-02");

    expect(windows).toHaveLength(3);
    expect(span.startMs).toBe(windows[0]!.startMs);
    expect(span.endMs).toBe(windows[2]!.endMs);
  });
});

describe("clipping a booked interval to a day", () => {
  const [day] = reportDayWindows("2026-06-10", "2026-06-11");

  test("an interval inside the day counts whole", () => {
    expect(
      overlapSeconds(day!.startMs + 2 * HOUR, day!.startMs + 3 * HOUR, day!)
    ).toBe(3600);
  });

  test("an interval across midnight is split between the two days", () => {
    const [first, second] = reportDayWindows("2026-06-10", "2026-06-12");
    const startsAt = first!.endMs - HOUR;
    const endsAt = first!.endMs + 2 * HOUR;

    expect(overlapSeconds(startsAt, endsAt, first!)).toBe(3600);
    expect(overlapSeconds(startsAt, endsAt, second!)).toBe(7200);
  });

  test("a disjoint interval counts nothing", () => {
    expect(overlapSeconds(day!.endMs, day!.endMs + HOUR, day!)).toBe(0);
    expect(overlapSeconds(day!.startMs - HOUR, day!.startMs, day!)).toBe(0);
  });

  test("available seconds are the open windows clipped to the day, times the units", () => {
    const open = [
      // 08:00-12:00 and 13:00-17:00 Jakarta, plus a window that spills over the day edge
      {
        startMs: day!.startMs + 8 * HOUR,
        endMs: day!.startMs + 12 * HOUR
      },
      {
        startMs: day!.startMs + 13 * HOUR,
        endMs: day!.startMs + 17 * HOUR
      },
      { startMs: day!.endMs - HOUR, endMs: day!.endMs + 5 * HOUR }
    ];

    expect(availableSeconds(open, day!, 1)).toBe((4 + 4 + 1) * 3600);
    expect(availableSeconds(open, day!, 3)).toBe(3 * (4 + 4 + 1) * 3600);
    expect(availableSeconds(open, day!, 0)).toBe(0);
  });
});

describe("occupancy excludes holds (O8)", () => {
  test("the statuses that occupy a night never include held", () => {
    expect([...OCCUPYING_STATUSES]).toEqual([
      "confirmed",
      "checked_in",
      "completed"
    ]);
    expect(OCCUPYING_STATUSES as readonly string[]).not.toContain("held");
    expect(OCCUPYING_STATUSES as readonly string[]).not.toContain("no_show");
  });

  test("held unit-nights are reported beside occupancy and never in its rate", () => {
    const day = shapeOccupancyDay({
      date: "2026-06-10",
      units: 4,
      occupiedUnitNights: 2,
      heldUnitNights: 2,
      blockedUnitNights: 1
    });

    expect(day.occupancyRate).toBe(0.5);
    expect(day.heldUnitNights).toBe(2);
  });

  test("a resource with no units has no rate rather than a division by zero", () => {
    expect(
      shapeOccupancyDay({
        date: "2026-06-10",
        units: 0,
        occupiedUnitNights: 0,
        heldUnitNights: 0,
        blockedUnitNights: 0
      }).occupancyRate
    ).toBeNull();
  });

  test("utilization is its own figure: booked seconds over available seconds", () => {
    const day = shapeUtilizationDay("2026-06-10", 6 * 3600, 12 * 3600);

    expect(day.utilization).toBe(0.5);
    expect(shapeUtilizationDay("2026-06-10", 0, 0).utilization).toBeNull();
    expect("occupancyRate" in day).toBe(false);
  });

  test("the hold pipeline carries conversion and the open holds, not an occupancy", () => {
    const pipeline = shapePipeline(
      { placed: 10, converted: 6, expired: 3, cancelledHeld: 1 },
      { holds: 2, units: 3 }
    );

    expect(pipeline.conversionRate).toEqual({ suppressed: false, value: 0.6 });
    expect(pipeline.openHoldsNow).toBe(2);
    expect(pipeline.heldUnitsNow).toBe(3);
  });
});

describe("small-group suppression", () => {
  test("the minimum group is 5", () => {
    expect(MIN_GROUP_SIZE).toBe(5);
  });

  test("a ratio over fewer than 5 is withheld, 5 is shown", () => {
    expect(suppressedRatio(1, 4)).toEqual({ suppressed: true, value: null });
    expect(suppressedRatio(1, 5)).toEqual({ suppressed: false, value: 0.2 });
  });

  test("cancellation and no-show rates are withheld for a small cohort, but counts remain", () => {
    const report = shapeOutcomes({
      confirmed: 4,
      cancelled: 1,
      lateCancelled: 1,
      noShow: 1,
      arrived: 2
    });

    expect(report.cancellationRate.suppressed).toBe(true);
    expect(report.lateCancellationRate.suppressed).toBe(true);
    // 3 resolved arrivals: still under 5.
    expect(report.noShowRate.suppressed).toBe(true);
    expect(report.confirmed).toBe(4);
    expect(report.cancelled).toBe(1);
  });

  test("the no-show denominator is resolved arrivals, not the whole cohort", () => {
    const report = shapeOutcomes({
      confirmed: 20,
      cancelled: 4,
      lateCancelled: 2,
      noShow: 2,
      arrived: 8
    });

    expect(report.cancellationRate).toEqual({ suppressed: false, value: 0.2 });
    expect(report.lateCancellationRate).toEqual({
      suppressed: false,
      value: 0.1
    });
    // 2 of the 10 whose arrival day came; the 6 still ahead are not in it.
    expect(report.noShowRate).toEqual({ suppressed: false, value: 0.2 });
  });

  test("lead-time bucket counts are shown; only the mean is withheld under 5", () => {
    const leads = [
      ...Array.from({ length: 6 }, () => 2 * 86_400), // 1-3 days
      ...Array.from({ length: 2 }, () => 10 * 86_400) // 8-30 days
    ];
    const report = shapeLeadTime(leads);
    const bucket = (key: string) =>
      report.buckets.find((candidate) => candidate.key === key)!.reservations;

    expect(report.reservations).toBe(8);
    expect(bucket("1_3_days")).toBe(6);
    expect(bucket("8_30_days")).toBe(2);
    expect(report.meanDays).toEqual({ suppressed: false, value: 4 });
  });

  test("a mean over fewer than 5 reservations is withheld", () => {
    expect(shapeLeadTime([86_400, 2 * 86_400]).meanDays).toEqual({
      suppressed: true,
      value: null
    });
  });
});

describe("lead time buckets", () => {
  test("boundaries are whole days and a negative lead is same-day", () => {
    expect(leadTimeBucket(-3600)).toBe("same_day");
    expect(leadTimeBucket(86_399)).toBe("same_day");
    expect(leadTimeBucket(86_400)).toBe("1_3_days");
    expect(leadTimeBucket(4 * 86_400 - 1)).toBe("1_3_days");
    expect(leadTimeBucket(4 * 86_400)).toBe("4_7_days");
    expect(leadTimeBucket(8 * 86_400)).toBe("8_30_days");
    expect(leadTimeBucket(31 * 86_400)).toBe("31_plus_days");
  });
});

describe("ratio", () => {
  test("rounds to 4 decimals and refuses a zero whole", () => {
    expect(ratio(1, 3)).toBe(0.3333);
    expect(ratio(0, 5)).toBe(0);
    expect(ratio(1, 0)).toBeNull();
  });
});

describe("report query", () => {
  const parse = (query: string) => parseReportQuery(new URLSearchParams(query));

  test("accepts a window and an optional resource", () => {
    const parsed = parse(
      "from=2026-06-01&to=2026-06-08&resourceId=3f3c9d52-6e2f-4c0f-9c1b-0d8b6f6f5a11"
    );

    expect(parsed.valid).toBe(true);
  });

  test("refuses an empty, reversed or over-long window, bad dates and unknown keys", () => {
    expect(parse("from=2026-06-01&to=2026-06-01").valid).toBe(false);
    expect(parse("from=2026-06-08&to=2026-06-01").valid).toBe(false);
    expect(parse("from=2026-01-01&to=2026-06-01").valid).toBe(false);
    expect(parse("from=2026-06-01").valid).toBe(false);
    expect(parse("from=2026-02-30&to=2026-03-05").valid).toBe(false);
    expect(parse("from=2026-06-01&to=2026-06-08&resourceId=x").valid).toBe(
      false
    );
    expect(parse("from=2026-06-01&to=2026-06-08&tenantId=x").valid).toBe(false);
  });

  test("92 days is allowed, 93 is not", () => {
    expect(parse("from=2026-01-01&to=2026-04-03").valid).toBe(true);
    expect(parse("from=2026-01-01&to=2026-04-04").valid).toBe(false);
  });
});

describe("the booking projection descriptors", () => {
  test("pass the reporting registry gate, including the payroll boundary", () => {
    const result = validateProjectionRegistry([bookingModule]);

    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
    expect(
      result.descriptors.map((descriptor) => descriptor.key).sort()
    ).toEqual(["booking.nights", "booking.reservations", "booking.time"]);
  });

  test("all three read the append-only event table, steady state and rebuild alike", () => {
    for (const descriptor of BOOKING_REPORTING_PROJECTIONS) {
      expect(descriptor.source.strategy).toBe("cursor_table");

      const sourceStreams =
        descriptor.source.strategy === "cursor_table"
          ? descriptor.source.streams
          : [];

      for (const stream of [
        ...sourceStreams,
        ...descriptor.rebuildSource.streams
      ]) {
        expect(stream.tableName).toBe(BOOKING_EVENTS_TABLE);
        expect(stream.cursorColumn).toBe("created_at");
      }

      expect(descriptor.requiredPermission).toBe("booking.reports.read");
    }
  });

  test("no projection selects a person, a note, a reason or an amount", () => {
    const forbidden =
      /customer|note|reason|actor|email|phone|name|price|amount|revenue|payment|deposit/i;

    for (const descriptor of BOOKING_REPORTING_PROJECTIONS) {
      for (const stream of descriptor.rebuildSource.streams) {
        for (const rule of stream.metrics) {
          expect(rule.metricKey).not.toMatch(forbidden);
          expect(rule.matchColumn ?? "").not.toMatch(forbidden);
          expect(rule.sumColumn ?? "").not.toMatch(forbidden);
        }
      }

      for (const key of Object.keys(descriptor.metricLabels)) {
        expect(key).not.toMatch(forbidden);
      }
    }
  });

  test("every metric is a counter that only increases, and late_cancelled is a subset of cancelled", () => {
    for (const descriptor of BOOKING_REPORTING_PROJECTIONS) {
      for (const stream of descriptor.rebuildSource.streams) {
        for (const rule of stream.metrics) {
          expect(rule.effect).toBe("increment");
        }
      }
    }

    const reservations = BOOKING_REPORTING_PROJECTIONS.find(
      (descriptor) => descriptor.key === "booking.reservations"
    )!;
    const rules = reservations.rebuildSource.streams[0]!.metrics;

    expect(rules.map((rule) => rule.metricKey).sort()).toEqual(
      [
        "cancelled",
        "checked_in",
        "completed",
        "confirmed",
        "created",
        "expired",
        "held",
        "late_cancelled",
        "no_show",
        "rescheduled"
      ].sort()
    );
    // `cancelled` matches every cancellation (the plain kind); `late_cancelled`
    // reads the generated column, so it can never exceed it.
    expect(rules.find((rule) => rule.metricKey === "cancelled")).toMatchObject({
      matchColumn: "kind",
      matchValue: "cancelled"
    });
    expect(
      rules.find((rule) => rule.metricKey === "late_cancelled")
    ).toMatchObject({
      matchColumn: "projection_kind",
      matchValue: "late_cancelled"
    });
  });

  test("the quantity projections sum a column instead of counting rows", () => {
    const time = BOOKING_REPORTING_PROJECTIONS.find(
      (descriptor) => descriptor.key === "booking.time"
    )!;
    const nights = BOOKING_REPORTING_PROJECTIONS.find(
      (descriptor) => descriptor.key === "booking.nights"
    )!;

    expect(
      time.rebuildSource.streams[0]!.metrics.map((rule) => rule.sumColumn)
    ).toEqual(["booked_seconds", "released_seconds"]);
    expect(
      nights.rebuildSource.streams[0]!.metrics.map((rule) => rule.sumColumn)
    ).toEqual(["booked_nights", "released_nights"]);
  });

  test("net is booked minus released and never negative", () => {
    expect(netOf(10, 4)).toBe(6);
    expect(netOf(3, 5)).toBe(0);
  });
});
