/**
 * Pure-unit tests for the tenant-user admin write validators (Issue #171). No
 * database — the DB-backed behaviour (audit, 23505 → 409, existence checks)
 * belongs to a real-PostgreSQL suite; here we pin the input contract the routes
 * rely on before they ever open a transaction.
 */
import { describe, expect, test } from "bun:test";

import {
  validateAssignmentInput,
  validateSetStatusInput
} from "../src/modules/identity-access/application/user-admin";

const UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("validateSetStatusInput", () => {
  test("accepts active / inactive", () => {
    expect(validateSetStatusInput({ status: "active" })).toEqual({
      valid: true,
      value: { status: "active" }
    });
    expect(validateSetStatusInput({ status: "inactive" }).valid).toBe(true);
  });

  test("rejects an unknown or missing status", () => {
    for (const body of [{}, { status: "deleted" }, { status: 1 }, null]) {
      const result = validateSetStatusInput(body);
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.errors[0]!.field).toBe("status");
    }
  });
});

describe("validateAssignmentInput", () => {
  test("accepts two valid UUIDs", () => {
    expect(
      validateAssignmentInput({ tenantUserId: UUID, roleId: UUID })
    ).toEqual({ valid: true, value: { tenantUserId: UUID, roleId: UUID } });
  });

  test("rejects a non-UUID tenantUserId or roleId", () => {
    const missingRole = validateAssignmentInput({ tenantUserId: UUID });
    expect(missingRole.valid).toBe(false);

    const badUser = validateAssignmentInput({
      tenantUserId: "not-a-uuid",
      roleId: UUID
    });
    expect(badUser.valid).toBe(false);
    if (!badUser.valid) {
      expect(badUser.errors.map((e) => e.field)).toContain("tenantUserId");
    }
  });
});
