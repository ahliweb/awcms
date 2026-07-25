import { describe, expect, test } from "bun:test";

import {
  MAX_PAYLOAD_BYTES,
  findForbiddenPayloadKey,
  validateCreateFormDraftInput,
  validateUpdateFormDraftInput
} from "../src/modules/form-drafts/domain/form-draft-validation";

describe("findForbiddenPayloadKey", () => {
  test("finds a forbidden key at the top level", () => {
    expect(findForbiddenPayloadKey({ password: "x" })).toBe("password");
  });

  test("finds a forbidden key nested inside an object", () => {
    expect(findForbiddenPayloadKey({ auth: { apiKey: "x" } })).toBe(
      "auth.apiKey"
    );
  });

  test("finds a forbidden key nested inside an array of objects", () => {
    expect(
      findForbiddenPayloadKey({ items: [{ title: "ok" }, { token: "x" }] })
    ).toBe("items[1].token");
  });

  test("matches common separator variants (api_key, api-key, apiKey)", () => {
    expect(findForbiddenPayloadKey({ api_key: "x" })).toBe("api_key");
    expect(findForbiddenPayloadKey({ "api-key": "x" })).toBe("api-key");
    expect(findForbiddenPayloadKey({ privateKey: "x" })).toBe("privateKey");
  });

  test("returns null for a payload with no forbidden keys", () => {
    expect(
      findForbiddenPayloadKey({ title: "Demo", category: "general" })
    ).toBeNull();
  });

  test("does not flag a benign key that merely contains a similar substring boundary safely", () => {
    // "keyword" contains "key" but not as a secret-shaped field name on its
    // own — this documents current (intentionally simple, pattern-based)
    // behavior rather than asserting a stricter semantic boundary.
    expect(findForbiddenPayloadKey({ keyword: "x" })).toBeNull();
  });
});

describe("validateCreateFormDraftInput", () => {
  const validBody = {
    moduleKey: "admin_examples",
    wizardKey: "wizard_fixture",
    resourceType: "fixture",
    currentStep: "basic",
    payload: { title: "Demo" }
  };

  test("accepts a well-formed create request", () => {
    const result = validateCreateFormDraftInput(validBody);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.moduleKey).toBe("admin_examples");
      expect(result.value.payload).toEqual({ title: "Demo" });
    }
  });

  test("rejects a moduleKey that isn't lowercase snake_case", () => {
    const result = validateCreateFormDraftInput({
      ...validBody,
      moduleKey: "Admin-Examples"
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === "moduleKey")).toBe(true);
    }
  });

  test("rejects a payload containing a forbidden field", () => {
    const result = validateCreateFormDraftInput({
      ...validBody,
      payload: { title: "Demo", password: "hunter2" }
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]!.field).toBe("payload");
      expect(result.errors[0]!.message).toContain("password");
    }
  });

  test("rejects a payload larger than the max size", () => {
    const result = validateCreateFormDraftInput({
      ...validBody,
      payload: { blob: "x".repeat(MAX_PAYLOAD_BYTES) }
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]!.field).toBe("payload");
    }
  });

  test("rejects a missing currentStep", () => {
    const { currentStep: _omit, ...withoutStep } = validBody;
    const result = validateCreateFormDraftInput(withoutStep);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === "currentStep")).toBe(true);
    }
  });

  test("rejects a non-object payload", () => {
    const result = validateCreateFormDraftInput({
      ...validBody,
      payload: "not-an-object"
    });
    expect(result.valid).toBe(false);
  });

  test("accepts an optional resourceId and expiresAt", () => {
    const result = validateCreateFormDraftInput({
      ...validBody,
      resourceId: "draft-target-1",
      expiresAt: "2026-08-01T00:00:00.000Z"
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.resourceId).toBe("draft-target-1");
      expect(result.value.expiresAt).toBe("2026-08-01T00:00:00.000Z");
    }
  });

  test("rejects an invalid expiresAt", () => {
    const result = validateCreateFormDraftInput({
      ...validBody,
      expiresAt: "not-a-date"
    });
    expect(result.valid).toBe(false);
  });
});

describe("validateUpdateFormDraftInput", () => {
  test("accepts a partial update with only payload", () => {
    const result = validateUpdateFormDraftInput({ payload: { title: "New" } });
    expect(result.valid).toBe(true);
  });

  test("rejects an empty body", () => {
    const result = validateUpdateFormDraftInput({});
    expect(result.valid).toBe(false);
  });

  test("rejects a payload with a forbidden field on update too", () => {
    const result = validateUpdateFormDraftInput({
      payload: { token: "abc" }
    });
    expect(result.valid).toBe(false);
  });

  test("accepts explicit null to clear expiresAt", () => {
    const result = validateUpdateFormDraftInput({ expiresAt: null });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.expiresAt).toBeNull();
    }
  });
});
