/**
 * `booking` stays and blocked nights, PURE rules (Issue #940, ADR-0135;
 * docs/awcms/booking.md section 2.5, 3.1 and 8.3 T12).
 *
 * Every fixture names its zone, so nothing depends on the host's timezone. The
 * database half (T9 to T13: the constraint, the races, the DST snapshot stored
 * through a real claim) is `tests/integration/booking-stay.integration.test.ts`.
 */
import { describe, expect, test } from "bun:test";

import {
  evaluateStay,
  type StayQuery
} from "../src/modules/booking/domain/booking-availability";
import { validatePlaceHold } from "../src/modules/booking/domain/booking-allocation";
import {
  BLOCK_REASON_CODES,
  BLOCK_REFUSALS,
  STAY_REFUSALS,
  agreedStayTerms,
  checkNightLimits,
  deriveStay,
  validateCreateBlock,
  type StayDatesInput
} from "../src/modules/booking/domain/booking-stay";

const iso = (ms: number): string => new Date(ms).toISOString();
const t = (value: string): number => Date.parse(value);
const secs = (hh: number, mm = 0): number => hh * 3600 + mm * 60;

function stay(overrides: Partial<StayDatesInput> = {}): StayDatesInput {
  return {
    checkInDate: "2026-12-10",
    checkOutDate: "2026-12-12",
    timezone: "Asia/Pontianak",
    checkInSeconds: secs(14),
    checkOutSeconds: secs(12),
    nowMs: t("2026-12-01T00:00:00Z"),
    ...overrides
  };
}

describe("deriveStay: nights are dates, instants are derived (ADR-0135 section 2 and 3)", () => {
  test("a plain stay: the night count and the arrival / departure instants", () => {
    const derived = deriveStay(stay());

    expect(derived).toMatchObject({ ok: true, nights: 2 });
    // 14:00 and 12:00 in Asia/Pontianak (UTC+7, no daylight saving).
    expect(derived.ok && iso(derived.startsAtMs)).toBe(
      "2026-12-10T07:00:00.000Z"
    );
    expect(derived.ok && iso(derived.endsAtMs)).toBe(
      "2026-12-12T05:00:00.000Z"
    );
  });

  test("arriving on the check-in date late in the day is allowed; the day before today is not", () => {
    const evening = deriveStay(
      stay({ nowMs: t("2026-12-10T15:00:00Z") }) // 22:00 local on the 10th
    );
    const yesterday = deriveStay(stay({ nowMs: t("2026-12-11T00:00:00Z") }));

    expect(evening.ok).toBe(true);
    expect(yesterday).toMatchObject({
      ok: false,
      code: "STAY_DATES_INVALID"
    });
  });

  // T12: a night is a night however long the calendar day is.
  describe("daylight saving (Europe/Berlin)", () => {
    const berlin = {
      timezone: "Europe/Berlin",
      nowMs: t("2027-01-01T00:00:00Z")
    };

    test("a stay across the spring-forward date (a 23-hour day) counts its nights as dates", () => {
      // 2027-03-28 is the 23-hour day.
      const derived = deriveStay(
        stay({
          ...berlin,
          checkInDate: "2027-03-27",
          checkOutDate: "2027-03-29"
        })
      );

      expect(derived).toMatchObject({ ok: true, nights: 2 });
      // 14:00 CET (+1) = 13:00Z; 12:00 CEST (+2) = 10:00Z. The span is 45 h, not
      // 48: nothing reads that difference.
      expect(derived.ok && iso(derived.startsAtMs)).toBe(
        "2027-03-27T13:00:00.000Z"
      );
      expect(derived.ok && iso(derived.endsAtMs)).toBe(
        "2027-03-29T10:00:00.000Z"
      );
      expect(derived.ok && derived.endsAtMs - derived.startsAtMs).not.toBe(
        2 * 24 * 3_600_000
      );
    });

    test("a stay across the fall-back date (a 25-hour day) counts its nights as dates", () => {
      // 2026-10-25 is the 25-hour day.
      const derived = deriveStay(
        stay({
          ...berlin,
          checkInDate: "2026-10-24",
          checkOutDate: "2026-10-26",
          nowMs: t("2026-10-01T00:00:00Z")
        })
      );

      expect(derived).toMatchObject({ ok: true, nights: 2 });
      // 14:00 CEST (+2) = 12:00Z; 12:00 CET (+1) = 11:00Z: 47 h.
      expect(derived.ok && iso(derived.startsAtMs)).toBe(
        "2026-10-24T12:00:00.000Z"
      );
      expect(derived.ok && iso(derived.endsAtMs)).toBe(
        "2026-10-26T11:00:00.000Z"
      );
    });

    test("one night on the transition date is one night in both directions", () => {
      expect(
        deriveStay(
          stay({
            ...berlin,
            checkInDate: "2027-03-28",
            checkOutDate: "2027-03-29"
          })
        )
      ).toMatchObject({ ok: true, nights: 1 });
      expect(
        deriveStay(
          stay({
            ...berlin,
            checkInDate: "2026-10-25",
            checkOutDate: "2026-10-26",
            nowMs: t("2026-10-01T00:00:00Z")
          })
        )
      ).toMatchObject({ ok: true, nights: 1 });
    });

    test("a check-in time inside the spring-forward gap takes the offset BEFORE the gap (RFC 5545)", () => {
      // 02:30 on 2027-03-28 does not exist in Berlin (02:00 jumps to 03:00).
      const derived = deriveStay(
        stay({
          ...berlin,
          checkInDate: "2027-03-28",
          checkOutDate: "2027-03-29",
          checkInSeconds: secs(2, 30)
        })
      );

      expect(derived).toMatchObject({ ok: true, checkIn: "gap" });
      // 02:30 read at +01:00 is 01:30Z, which is 03:30 CEST.
      expect(derived.ok && iso(derived.startsAtMs)).toBe(
        "2027-03-28T01:30:00.000Z"
      );
    });

    test("a check-in time inside the fall-back fold takes its FIRST occurrence", () => {
      // 02:30 on 2026-10-25 happens twice in Berlin.
      const derived = deriveStay(
        stay({
          ...berlin,
          checkInDate: "2026-10-25",
          checkOutDate: "2026-10-26",
          checkInSeconds: secs(2, 30),
          nowMs: t("2026-10-01T00:00:00Z")
        })
      );

      expect(derived).toMatchObject({ ok: true, checkIn: "fold" });
      // The first 02:30 is CEST (+2): 00:30Z.
      expect(derived.ok && iso(derived.startsAtMs)).toBe(
        "2026-10-25T00:30:00.000Z"
      );
    });
  });

  test("a zone without daylight saving never yields a gap or a fold", () => {
    expect(deriveStay(stay())).toMatchObject({
      ok: true,
      checkIn: "exact",
      checkOut: "exact"
    });
  });

  describe("STAY_DATES_INVALID", () => {
    test.each([
      ["out of order", "2026-12-12", "2026-12-10"],
      ["zero nights", "2026-12-10", "2026-12-10"],
      ["an instant, not a date", "2026-12-10T14:00:00Z", "2026-12-12"],
      ["malformed", "10-12-2026", "2026-12-12"],
      ["not a calendar date", "2026-02-30", "2026-03-02"],
      ["367 nights", "2026-12-10", "2027-12-12"]
    ])("%s", (_name, checkIn, checkOut) => {
      expect(
        deriveStay(stay({ checkInDate: checkIn, checkOutDate: checkOut }))
      ).toMatchObject({ ok: false, code: "STAY_DATES_INVALID" });
    });

    test("366 nights is the longest stay", () => {
      expect(
        deriveStay(
          stay({ checkInDate: "2026-12-10", checkOutDate: "2027-12-11" })
        )
      ).toMatchObject({ ok: true, nights: 366 });
    });

    test("a date the zone skipped (Pacific/Apia, 30 December 2011) does not exist", () => {
      expect(
        deriveStay(
          stay({
            timezone: "Pacific/Apia",
            nowMs: t("2011-12-01T00:00:00Z"),
            checkInDate: "2011-12-29",
            checkOutDate: "2011-12-30"
          })
        )
      ).toMatchObject({ ok: false, code: "STAY_DATES_INVALID" });
    });
  });

  // The claim must accept exactly what availability offers: one table, both
  // functions, the same verdict on the dates.
  test("agrees with evaluateStay on which dates are invalid", () => {
    const base: StayQuery = {
      checkInDate: "2026-12-10",
      checkOutDate: "2026-12-12",
      timezone: "Asia/Pontianak",
      checkInSeconds: secs(14),
      checkOutSeconds: secs(12),
      nowMs: t("2026-12-01T00:00:00Z"),
      minLeadSeconds: 0,
      maxHorizonDays: 3650,
      minNights: 1,
      maxNights: 366,
      quantity: 1,
      units: [{ unitId: "u1", occupied: [], stays: [] }],
      blocks: [],
      closedDates: []
    };
    const cases: Array<
      Pick<StayQuery, "checkInDate" | "checkOutDate"> & Partial<StayQuery>
    > = [
      { checkInDate: "2026-12-10", checkOutDate: "2026-12-12" },
      { checkInDate: "2026-12-12", checkOutDate: "2026-12-10" },
      { checkInDate: "2026-12-10", checkOutDate: "2026-12-10" },
      { checkInDate: "2026-12-10T14:00:00Z", checkOutDate: "2026-12-12" },
      { checkInDate: "2026-02-30", checkOutDate: "2026-03-02" },
      { checkInDate: "2026-11-30", checkOutDate: "2026-12-02" },
      { checkInDate: "2026-12-10", checkOutDate: "2027-12-12" },
      { checkInDate: "2026-12-10", checkOutDate: "2027-12-11" },
      {
        checkInDate: "2011-12-29",
        checkOutDate: "2011-12-30",
        timezone: "Pacific/Apia",
        nowMs: t("2011-12-01T00:00:00Z")
      },
      {
        checkInDate: "2027-03-27",
        checkOutDate: "2027-03-29",
        timezone: "Europe/Berlin",
        nowMs: t("2027-01-01T00:00:00Z")
      }
    ];

    for (const overrides of cases) {
      const query = { ...base, ...overrides };
      const evaluation = evaluateStay(query);
      const derived = deriveStay(query);
      const evaluatorSaysInvalid = evaluation.reasons.some(
        (reason) => reason.code === "STAY_DATES_INVALID"
      );

      expect(!derived.ok).toBe(evaluatorSaysInvalid);

      if (derived.ok) {
        expect(derived.nights).toBe(evaluation.nights!);
        expect(derived.startsAtMs).toBe(evaluation.arrivalMs!);
        expect(derived.endsAtMs).toBe(evaluation.departureMs!);
      }
    }
  });
});

describe("night limits of the offering", () => {
  const limits = { minNights: 2, maxNights: 5 };

  test("inside the limits, on both edges", () => {
    expect(checkNightLimits(2, limits)).toBeNull();
    expect(checkNightLimits(5, limits)).toBeNull();
  });

  test("too short and too long are different refusals", () => {
    expect(checkNightLimits(1, limits)?.code).toBe("MIN_STAY_VIOLATION");
    expect(checkNightLimits(6, limits)?.code).toBe("MAX_STAY_EXCEEDED");
  });
});

describe("refusal statuses", () => {
  test("a malformed or impossible date is a 400; the offering's limits and a block are 409s", () => {
    expect(STAY_REFUSALS.STAY_DATES_INVALID).toBe(400);
    expect(STAY_REFUSALS.MIN_STAY_VIOLATION).toBe(409);
    expect(STAY_REFUSALS.MAX_STAY_EXCEEDED).toBe(409);
    expect(BLOCK_REFUSALS.BLOCK_CONFLICT).toBe(409);
    expect(BLOCK_REFUSALS.RESOURCE_NOT_FOUND).toBe(404);
  });
});

describe("a pool's stay terms", () => {
  const terms = {
    timezone: "Asia/Pontianak",
    checkInTime: "14:00:00",
    checkOutTime: "12:00:00"
  };

  test("resources that agree snapshot one set", () => {
    expect(agreedStayTerms([terms, { ...terms }])).toEqual(terms);
    expect(agreedStayTerms([terms])).toEqual(terms);
  });

  test("a different zone or different times is refused rather than snapshotting the first", () => {
    expect(
      agreedStayTerms([terms, { ...terms, timezone: "Asia/Jakarta" }])
    ).toBeNull();
    expect(
      agreedStayTerms([terms, { ...terms, checkInTime: "15:00:00" }])
    ).toBeNull();
    expect(
      agreedStayTerms([terms, { ...terms, checkOutTime: "11:00:00" }])
    ).toBeNull();
  });

  test("no resources agree on nothing", () => {
    expect(agreedStayTerms([])).toBeNull();
  });
});

describe("validatePlaceHold for a stay", () => {
  const base = {
    offeringId: "b9400000-0000-4000-8000-000000000001",
    resourceId: "b9400000-0000-4000-8000-000000000002",
    partySize: 2,
    quantity: 1
  };
  const fields = (input: Parameters<typeof validatePlaceHold>[0]) =>
    validatePlaceHold(input).map((issue) => issue.field);

  test("dates alone are a well-formed stay claim", () => {
    expect(
      validatePlaceHold({
        ...base,
        stay: { checkInDate: "2026-12-10", checkOutDate: "2026-12-12" }
      })
    ).toEqual([]);
  });

  test("a slot needs an instant; a stay needs none", () => {
    expect(fields({ ...base })).toEqual(["startsAt"]);
  });

  test("an instant AND dates is ambiguous and refused", () => {
    expect(
      fields({
        ...base,
        startsAtMs: t("2026-12-10T07:00:00Z"),
        stay: { checkInDate: "2026-12-10", checkOutDate: "2026-12-12" }
      })
    ).toEqual(["startsAt"]);
  });

  test("an instant-shaped or malformed date is STAY_DATES_INVALID, with the field named", () => {
    const issues = validatePlaceHold({
      ...base,
      stay: { checkInDate: "2026-12-10T14:00:00Z", checkOutDate: "12/12/2026" }
    });

    expect(issues.map((issue) => issue.field)).toEqual([
      "stay.checkInDate",
      "stay.checkOutDate"
    ]);
    expect(issues.every((issue) => issue.code === "STAY_DATES_INVALID")).toBe(
      true
    );
  });
});

describe("validateCreateBlock", () => {
  const ok = {
    resourceId: "b9400000-0000-4000-8000-000000000002",
    fromDate: "2026-12-10",
    toDate: "2026-12-12",
    reasonCode: "maintenance"
  };
  const fields = (input: Parameters<typeof validateCreateBlock>[0]) =>
    validateCreateBlock(input).map((issue) => issue.field);

  test("a well-formed block, for one unit or all", () => {
    expect(validateCreateBlock(ok)).toEqual([]);
    expect(
      validateCreateBlock({
        ...ok,
        unitId: "b9400000-0000-4000-8000-000000000003"
      })
    ).toEqual([]);
  });

  test("the reason is one of the closed codes, never free text", () => {
    for (const code of BLOCK_REASON_CODES) {
      expect(validateCreateBlock({ ...ok, reasonCode: code })).toEqual([]);
    }

    expect(fields({ ...ok, reasonCode: "guest asked for the room" })).toEqual([
      "reasonCode"
    ]);
  });

  test("the range is half-open, ordered, made of dates and at most 366 nights", () => {
    expect(fields({ ...ok, toDate: "2026-12-10" })).toEqual(["toDate"]);
    expect(fields({ ...ok, toDate: "2026-12-09" })).toEqual(["toDate"]);
    expect(fields({ ...ok, fromDate: "2026-12-10T00:00:00Z" })).toEqual([
      "fromDate"
    ]);
    expect(fields({ ...ok, toDate: "2027-12-12" })).toEqual(["toDate"]);
    expect(validateCreateBlock({ ...ok, toDate: "2027-12-11" })).toEqual([]);
  });

  test("ids must be UUIDs", () => {
    expect(fields({ ...ok, resourceId: "nope" })).toEqual(["resourceId"]);
    expect(fields({ ...ok, unitId: "nope" })).toEqual(["unitId"]);
  });
});
