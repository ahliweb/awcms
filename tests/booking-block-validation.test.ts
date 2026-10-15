/**
 * The body shape of `POST /api/v1/booking/blocks` (Issue #1012) and its pairing
 * with `validateCreateBlock`: the shape check refuses what a client must not
 * assert, the value check refuses what the database CHECKs would.
 */
import { describe, expect, test } from "bun:test";

import { parseCreateBlockBody } from "../src/modules/booking/domain/booking-block-validation";
import { validateCreateBlock } from "../src/modules/booking/domain/booking-stay";

const RESOURCE = "11111111-1111-4111-8111-111111111111";
const UNIT = "22222222-2222-4222-8222-222222222222";

const good = {
  resourceId: RESOURCE,
  fromDate: "2032-06-10",
  toDate: "2032-06-12",
  reasonCode: "maintenance"
};

describe("parseCreateBlockBody", () => {
  test("accepts the five known keys; a missing or null unitId means every unit", () => {
    expect(parseCreateBlockBody(good)).toEqual({
      valid: true,
      value: { ...good, unitId: null }
    });
    expect(parseCreateBlockBody({ ...good, unitId: null })).toMatchObject({
      valid: true,
      value: { unitId: null }
    });
    expect(
      parseCreateBlockBody({ ...good, unitId: UNIT.toUpperCase() })
    ).toMatchObject({ valid: true, value: { unitId: UNIT } });
  });

  test("refuses a key the client must not assert (status, actor, release stamps)", () => {
    for (const key of ["status", "releasedAt", "createdBy", "id", "units"]) {
      const parsed = parseCreateBlockBody({ ...good, [key]: "x" });

      expect(parsed.valid).toBe(false);
      expect(!parsed.valid && parsed.errors.map((e) => e.field)).toContain(key);
    }
  });

  test("refuses a non-object body and a missing or non-string field", () => {
    for (const raw of [null, undefined, [], "text", 7]) {
      expect(parseCreateBlockBody(raw).valid).toBe(false);
    }

    for (const key of ["resourceId", "fromDate", "toDate", "reasonCode"]) {
      expect(parseCreateBlockBody({ ...good, [key]: undefined }).valid).toBe(
        false
      );
      expect(parseCreateBlockBody({ ...good, [key]: 5 }).valid).toBe(false);
    }

    expect(parseCreateBlockBody({ ...good, unitId: 5 }).valid).toBe(false);
  });
});

describe("validateCreateBlock on a parsed body", () => {
  function issuesOf(overrides: Record<string, unknown>) {
    const parsed = parseCreateBlockBody({ ...good, ...overrides });

    return parsed.valid ? validateCreateBlock(parsed.value) : parsed.errors;
  }

  test("a good body has no issue", () => {
    expect(issuesOf({})).toEqual([]);
    expect(issuesOf({ unitId: UNIT, reasonCode: "owner_use" })).toEqual([]);
  });

  test("date problems carry STAY_DATES_INVALID, the rest do not", () => {
    for (const overrides of [
      { fromDate: "2032-06-10T00:00:00Z" },
      { fromDate: "2032-02-30" },
      { fromDate: "2032-06-12", toDate: "2032-06-10" },
      { toDate: "2032-06-10" },
      { toDate: "2034-06-10" }
    ]) {
      expect(issuesOf(overrides).map((issue) => issue.code)).toContain(
        "STAY_DATES_INVALID"
      );
    }

    const reason = issuesOf({ reasonCode: "because" });

    expect(reason).toHaveLength(1);
    expect(reason[0]!.code).toBeUndefined();
    expect(issuesOf({ resourceId: "nope" })[0]!.field).toBe("resourceId");
    expect(issuesOf({ unitId: "nope" })[0]!.field).toBe("unitId");
  });
});
