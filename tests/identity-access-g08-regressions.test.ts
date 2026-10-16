import { describe, expect, test } from "bun:test";

import {
  buildAttributeBag,
  evaluateCondition
} from "../src/modules/identity-access/domain/abac-evaluator";
import { parseAbacCondition } from "../src/modules/identity-access/domain/abac-policy";

const CONTEXT = {
  tenantId: "11111111-1111-1111-1111-111111111111",
  tenantUserId: "22222222-2222-2222-2222-222222222222",
  identityId: "33333333-3333-3333-3333-333333333333",
  roles: ["manager"]
};

describe("identity-access g08 regressions", () => {
  test("in/nin on a date attribute compare by epoch, not raw string", () => {
    const bag = buildAttributeBag(
      CONTEXT,
      { moduleKey: "sales", activityCode: "invoice", action: "update" },
      { now: new Date("2026-07-19T10:00:00Z"), ipTrusted: false }
    );
    expect(
      evaluateCondition(
        { attr: "env.now", op: "in", value: ["2026-07-19T10:00:00Z"] },
        bag
      )
    ).toBe(true);
    expect(
      evaluateCondition(
        { attr: "env.now", op: "nin", value: ["2026-07-19T12:00:00+02:00"] },
        bag
      )
    ).toBe(false);
  });

  test("date-time literal without offset is rejected; date-only allowed", () => {
    expect(
      parseAbacCondition({
        attr: "env.now",
        op: "gt",
        value: "2024-01-01T10:00"
      }).valid
    ).toBe(false);
    expect(
      parseAbacCondition({
        attr: "env.now",
        op: "gt",
        value: "2024-01-01T10:00Z"
      }).valid
    ).toBe(true);
    expect(
      parseAbacCondition({ attr: "env.now", op: "gt", value: "2024-01-01" })
        .valid
    ).toBe(true);
    expect(
      parseAbacCondition({ attr: "env.now", op: "gt", value: "2024-02-31" })
        .valid
    ).toBe(false);
  });
});
