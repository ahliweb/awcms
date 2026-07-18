import { describe, expect, test } from "bun:test";

import {
  validateCreateAbacPolicyInput,
  validateUpdateAbacPolicyInput
} from "../src/modules/identity-access/domain/abac-admin-validation";

describe("validateCreateAbacPolicyInput", () => {
  test("requires policyCode and effect", () => {
    const result = validateCreateAbacPolicyInput({});

    expect(result.valid).toBe(false);
    if (!result.valid) {
      const fields = result.errors.map((e) => e.field);
      expect(fields).toContain("policyCode");
      expect(fields).toContain("effect");
    }
  });

  test("accepts a minimal valid policy and defaults description to null", () => {
    const result = validateCreateAbacPolicyInput({
      policyCode: "deny.after_hours",
      effect: "deny"
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value).toEqual({
        policyCode: "deny.after_hours",
        effect: "deny",
        description: null
      });
    }
  });

  test("trims policyCode/description and normalises blank description to null", () => {
    const result = validateCreateAbacPolicyInput({
      policyCode: "  allow.weekday  ",
      effect: "allow",
      description: "   "
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.policyCode).toBe("allow.weekday");
      expect(result.value.description).toBe(null);
    }
  });

  test("rejects an effect outside allow/deny", () => {
    const result = validateCreateAbacPolicyInput({
      policyCode: "x",
      effect: "maybe"
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.map((e) => e.field)).toContain("effect");
    }
  });

  test("rejects a malformed policyCode (leading punctuation / illegal chars)", () => {
    for (const bad of [".starts-with-dot", "has space", "has/slash"]) {
      const result = validateCreateAbacPolicyInput({
        policyCode: bad,
        effect: "allow"
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.map((e) => e.field)).toContain("policyCode");
      }
    }
  });
});

describe("validateUpdateAbacPolicyInput", () => {
  test("rejects an empty patch (no updatable field provided)", () => {
    const result = validateUpdateAbacPolicyInput({});

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.map((e) => e.field)).toContain("body");
    }
  });

  test("accepts an isActive-only toggle patch", () => {
    const result = validateUpdateAbacPolicyInput({ isActive: false });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value).toEqual({ isActive: false });
    }
  });

  test("keeps an explicit null description as a clear, not 'unchanged'", () => {
    const result = validateUpdateAbacPolicyInput({ description: null });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect("description" in result.value).toBe(true);
      expect(result.value.description).toBe(null);
    }
  });

  test("rejects a non-boolean isActive", () => {
    const result = validateUpdateAbacPolicyInput({ isActive: "yes" });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.map((e) => e.field)).toContain("isActive");
    }
  });

  test("accepts a combined effect + description update", () => {
    const result = validateUpdateAbacPolicyInput({
      effect: "deny",
      description: "Blocks weekend posting"
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value).toEqual({
        effect: "deny",
        description: "Blocks weekend posting"
      });
    }
  });
});
