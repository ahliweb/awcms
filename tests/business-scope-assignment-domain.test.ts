import { describe, expect, test } from "bun:test";

import {
  isBusinessScopeAssignmentCurrentlyActive,
  validateCreateBusinessScopeAssignmentInput,
  validateRevokeBusinessScopeAssignmentInput,
  type CreateBusinessScopeAssignmentInput
} from "../src/modules/identity-access/domain/business-scope-assignment";

function baseCreateInput(
  overrides: Partial<CreateBusinessScopeAssignmentInput> = {}
): CreateBusinessScopeAssignmentInput {
  return {
    tenantUserId: "user-1",
    roleId: "role-1",
    scopeType: "office",
    scopeId: "00000000-0000-0000-0000-0000000000aa",
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveTo: null,
    isTemporary: false,
    reason: null,
    ...overrides
  };
}

describe("validateCreateBusinessScopeAssignmentInput", () => {
  test("accepts a well-formed permanent assignment", () => {
    expect(
      validateCreateBusinessScopeAssignmentInput(baseCreateInput())
    ).toEqual([]);
  });

  test("rejects a non-snake_case scope type", () => {
    const errors = validateCreateBusinessScopeAssignmentInput(
      baseCreateInput({ scopeType: "Office" })
    );
    expect(errors.map((e) => e.field)).toContain("scopeType");
  });

  test("rejects the reserved tenant-wide scope type (F2 — cannot be stored as an assignment)", () => {
    const errors = validateCreateBusinessScopeAssignmentInput(
      baseCreateInput({ scopeType: "tenant" })
    );
    const scopeTypeError = errors.find((e) => e.field === "scopeType");
    expect(scopeTypeError).toBeDefined();
    expect(scopeTypeError!.message).toMatch(/reserved/i);
  });

  test("rejects effectiveTo <= effectiveFrom", () => {
    const errors = validateCreateBusinessScopeAssignmentInput(
      baseCreateInput({
        effectiveFrom: new Date("2026-02-01T00:00:00.000Z"),
        effectiveTo: new Date("2026-01-01T00:00:00.000Z")
      })
    );
    expect(errors.map((e) => e.field)).toContain("effectiveTo");
  });

  test("a temporary assignment MUST have an end date", () => {
    const errors = validateCreateBusinessScopeAssignmentInput(
      baseCreateInput({ isTemporary: true, effectiveTo: null })
    );
    expect(errors.map((e) => e.field)).toContain("effectiveTo");
  });

  test("a temporary assignment with an end date is valid", () => {
    expect(
      validateCreateBusinessScopeAssignmentInput(
        baseCreateInput({
          isTemporary: true,
          effectiveTo: new Date("2026-06-01T00:00:00.000Z")
        })
      )
    ).toEqual([]);
  });
});

describe("validateRevokeBusinessScopeAssignmentInput", () => {
  test("requires a non-empty reason", () => {
    expect(
      validateRevokeBusinessScopeAssignmentInput({ revokeReason: "   " }).map(
        (e) => e.field
      )
    ).toContain("revokeReason");
  });

  test("accepts a real reason", () => {
    expect(
      validateRevokeBusinessScopeAssignmentInput({
        revokeReason: "Rotated off the branch."
      })
    ).toEqual([]);
  });
});

describe("isBusinessScopeAssignmentCurrentlyActive — effective dating", () => {
  const now = new Date("2026-03-15T12:00:00.000Z");

  test("active row inside its effective window is in force", () => {
    expect(
      isBusinessScopeAssignmentCurrentlyActive(
        {
          status: "active",
          effectiveFrom: new Date("2026-03-01T00:00:00.000Z"),
          effectiveTo: new Date("2026-04-01T00:00:00.000Z")
        },
        now
      )
    ).toBe(true);
  });

  test("active row whose window has not started yet is NOT in force", () => {
    expect(
      isBusinessScopeAssignmentCurrentlyActive(
        {
          status: "active",
          effectiveFrom: new Date("2026-04-01T00:00:00.000Z"),
          effectiveTo: null
        },
        now
      )
    ).toBe(false);
  });

  test("active row whose effectiveTo has elapsed is NOT in force (immediate expiry, no wait for the job)", () => {
    expect(
      isBusinessScopeAssignmentCurrentlyActive(
        {
          status: "active",
          effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
          effectiveTo: new Date("2026-03-15T11:59:59.000Z")
        },
        now
      )
    ).toBe(false);
  });

  test("a revoked row is never in force, even inside its window", () => {
    expect(
      isBusinessScopeAssignmentCurrentlyActive(
        {
          status: "revoked",
          effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
          effectiveTo: new Date("2026-12-01T00:00:00.000Z")
        },
        now
      )
    ).toBe(false);
  });

  test("an expired-status row is never in force", () => {
    expect(
      isBusinessScopeAssignmentCurrentlyActive(
        {
          status: "expired",
          effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
          effectiveTo: null
        },
        now
      )
    ).toBe(false);
  });
});
