import { describe, expect, test } from "bun:test";

import {
  diffModuleSettings,
  mergeEffectiveSettings,
  validateModuleSettingsPatch
} from "../src/modules/module-management/domain/module-settings";

describe("validateModuleSettingsPatch", () => {
  test("rejects a non-object body", () => {
    expect(validateModuleSettingsPatch(null)).toMatchObject({
      valid: false,
      code: "VALIDATION_ERROR"
    });
    expect(validateModuleSettingsPatch("nope")).toMatchObject({
      valid: false,
      code: "VALIDATION_ERROR"
    });
    expect(validateModuleSettingsPatch(["a"])).toMatchObject({
      valid: false,
      code: "VALIDATION_ERROR"
    });
  });

  test("accepts a plain JSON object", () => {
    const result = validateModuleSettingsPatch({
      dailySummaryEnabled: true,
      maxRetries: 3
    });

    expect(result).toEqual({
      valid: true,
      value: { dailySummaryEnabled: true, maxRetries: 3 }
    });
  });

  test("rejects a top-level secret-shaped key", () => {
    const result = validateModuleSettingsPatch({ apiToken: "sk-123" });

    expect(result).toMatchObject({
      valid: false,
      code: "SETTINGS_SENSITIVE_KEY_REJECTED"
    });
  });

  test("rejects a nested secret-shaped key", () => {
    const result = validateModuleSettingsPatch({
      provider: { credential: "shh" }
    });

    expect(result).toMatchObject({
      valid: false,
      code: "SETTINGS_SENSITIVE_KEY_REJECTED"
    });
  });

  test("rejects a secret-shaped key nested inside an array of objects", () => {
    const result = validateModuleSettingsPatch({
      webhooks: [{ url: "https://example.com", secret: "shh" }]
    });

    expect(result).toMatchObject({
      valid: false,
      code: "SETTINGS_SENSITIVE_KEY_REJECTED"
    });
  });
});

describe("mergeEffectiveSettings", () => {
  test("tenant override wins over defaults key-by-key", () => {
    expect(
      mergeEffectiveSettings({ theme: "light", retries: 3 }, { theme: "dark" })
    ).toEqual({ theme: "dark", retries: 3 });
  });

  test("handles missing defaults/override", () => {
    expect(mergeEffectiveSettings(undefined, undefined)).toEqual({});
    expect(mergeEffectiveSettings({ a: 1 }, undefined)).toEqual({ a: 1 });
    expect(mergeEffectiveSettings(undefined, { a: 1 })).toEqual({ a: 1 });
  });
});

describe("diffModuleSettings", () => {
  test("reports added, changed, and removed keys, never values", () => {
    const diff = diffModuleSettings(
      { keep: 1, changeMe: "old", removeMe: true },
      { keep: 1, changeMe: "new", addMe: "x" }
    );

    expect(diff.addedKeys).toEqual(["addMe"]);
    expect(diff.changedKeys).toEqual(["changeMe"]);
    expect(diff.removedKeys).toEqual(["removeMe"]);
  });

  test("no diff when nothing changed", () => {
    const diff = diffModuleSettings({ a: 1 }, { a: 1 });

    expect(diff).toEqual({ addedKeys: [], changedKeys: [], removedKeys: [] });
  });
});
