import { describe, expect, test } from "bun:test";

import {
  isValidUuid,
  validateUpdateInternalTagLinkingSettingsInput
} from "../src/modules/blog-content/domain/internal-tag-linking-policy";

const VALID_UUID = "11111111-1111-1111-1111-111111111111";

describe("validateUpdateInternalTagLinkingSettingsInput", () => {
  test("accepts an empty body (no-op partial update)", () => {
    const result = validateUpdateInternalTagLinkingSettingsInput({});
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value).toEqual({});
    }
  });

  test("accepts enabled/caseInsensitive booleans", () => {
    const result = validateUpdateInternalTagLinkingSettingsInput({
      enabled: false,
      caseInsensitive: true
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value).toEqual({ enabled: false, caseInsensitive: true });
    }
  });

  test("rejects a non-boolean enabled", () => {
    const result = validateUpdateInternalTagLinkingSettingsInput({
      enabled: "yes"
    });
    expect(result.valid).toBe(false);
  });

  test("rejects a non-boolean caseInsensitive", () => {
    const result = validateUpdateInternalTagLinkingSettingsInput({
      caseInsensitive: 1
    });
    expect(result.valid).toBe(false);
  });

  test("accepts a valid disabledTagIds array and de-duplicates it", () => {
    const result = validateUpdateInternalTagLinkingSettingsInput({
      disabledTagIds: [VALID_UUID, VALID_UUID]
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.disabledTagIds).toEqual([VALID_UUID]);
    }
  });

  test("rejects a disabledTagIds entry that is not a UUID", () => {
    const result = validateUpdateInternalTagLinkingSettingsInput({
      disabledTagIds: ["not-a-uuid"]
    });
    expect(result.valid).toBe(false);
  });

  test("rejects a non-array disabledTagIds", () => {
    const result = validateUpdateInternalTagLinkingSettingsInput({
      disabledTagIds: VALID_UUID
    });
    expect(result.valid).toBe(false);
  });

  test("rejects an oversized disabledTagIds array", () => {
    const tooMany = Array.from({ length: 501 }, () => VALID_UUID);
    const result = validateUpdateInternalTagLinkingSettingsInput({
      disabledTagIds: tooMany
    });
    expect(result.valid).toBe(false);
  });
});

describe("isValidUuid", () => {
  test("accepts a well-formed UUID", () => {
    expect(isValidUuid(VALID_UUID)).toBe(true);
  });

  test("rejects a malformed value", () => {
    expect(isValidUuid("not-a-uuid")).toBe(false);
    expect(isValidUuid(123)).toBe(false);
    expect(isValidUuid(undefined)).toBe(false);
  });
});
