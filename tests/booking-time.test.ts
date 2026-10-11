/**
 * `booking` time semantics (Issue #938, booking.md section 2.1, 2.2 and 2.5).
 * Table tests over the PURE functions of `domain/booking-time.ts`: every fixture
 * names its zone, so the result never depends on the host's timezone.
 */
import { describe, expect, test } from "bun:test";

import {
  addDays,
  daysBetween,
  datesInRange,
  isValidTimezone,
  localDateExists,
  localDateOf,
  offsetAt,
  parseLocalDate,
  parseLocalTime,
  resolveLocalInstant,
  weekdayOf
} from "../src/modules/booking/domain/booking-time";

const iso = (ms: number): string => new Date(ms).toISOString();
const secs = (hh: number, mm = 0): number => hh * 3600 + mm * 60;

describe("zone names (booking.md section 2.2)", () => {
  test.each([
    ["Asia/Pontianak", true],
    ["America/New_York", true],
    ["America/Argentina/Buenos_Aires", true],
    ["UTC", true],
    ["+07:00", false],
    ["UTC+7", false],
    ["WIB", false],
    ["EST", false],
    ["", false],
    ["local", false],
    ["Mars/Olympus_Mons", false],
    [null, false],
    [7, false]
  ])("%p is valid = %p", (zone, expected) => {
    expect(isValidTimezone(zone)).toBe(expected);
  });
});

describe("calendar dates", () => {
  test.each([
    ["2026-02-28", true],
    ["2028-02-29", true],
    ["2026-02-29", false],
    ["2026-02-30", false],
    ["2026-13-01", false],
    ["2026-1-1", false],
    ["2026-03-08T00:00:00Z", false],
    ["", false]
  ])("%p parses = %p", (value, expected) => {
    expect(parseLocalDate(value) !== null).toBe(expected);
  });

  test("local times accept HH:MM, HH:MM:SS and the 24:00 end-of-day sentinel", () => {
    expect(parseLocalTime("09:00")).toBe(secs(9));
    expect(parseLocalTime("14:00:00")).toBe(secs(14));
    expect(parseLocalTime("24:00")).toBe(86_400);
    expect(parseLocalTime("24:01")).toBeNull();
    expect(parseLocalTime("9:00")).toBeNull();
    expect(parseLocalTime("25:00")).toBeNull();
  });

  test("date arithmetic is calendar arithmetic", () => {
    expect(daysBetween("2026-03-07", "2026-03-10")).toBe(3);
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(datesInRange("2026-03-30", "2026-04-02")).toEqual([
      "2026-03-30",
      "2026-03-31",
      "2026-04-01"
    ]);
    expect(datesInRange("2026-03-30", "2026-03-30")).toEqual([]);
    expect(weekdayOf("2026-10-12")).toBe("mon");
  });
});

describe("offsets", () => {
  test("a zone without daylight saving never changes offset (Asia/Pontianak, UTC+7)", () => {
    expect(offsetAt("Asia/Pontianak", Date.UTC(2026, 0, 1))).toBe(
      7 * 3_600_000
    );
    expect(offsetAt("Asia/Pontianak", Date.UTC(2026, 6, 1))).toBe(
      7 * 3_600_000
    );
  });

  test("New York is UTC-5 in winter and UTC-4 in summer", () => {
    expect(offsetAt("America/New_York", Date.UTC(2026, 0, 15))).toBe(
      -5 * 3_600_000
    );
    expect(offsetAt("America/New_York", Date.UTC(2026, 6, 15))).toBe(
      -4 * 3_600_000
    );
  });
});

describe("wall-clock to instant: RFC 5545 gap and fold (booking.md section 2.2)", () => {
  // America/New_York 2026: spring forward Sun 8 March 02:00 -> 03:00 (EST -5 -> EDT -4),
  // fall back Sun 1 November 02:00 -> 01:00 (EDT -4 -> EST -5).
  test.each([
    // A normal wall time resolves exactly.
    [
      "Asia/Pontianak",
      "2026-03-08",
      secs(2, 30),
      "2026-03-07T19:30:00.000Z",
      "exact"
    ],
    [
      "America/New_York",
      "2026-03-07",
      secs(2, 30),
      "2026-03-07T07:30:00.000Z",
      "exact"
    ],
    [
      "America/New_York",
      "2026-03-09",
      secs(2, 30),
      "2026-03-09T06:30:00.000Z",
      "exact"
    ],
    // GAP: 02:30 does not exist on 8 March. Offset BEFORE the gap (EST, -5) applies:
    // 02:30 EST = 07:30Z, which reads 03:30 EDT after the jump.
    [
      "America/New_York",
      "2026-03-08",
      secs(2, 30),
      "2026-03-08T07:30:00.000Z",
      "gap"
    ],
    // The first nonexistent minute and the last one.
    [
      "America/New_York",
      "2026-03-08",
      secs(2, 0),
      "2026-03-08T07:00:00.000Z",
      "gap"
    ],
    [
      "America/New_York",
      "2026-03-08",
      secs(2, 59),
      "2026-03-08T07:59:00.000Z",
      "gap"
    ],
    // 03:00 is the first real time after the gap (EDT): 07:00Z, exact.
    [
      "America/New_York",
      "2026-03-08",
      secs(3, 0),
      "2026-03-08T07:00:00.000Z",
      "exact"
    ],
    // 01:59 is the last real time before it (EST).
    [
      "America/New_York",
      "2026-03-08",
      secs(1, 59),
      "2026-03-08T06:59:00.000Z",
      "exact"
    ],
    // FOLD: 01:30 happens twice on 1 November. FIRST occurrence (EDT, -4) = 05:30Z.
    [
      "America/New_York",
      "2026-11-01",
      secs(1, 30),
      "2026-11-01T05:30:00.000Z",
      "fold"
    ],
    [
      "America/New_York",
      "2026-11-01",
      secs(1, 0),
      "2026-11-01T05:00:00.000Z",
      "fold"
    ],
    [
      "America/New_York",
      "2026-11-01",
      secs(1, 59),
      "2026-11-01T05:59:00.000Z",
      "fold"
    ],
    // 02:00 is after the fold: EST only, 07:00Z.
    [
      "America/New_York",
      "2026-11-01",
      secs(2, 0),
      "2026-11-01T07:00:00.000Z",
      "exact"
    ],
    // 00:30 is before it: EDT, 04:30Z.
    [
      "America/New_York",
      "2026-11-01",
      secs(0, 30),
      "2026-11-01T04:30:00.000Z",
      "exact"
    ],
    // Europe/London 2026: spring forward Sun 29 March 01:00 -> 02:00; fall back Sun 25 Oct 02:00 -> 01:00.
    [
      "Europe/London",
      "2026-03-29",
      secs(1, 30),
      "2026-03-29T01:30:00.000Z",
      "gap"
    ],
    [
      "Europe/London",
      "2026-10-25",
      secs(1, 30),
      "2026-10-25T00:30:00.000Z",
      "fold"
    ],
    // A 30-minute shift: Australia/Lord_Howe falls back Sun 5 Apr 2026 02:00 -> 01:30.
    [
      "Australia/Lord_Howe",
      "2026-04-05",
      secs(1, 45),
      "2026-04-04T14:45:00.000Z",
      "fold"
    ],
    // Southern hemisphere spring forward: Australia/Sydney Sun 4 Oct 2026 02:00 -> 03:00 (+10 -> +11).
    [
      "Australia/Sydney",
      "2026-10-04",
      secs(2, 30),
      "2026-10-03T16:30:00.000Z",
      "gap"
    ],
    // End of day (24:00) is midnight of the next date.
    [
      "Asia/Pontianak",
      "2026-03-08",
      86_400,
      "2026-03-08T17:00:00.000Z",
      "exact"
    ]
  ])("%s %s +%ds -> %s (%s)", (zone, date, seconds, expectedIso, kind) => {
    const resolved = resolveLocalInstant(zone, date, seconds);

    expect(iso(resolved.instantMs)).toBe(expectedIso);
    expect(resolved.kind).toBe(kind as "exact" | "gap" | "fold");
  });

  test("a window across the spring-forward gap is 1 real hour shorter than its wall clock says", () => {
    const start = resolveLocalInstant(
      "America/New_York",
      "2026-03-08",
      secs(1)
    ).instantMs;
    const end = resolveLocalInstant(
      "America/New_York",
      "2026-03-08",
      secs(4)
    ).instantMs;

    // 01:00 EST -> 04:00 EDT is two real hours, not three.
    expect(end - start).toBe(2 * 3_600_000);
  });

  test("a window across the fall-back fold is 1 real hour longer than its wall clock says", () => {
    const start = resolveLocalInstant(
      "America/New_York",
      "2026-11-01",
      secs(0)
    ).instantMs;
    const end = resolveLocalInstant(
      "America/New_York",
      "2026-11-01",
      secs(3)
    ).instantMs;

    // 00:00 EDT -> 03:00 EST is four real hours.
    expect(end - start).toBe(4 * 3_600_000);
  });
});

describe("local date of an instant", () => {
  test("Asia/Pontianak is seven hours ahead of UTC", () => {
    expect(localDateOf("Asia/Pontianak", Date.UTC(2026, 9, 12, 16, 59))).toBe(
      "2026-10-12"
    );
    expect(localDateOf("Asia/Pontianak", Date.UTC(2026, 9, 12, 17, 0))).toBe(
      "2026-10-13"
    );
  });

  test("the local date follows the zone, not the host", () => {
    const instant = Date.UTC(2026, 2, 8, 5, 30); // 00:30 EST on 8 March in New York

    expect(localDateOf("America/New_York", instant)).toBe("2026-03-08");
    expect(localDateOf("Pacific/Auckland", instant)).toBe("2026-03-08");
    expect(localDateOf("Pacific/Kiritimati", instant)).toBe("2026-03-08");
    expect(localDateOf("Pacific/Pago_Pago", instant)).toBe("2026-03-07");
  });
});

describe("a calendar date that does not exist in the zone (booking.md section 2.5, edge case 5)", () => {
  test("Pacific/Apia skipped 30 December 2011 entirely", () => {
    expect(localDateExists("Pacific/Apia", "2011-12-29")).toBe(true);
    expect(localDateExists("Pacific/Apia", "2011-12-30")).toBe(false);
    expect(localDateExists("Pacific/Apia", "2011-12-31")).toBe(true);
  });

  test("an ordinary date exists, including a day with a gap or a fold", () => {
    expect(localDateExists("America/New_York", "2026-03-08")).toBe(true);
    expect(localDateExists("America/New_York", "2026-11-01")).toBe(true);
    expect(localDateExists("Asia/Pontianak", "2026-10-12")).toBe(true);
  });
});
