/**
 * The pure request rules of the booking admin configuration routes (Issue
 * #1030). The integration suite proves the HTTP and database behaviour; this
 * pins the rules that need no database, including that they restate the CHECKs
 * of `sql/180` / `sql/186` (so a violation is a named 400 first).
 */
import { describe, expect, test } from "bun:test";

import {
  validateCreateOffering,
  validateCreatePool,
  validateCreateResource,
  validateOfferingPatch,
  validateOfferingShape,
  validatePolicy,
  validatePoolPatch,
  validateResourcePatch,
  validateResourceShape,
  POLICY_FIELDS
} from "../src/modules/booking/domain/booking-admin-validation";

const FULL_POLICY = Object.fromEntries(
  POLICY_FIELDS.map((field) => [field, null])
) as Record<string, unknown>;

function fields(result: { valid: boolean; errors?: { field: string }[] }) {
  return result.valid ? [] : result.errors!.map((error) => error.field);
}

describe("resources", () => {
  const slot = {
    code: "r1",
    name: "Room",
    kind: "room",
    capacity: 2,
    timezone: "Asia/Jakarta"
  };

  test("a slot resource defaults mode, status, order and has no stay times", () => {
    const result = validateCreateResource(slot);

    expect(result).toMatchObject({
      valid: true,
      value: {
        bookingMode: "slot",
        status: "active",
        sortOrder: 0,
        poolId: null,
        stayCheckInTime: null,
        unitLabels: []
      }
    });
  });

  test("local times are normalised to HH:MM:SS", () => {
    const result = validateCreateResource({
      ...slot,
      bookingMode: "stay",
      stayCheckInTime: "14:00",
      stayCheckOutTime: "11:30:15"
    });

    expect(result).toMatchObject({
      valid: true,
      value: { stayCheckInTime: "14:00:00", stayCheckOutTime: "11:30:15" }
    });
  });

  test("the stay-times CHECK holds in both directions", () => {
    expect(
      validateResourceShape({
        bookingMode: "stay",
        stayCheckInTime: null,
        stayCheckOutTime: "12:00:00"
      })
    ).toHaveLength(1);
    expect(
      validateResourceShape({
        bookingMode: "slot",
        stayCheckInTime: "14:00:00",
        stayCheckOutTime: null
      })
    ).toHaveLength(1);
    expect(
      validateResourceShape({
        bookingMode: "slot",
        stayCheckInTime: null,
        stayCheckOutTime: null
      })
    ).toHaveLength(0);
  });

  test.each([
    ["offset zone", { ...slot, timezone: "+07:00" }, "timezone"],
    ["abbreviation", { ...slot, timezone: "WIB" }, "timezone"],
    ["capacity 0", { ...slot, capacity: 0 }, "capacity"],
    ["capacity 501", { ...slot, capacity: 501 }, "capacity"],
    ["fractional capacity", { ...slot, capacity: 1.5 }, "capacity"],
    ["bad code", { ...slot, code: "-x" }, "code"],
    ["bad kind", { ...slot, kind: "Room" }, "kind"],
    ["unknown key", { ...slot, price: 1 }, "price"],
    ["missing code", { ...slot, code: undefined }, "code"],
    [
      "labels beyond capacity",
      { ...slot, unitLabels: ["a", "b", "c"] },
      "unitLabels"
    ],
    [
      "bad time",
      {
        ...slot,
        bookingMode: "stay",
        stayCheckInTime: "25:00",
        stayCheckOutTime: "12:00"
      },
      "stayCheckInTime"
    ]
  ])("refuses %s", (_label, body, field) => {
    expect(fields(validateCreateResource(body))).toContain(field);
  });

  test("a body that is not an object is refused", () => {
    expect(validateCreateResource([]).valid).toBe(false);
    expect(validateCreateResource(null).valid).toBe(false);
  });

  test("patch: at least one field; code is not editable; units are checked one by one", () => {
    expect(validateResourcePatch({}).valid).toBe(false);
    expect(fields(validateResourcePatch({ code: "x" }))).toContain("code");
    expect(
      fields(
        validateResourcePatch({
          units: [{ id: "nope", label: "a" }, { id: crypto.randomUUID() }]
        })
      )
    ).toEqual(["units[0].id", "units[1].label"]);
    expect(
      validateResourcePatch({ poolId: null, capacity: 3, status: "inactive" })
    ).toMatchObject({ valid: true, value: { poolId: null, capacity: 3 } });
  });

  test("patch: a duplicate unit id is refused", () => {
    const id = crypto.randomUUID();

    expect(
      validateResourcePatch({
        units: [
          { id, label: "a" },
          { id, label: "b" }
        ]
      }).valid
    ).toBe(false);
  });
});

describe("pools", () => {
  test("create and patch", () => {
    expect(validateCreatePool({ code: "p", name: "Pool" })).toMatchObject({
      valid: true,
      value: { allocationPolicy: "first_free" }
    });
    expect(validateCreatePool({ code: "p" }).valid).toBe(false);
    expect(
      validateCreatePool({ code: "p", name: "n", allocationPolicy: "random" })
        .valid
    ).toBe(false);
    expect(validatePoolPatch({}).valid).toBe(false);
    expect(validatePoolPatch({ code: "z" }).valid).toBe(false);
    expect(validatePoolPatch({ name: "ok" }).valid).toBe(true);
  });
});

describe("offerings", () => {
  const time = {
    code: "cut",
    name: "Cut",
    granularity: "time",
    durationSeconds: 1800,
    slotStepSeconds: 900
  };
  const stay = {
    code: "night",
    name: "Night",
    granularity: "stay",
    minNights: 1,
    maxNights: 7
  };

  test("a time offering defaults buffers to 0 and party to 1", () => {
    expect(validateCreateOffering(time)).toMatchObject({
      valid: true,
      value: {
        setupSeconds: 0,
        cleanupSeconds: 0,
        minParty: 1,
        maxParty: 1,
        confirmationMode: "hold_then_confirm",
        status: "active"
      }
    });
  });

  test("a stay offering has no time fields", () => {
    expect(validateCreateOffering(stay)).toMatchObject({
      valid: true,
      value: {
        durationSeconds: null,
        setupSeconds: null,
        slotStepSeconds: null
      }
    });
  });

  test.each([
    [
      "time without duration",
      { ...time, durationSeconds: undefined },
      "durationSeconds"
    ],
    [
      "step under the 300 s floor",
      { ...time, slotStepSeconds: 299 },
      "slotStepSeconds"
    ],
    ["time with nights", { ...time, minNights: 1, maxNights: 2 }, "minNights"],
    ["stay with duration", { ...stay, durationSeconds: 60 }, "durationSeconds"],
    [
      "stay without nights",
      { ...stay, minNights: undefined, maxNights: undefined },
      "minNights"
    ],
    [
      "max below min nights",
      { ...stay, minNights: 5, maxNights: 2 },
      "maxNights"
    ],
    ["max nights above 366", { ...stay, maxNights: 367 }, "maxNights"],
    ["max party below min", { ...time, minParty: 4, maxParty: 2 }, "maxParty"],
    ["bad mode", { ...time, confirmationMode: "later" }, "confirmationMode"],
    ["a price", { ...time, price: 5 }, "price"],
    ["bad granularity", { ...time, granularity: "week" }, "granularity"]
  ])("refuses %s", (_label, body, field) => {
    expect(fields(validateCreateOffering(body))).toContain(field);
  });

  test("the merged-shape rule is the CHECK", () => {
    const base = validateCreateOffering(time);

    if (!base.valid) throw new Error("fixture");

    expect(
      validateOfferingShape({ ...base.value, durationSeconds: null })
    ).toHaveLength(1);
    expect(validateOfferingShape({ ...base.value, minNights: 1 })).toHaveLength(
      1
    );
  });

  test("patch cannot name code or granularity, and cannot be empty", () => {
    expect(validateOfferingPatch({}).valid).toBe(false);
    expect(validateOfferingPatch({ code: "x" }).valid).toBe(false);
    expect(validateOfferingPatch({ granularity: "stay" }).valid).toBe(false);
    expect(validateOfferingPatch({ minLeadSeconds: null })).toMatchObject({
      valid: true,
      value: { minLeadSeconds: null }
    });
  });
});

describe("policy", () => {
  test("every field is required: omission is not a silent reset", () => {
    const { noShowGraceSeconds: _omit, ...rest } = FULL_POLICY;

    expect(fields(validatePolicy(rest))).toEqual(["noShowGraceSeconds"]);
    expect(validatePolicy({}).valid).toBe(false);
    expect(validatePolicy(FULL_POLICY).valid).toBe(true);
  });

  test.each([
    ["hold below 60", { defaultHoldSeconds: 59 }, "defaultHoldSeconds"],
    ["max hold above a day", { maxHoldSeconds: 86_401 }, "maxHoldSeconds"],
    [
      "default above max",
      { defaultHoldSeconds: 900, maxHoldSeconds: 600 },
      "defaultHoldSeconds"
    ],
    [
      "customer cap 0",
      { maxActiveHoldsPerCustomer: 0 },
      "maxActiveHoldsPerCustomer"
    ],
    ["tenant cap 0", { maxActiveHoldsPerTenant: 0 }, "maxActiveHoldsPerTenant"],
    ["negative lead", { minLeadSeconds: -1 }, "minLeadSeconds"],
    ["horizon 0", { maxHorizonDays: 0 }, "maxHorizonDays"],
    ["horizon 3651", { maxHorizonDays: 3651 }, "maxHorizonDays"],
    ["negative grace", { noShowGraceSeconds: -5 }, "noShowGraceSeconds"],
    ["offset zone", { defaultTimezone: "+07:00" }, "defaultTimezone"],
    ["bad time", { defaultCheckInTime: "7pm" }, "defaultCheckInTime"],
    ["string number", { minLeadSeconds: "0" }, "minLeadSeconds"]
  ])("refuses %s", (_label, change, field) => {
    expect(fields(validatePolicy({ ...FULL_POLICY, ...change }))).toContain(
      field
    );
  });

  test("null is the module default and zero grace is allowed", () => {
    expect(
      validatePolicy({
        ...FULL_POLICY,
        noShowGraceSeconds: 0,
        minLeadSeconds: 0
      })
    ).toMatchObject({
      valid: true,
      value: { noShowGraceSeconds: 0, defaultHoldSeconds: null }
    });
  });
});
