import { describe, expect, test } from "bun:test";

import {
  validateCreatePartyInput,
  validateUpdatePartyInput
} from "../src/modules/profile-identity/domain/party-validation";

describe("validateCreatePartyInput", () => {
  test("requires profileType and displayName", () => {
    const result = validateCreatePartyInput({});

    expect(result.valid).toBe(false);
    if (!result.valid) {
      const fields = result.errors.map((e) => e.field);
      expect(fields).toContain("profileType");
      expect(fields).toContain("displayName");
    }
  });

  test("accepts a minimal valid person profile and defaults riskLevel to normal", () => {
    const result = validateCreatePartyInput({
      profileType: "person",
      displayName: "Jane Doe"
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value).toEqual({
        profileType: "person",
        displayName: "Jane Doe",
        legalName: null,
        riskLevel: "normal"
      });
    }
  });

  test("rejects an invalid profileType", () => {
    const result = validateCreatePartyInput({
      profileType: "robot",
      displayName: "X"
    });

    expect(result.valid).toBe(false);
  });
});

describe("validateUpdatePartyInput", () => {
  test("requires at least one field", () => {
    const result = validateUpdatePartyInput({});

    expect(result.valid).toBe(false);
  });

  test("accepts a partial update", () => {
    const result = validateUpdatePartyInput({ status: "inactive" });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value).toEqual({ status: "inactive" });
    }
  });
});
