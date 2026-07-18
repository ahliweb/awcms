import { describe, expect, test } from "bun:test";

import {
  validateCreateRoleInput,
  validateDeleteRoleInput,
  validatePermissionRefInput,
  validateUpdateRoleInput
} from "../src/modules/identity-access/domain/role-admin-validation";

describe("validateCreateRoleInput", () => {
  test("requires roleCode and roleName", () => {
    const result = validateCreateRoleInput({});
    expect(result.valid).toBe(false);
    if (!result.valid) {
      const fields = result.errors.map((e) => e.field);
      expect(fields).toContain("roleCode");
      expect(fields).toContain("roleName");
    }
  });

  test("rejects a roleCode that is not a lowercase slug", () => {
    const result = validateCreateRoleInput({
      roleCode: "Not A Slug!",
      roleName: "Ops"
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.map((e) => e.field)).toContain("roleCode");
    }
  });

  test("rejects a single-character roleCode (min length 2)", () => {
    const result = validateCreateRoleInput({ roleCode: "a", roleName: "Ops" });
    expect(result.valid).toBe(false);
  });

  test("trims and accepts a valid slug role", () => {
    const result = validateCreateRoleInput({
      roleCode: "  store_manager ",
      roleName: "  Store Manager "
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value).toEqual({
        roleCode: "store_manager",
        roleName: "Store Manager"
      });
    }
  });
});

describe("validateUpdateRoleInput", () => {
  test("requires a non-empty roleName", () => {
    const result = validateUpdateRoleInput({ roleName: "   " });
    expect(result.valid).toBe(false);
  });

  test("trims a valid roleName", () => {
    const result = validateUpdateRoleInput({ roleName: " Renamed " });
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.value).toEqual({ roleName: "Renamed" });
  });
});

describe("validateDeleteRoleInput", () => {
  test("allows an absent body (reason is null)", () => {
    const result = validateDeleteRoleInput(undefined);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.value).toEqual({ reason: null });
  });

  test("allows an explicit null reason", () => {
    const result = validateDeleteRoleInput({ reason: null });
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.value.reason).toBeNull();
  });

  test("rejects a blank string reason", () => {
    const result = validateDeleteRoleInput({ reason: "   " });
    expect(result.valid).toBe(false);
  });

  test("trims a provided reason", () => {
    const result = validateDeleteRoleInput({ reason: "  offboarding " });
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.value.reason).toBe("offboarding");
  });
});

describe("validatePermissionRefInput", () => {
  test("requires a permissionId", () => {
    const result = validatePermissionRefInput({});
    expect(result.valid).toBe(false);
  });

  test("rejects a non-UUID permissionId", () => {
    const result = validatePermissionRefInput({ permissionId: "not-a-uuid" });
    expect(result.valid).toBe(false);
  });

  test("accepts a valid UUID permissionId", () => {
    const id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    const result = validatePermissionRefInput({ permissionId: id });
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.value).toEqual({ permissionId: id });
  });
});
