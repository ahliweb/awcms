/**
 * Booking business policy and the reservation event payload (Issue #941,
 * ADR-0131; docs/awcms/booking.md sections 3, 7.4 and 13). Pure: no database.
 */
import { describe, expect, test } from "bun:test";

import {
  POLICY_DEFAULTS,
  evaluateSlotPolicy,
  isLateCancellation,
  noShowEarliestMs,
  stayPolicyReasons
} from "../src/modules/booking/domain/booking-policy";
import {
  BOOKING_EVENT_TYPES,
  buildReservationEventPayload,
  parseReservationFacts,
  type ReservationFacts
} from "../src/modules/booking/domain/booking-reservation-events";
import {
  RESERVATION_EVENT_KINDS,
  evaluateTransition
} from "../src/modules/booking/domain/booking-reservation-state";
import { bookingModule } from "../src/modules/booking/module";
import { DOMAIN_EVENT_TYPE_REGISTRY } from "../src/modules/domain-event-runtime/domain/event-type-registry";

const MIN = 60_000;
const HOUR = 3_600_000;
const NOW = Date.parse("2026-11-01T00:00:00Z");
const OPEN = [{ startMs: NOW + 8 * HOUR, endMs: NOW + 18 * HOUR }];

function slot(overrides: Partial<Parameters<typeof evaluateSlotPolicy>[0]>) {
  return evaluateSlotPolicy({
    startMs: NOW + 10 * HOUR,
    endMs: NOW + 11 * HOUR,
    nowMs: NOW,
    minLeadSeconds: 0,
    maxHorizonDays: 365,
    stepSeconds: 900,
    openWindows: OPEN,
    ...overrides
  });
}

describe("slot policy", () => {
  test("a start the search would have offered trips nothing", () => {
    expect(slot({})).toEqual([]);
  });

  test("outside every open window is OUTSIDE_SCHEDULE", () => {
    expect(
      slot({ startMs: NOW + 19 * HOUR, endMs: NOW + 20 * HOUR }).map(
        (reason) => reason.code
      )
    ).toEqual(["OUTSIDE_SCHEDULE"]);
    expect(slot({ openWindows: [] }).map((r) => r.code)).toEqual([
      "OUTSIDE_SCHEDULE"
    ]);
  });

  test("an interval that crosses the closing time is refused, though it starts inside", () => {
    expect(
      slot({ startMs: NOW + 17.5 * HOUR, endMs: NOW + 18.5 * HOUR }).map(
        (r) => r.code
      )
    ).toEqual(["OUTSIDE_SCHEDULE"]);
  });

  test("off the offering's step grid is OUTSIDE_SCHEDULE, measured from the window's own start", () => {
    expect(
      slot({
        startMs: NOW + 10 * HOUR + 7 * MIN,
        endMs: NOW + 11 * HOUR + 7 * MIN
      }).map((r) => r.code)
    ).toEqual(["OUTSIDE_SCHEDULE"]);
    expect(
      slot({
        startMs: NOW + 10 * HOUR + 15 * MIN,
        endMs: NOW + 11 * HOUR + 15 * MIN
      })
    ).toEqual([]);
  });

  test("lead time and horizon are judged against the database clock", () => {
    expect(
      slot({ minLeadSeconds: 12 * 3600 }).map((reason) => reason.code)
    ).toEqual(["LEAD_TIME_VIOLATION"]);
    expect(slot({ maxHorizonDays: 0 }).map((reason) => reason.code)).toEqual([
      "HORIZON_EXCEEDED"
    ]);
  });

  test("a start AT the horizon instant is already beyond it", () => {
    const days = 2;

    expect(
      slot({
        startMs: NOW + days * 86_400_000,
        endMs: NOW + days * 86_400_000 + HOUR,
        maxHorizonDays: days,
        openWindows: [
          {
            startMs: NOW + days * 86_400_000 - HOUR,
            endMs: NOW + days * 86_400_000 + 2 * HOUR
          }
        ]
      }).map((r) => r.code)
    ).toEqual(["HORIZON_EXCEEDED"]);
  });
});

describe("stay policy takes only the overridable reasons of the stay evaluation", () => {
  test("lead time, horizon and a soft closure map to the policy codes; a block or a conflict never does", () => {
    expect(
      stayPolicyReasons([
        { code: "LEAD_TIME_NOT_MET", overridable: true },
        { code: "BEYOND_HORIZON", overridable: true },
        { code: "OUTSIDE_SCHEDULE", overridable: true, detail: "Closed." },
        { code: "BLOCKED", overridable: false },
        { code: "NO_UNIT_AVAILABLE", overridable: false },
        { code: "MIN_STAY_VIOLATION", overridable: false },
        { code: "STAY_DATES_INVALID", overridable: false }
      ]).map((reason) => reason.code)
    ).toEqual(["LEAD_TIME_VIOLATION", "HORIZON_EXCEEDED", "OUTSIDE_SCHEDULE"]);
  });
});

describe("late cancellation and the no-show grace", () => {
  test("no cutoff means no cancellation is ever late", () => {
    expect(
      isLateCancellation({
        nowMs: NOW,
        startsAtMs: NOW + MIN,
        cutoffSeconds: null
      })
    ).toBe(false);
  });

  test("a cancellation inside the cutoff is late, at the boundary and after the start", () => {
    const base = { startsAtMs: NOW + 24 * HOUR, cutoffSeconds: 24 * 3600 };

    expect(isLateCancellation({ ...base, nowMs: NOW - 1 })).toBe(false);
    expect(isLateCancellation({ ...base, nowMs: NOW })).toBe(true);
    expect(isLateCancellation({ ...base, nowMs: NOW + 30 * HOUR })).toBe(true);
  });

  test("the earliest no-show is the start plus the grace, and the default grace is 15 minutes", () => {
    expect(POLICY_DEFAULTS.noShowGraceSeconds).toBe(900);
    expect(noShowEarliestMs(NOW, POLICY_DEFAULTS.noShowGraceSeconds)).toBe(
      NOW + 15 * MIN
    );
  });
});

describe("the default hold caps (booking.md section 13, left open by Issue #939)", () => {
  test("the module no longer defaults to unlimited", () => {
    expect(POLICY_DEFAULTS.maxActiveHoldsPerCustomer).toBe(5);
    expect(POLICY_DEFAULTS.maxActiveHoldsPerTenant).toBe(500);
    expect(POLICY_DEFAULTS.maxActiveHoldsPerCustomer).toBeLessThan(
      POLICY_DEFAULTS.maxActiveHoldsPerTenant
    );
  });
});

describe("confirming an elapsed hold", () => {
  test("the database's own answer wins over comparing milliseconds", () => {
    const base = {
      from: "held" as const,
      action: "confirm" as const,
      now: new Date(NOW),
      holdExpiresAt: new Date(NOW + 1)
    };

    // The JS comparison alone says "not elapsed"; the database says it is.
    expect(evaluateTransition(base).ok).toBe(true);
    expect(evaluateTransition({ ...base, holdElapsed: true })).toMatchObject({
      ok: false,
      code: "HOLD_EXPIRED"
    });
    // ... and the reverse: same millisecond, the database says not yet.
    expect(
      evaluateTransition({
        ...base,
        holdExpiresAt: new Date(NOW),
        holdElapsed: false
      }).ok
    ).toBe(true);
  });
});

const FACTS: ReservationFacts = {
  reservationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  reservationNo: "BK-0123456789AB",
  lineageId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  startsAt: "2026-11-01T03:00:00.000Z",
  endsAt: "2026-11-01T04:00:00.000Z",
  partySize: 2,
  externalRefType: "order",
  externalRef: "ORD-1",
  resourceIds: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
  offeringIds: ["cccccccc-cccc-4ccc-8ccc-cccccccccccc"],
  stays: []
};

describe("the reservation event payload", () => {
  test("it carries ids, enums, counts and UTC instants, and the closed key set", () => {
    const payload = buildReservationEventPayload({
      facts: FACTS,
      status: "confirmed",
      previousStatus: "held",
      occurredAt: "2026-11-01T00:00:00.000Z",
      correlationId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
    });

    expect(Object.keys(payload).sort()).toEqual(
      [
        "correlationId",
        "endsAt",
        "externalRef",
        "externalRefType",
        "lineageId",
        "occurredAt",
        "offeringIds",
        "partySize",
        "previousStatus",
        "reservationId",
        "reservationNo",
        "resourceIds",
        "startsAt",
        "status"
      ].sort()
    );
  });

  test("whatever the transition, no key names a person, a reason, an actor or an amount", () => {
    const payload = buildReservationEventPayload({
      facts: { ...FACTS, stays: [] },
      status: "cancelled",
      previousStatus: "confirmed",
      occurredAt: "2026-11-01T00:00:00.000Z",
      lateCancellation: true,
      supersededById: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      rescheduledFromId: "ffffffff-ffff-4fff-8fff-ffffffffffff"
    });
    const forbidden =
      /customer|note|reason|actor|name|email|phone|amount|price|paid|payment|deposit|balance|total|currency|fee|discount/i;

    for (const key of Object.keys(payload)) {
      // `externalRef*` is the adapter's own opaque pair, not a person.
      if (key.startsWith("externalRef")) {
        continue;
      }
      expect(forbidden.test(key)).toBe(false);
    }
  });

  test("stays are additive: present only when the reservation holds one", () => {
    const stay = {
      resourceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      checkInDate: "2026-11-10",
      checkOutDate: "2026-11-12",
      nights: 2,
      timezone: "Asia/Pontianak"
    };

    expect(
      "stays" in
        buildReservationEventPayload({
          facts: FACTS,
          status: "held",
          previousStatus: null,
          occurredAt: "2026-11-01T00:00:00.000Z"
        })
    ).toBe(false);
    expect(
      buildReservationEventPayload({
        facts: { ...FACTS, stays: [stay] },
        status: "held",
        previousStatus: null,
        occurredAt: "2026-11-01T00:00:00.000Z"
      }).stays
    ).toEqual([stay]);
  });

  test("the facts parser accepts the database's jsonb as an object or as text, and refuses nonsense", () => {
    expect(parseReservationFacts(FACTS)).toEqual(FACTS);
    expect(parseReservationFacts(JSON.stringify(FACTS))).toEqual(FACTS);
    expect(() => parseReservationFacts(null)).toThrow();
    expect(() => parseReservationFacts({ reservationId: 1 })).toThrow();
  });
});

describe("the nine events", () => {
  test("every history kind has exactly one event type, namespaced awcms.booking.reservation", () => {
    expect(Object.keys(BOOKING_EVENT_TYPES).sort()).toEqual(
      [...RESERVATION_EVENT_KINDS].sort()
    );
    for (const [kind, type] of Object.entries(BOOKING_EVENT_TYPES)) {
      expect(type).toBe(`awcms.booking.reservation.${kind}`);
    }
  });

  test("the module publishes them and the runtime registry knows each one at version 1.0", () => {
    expect(bookingModule.events?.publishes).toEqual(
      Object.values(BOOKING_EVENT_TYPES)
    );
    for (const type of Object.values(BOOKING_EVENT_TYPES)) {
      expect(
        DOMAIN_EVENT_TYPE_REGISTRY.some(
          (entry) => entry.eventType === type && entry.eventVersion === "1.0"
        )
      ).toBe(true);
    }
  });
});
