/**
 * Request validation of the `booking` availability slice (Issue #938): strict
 * bodies, RFC 3339 instants with an explicit offset, IANA zone names only.
 */
import { describe, expect, test } from "bun:test";

import {
  parseAvailabilityQuery,
  parseInstant,
  validateCreateException,
  validateCreateSchedule,
  validateSchedulePatch,
  validateSlotStepSeconds
} from "../src/modules/booking/domain/booking-validation";

const RESOURCE = "11111111-1111-4111-8111-111111111111";
const OFFERING = "22222222-2222-4222-8222-222222222222";

function query(entries: Record<string, string>): URLSearchParams {
  return new URLSearchParams({
    resourceId: RESOURCE,
    offeringId: OFFERING,
    ...entries
  });
}

describe("instants carry an explicit offset (booking.md section 2.1)", () => {
  test.each([
    ["2026-10-12T09:00:00Z", true],
    ["2026-10-12T09:00:00+07:00", true],
    ["2026-10-12T09:00:00.123-05:00", true],
    ["2026-10-12T09:00Z", true],
    ["2026-10-12T09:00:00", false],
    ["2026-10-12 09:00:00Z", false],
    ["2026-10-12", false],
    ["2026-02-30T09:00:00Z", false],
    ["2026-10-12T25:00:00Z", false],
    ["now", false],
    ["1760000000", false],
    [null, false]
  ])("%p is accepted = %p", (value, expected) => {
    expect(parseInstant(value) !== null).toBe(expected);
  });

  test("the offset is honoured", () => {
    expect(parseInstant("2026-10-12T09:00:00+07:00")).toBe(
      Date.parse("2026-10-12T02:00:00Z")
    );
  });
});

describe("GET /booking/availability query", () => {
  test("a slot query", () => {
    const parsed = parseAvailabilityQuery(
      query({
        from: "2026-10-12T00:00:00Z",
        to: "2026-10-13T00:00:00Z",
        quantity: "2",
        limit: "50"
      })
    );

    expect(parsed.valid).toBe(true);
    expect(parsed.valid && parsed.value.mode).toBe("slot");
    expect(parsed.valid && parsed.value.quantity).toBe(2);
  });

  test("a stay query", () => {
    const parsed = parseAvailabilityQuery(
      query({ checkInDate: "2026-10-20", checkOutDate: "2026-10-23" })
    );

    expect(parsed.valid && parsed.value).toMatchObject({
      mode: "stay",
      checkInDate: "2026-10-20"
    });
  });

  test.each([
    ["neither family", {}],
    [
      "both families",
      {
        from: "2026-10-12T00:00:00Z",
        to: "2026-10-13T00:00:00Z",
        checkInDate: "2026-10-20",
        checkOutDate: "2026-10-23"
      }
    ],
    [
      "an instant without an offset",
      { from: "2026-10-12T00:00:00", to: "2026-10-13T00:00:00Z" }
    ],
    [
      "to not after from",
      { from: "2026-10-13T00:00:00Z", to: "2026-10-13T00:00:00Z" }
    ],
    [
      "a window over 31 days",
      { from: "2026-10-01T00:00:00Z", to: "2026-11-02T00:00:00Z" }
    ],
    [
      "a limit above 500",
      { from: "2026-10-12T00:00:00Z", to: "2026-10-13T00:00:00Z", limit: "501" }
    ],
    [
      "a zero quantity",
      {
        from: "2026-10-12T00:00:00Z",
        to: "2026-10-13T00:00:00Z",
        quantity: "0"
      }
    ],
    [
      "an instant for a stay",
      { checkInDate: "2026-10-20T14:00:00Z", checkOutDate: "2026-10-23" }
    ],
    ["a missing check-out", { checkInDate: "2026-10-20" }],
    [
      "an unknown parameter",
      {
        from: "2026-10-12T00:00:00Z",
        to: "2026-10-13T00:00:00Z",
        tenantId: "x"
      }
    ]
  ])("refuses %s", (_name, entries) => {
    expect(parseAvailabilityQuery(query(entries)).valid).toBe(false);
  });

  test("requires uuid resource and offering ids", () => {
    const bad = new URLSearchParams({
      resourceId: "nope",
      offeringId: OFFERING,
      from: "2026-10-12T00:00:00Z",
      to: "2026-10-13T00:00:00Z"
    });

    expect(parseAvailabilityQuery(bad).valid).toBe(false);
  });
});

describe("create schedule body", () => {
  const body = {
    timezone: "Asia/Pontianak",
    effectiveFrom: "2026-01-01",
    rules: { weekly: { mon: [{ from: "09:00", to: "17:00" }] } }
  };

  test("accepts a tenant default and a resource-bound schedule", () => {
    expect(validateCreateSchedule(body).valid).toBe(true);
    expect(
      validateCreateSchedule({
        ...body,
        resourceId: RESOURCE,
        effectiveTo: "2027-01-01"
      }).valid
    ).toBe(true);
  });

  test.each([
    ["an offset zone", { timezone: "+07:00" }],
    ["an abbreviation zone", { timezone: "WIB" }],
    ["a missing zone", { timezone: undefined }],
    ["effectiveTo not after effectiveFrom", { effectiveTo: "2026-01-01" }],
    ["a bad date", { effectiveFrom: "2026-1-1" }],
    [
      "a recurrence string in rules",
      { rules: { weekly: {}, rrule: "FREQ=DAILY" } }
    ],
    ["an unknown field", { status: "active" }],
    ["a non-uuid resource", { resourceId: "r1" }]
  ])("refuses %s", (_name, patch) => {
    expect(validateCreateSchedule({ ...body, ...patch }).valid).toBe(false);
  });

  test("refuses a body that is not an object", () => {
    expect(validateCreateSchedule([]).valid).toBe(false);
    expect(validateCreateSchedule(null).valid).toBe(false);
  });
});

describe("schedule patch", () => {
  test("shorten or deactivate, nothing else", () => {
    expect(validateSchedulePatch({ effectiveTo: "2026-12-31" }).valid).toBe(
      true
    );
    expect(validateSchedulePatch({ status: "inactive" }).valid).toBe(true);
    expect(validateSchedulePatch({}).valid).toBe(false);
    expect(validateSchedulePatch({ status: "active" }).valid).toBe(false);
    expect(validateSchedulePatch({ rules: {} }).valid).toBe(false);
    expect(validateSchedulePatch({ effectiveTo: "tomorrow" }).valid).toBe(
      false
    );
  });
});

describe("create exception body", () => {
  const closed = {
    resourceId: RESOURCE,
    localFrom: "2026-12-24",
    localTo: "2026-12-27",
    kind: "closed",
    reasonCode: "holiday"
  };

  test("a closure and an override", () => {
    expect(validateCreateException(closed).valid).toBe(true);
    expect(
      validateCreateException({
        scheduleId: OFFERING,
        localFrom: "2026-12-24",
        localTo: "2026-12-25",
        kind: "override_hours",
        windows: [{ from: "10:00", to: "14:00" }]
      }).valid
    ).toBe(true);
  });

  test.each([
    ["no owner", { resourceId: undefined }],
    ["two owners", { scheduleId: OFFERING }],
    ["an override without windows", { kind: "override_hours" }],
    ["a closure with windows", { windows: [{ from: "10:00", to: "14:00" }] }],
    ["free-text reason", { reasonCode: "Christmas, closed for family" }],
    ["an empty range", { localTo: "2026-12-24" }],
    ["a backwards range", { localFrom: "2026-12-27", localTo: "2026-12-24" }],
    ["an unknown kind", { kind: "blocked" }],
    ["an unknown field", { note: "x" }]
  ])("refuses %s", (_name, patch) => {
    expect(validateCreateException({ ...closed, ...patch }).valid).toBe(false);
  });
});

describe("offering slot step floor", () => {
  test.each([
    [300, true],
    [900, true],
    [299, false],
    [1, false],
    [0, false],
    [450.5, false],
    ["900", false]
  ])("%p is accepted = %p", (value, ok) => {
    expect(validateSlotStepSeconds(value) === null).toBe(ok);
  });
});
