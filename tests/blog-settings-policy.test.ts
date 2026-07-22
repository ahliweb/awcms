/**
 * Unit tests for `blog-settings-policy.ts`'s `contentQualityChecklistPolicy`
 * field (Issue #640). Scoped only to the field this issue added — the rest
 * of `validateUpdateBlogSettingsInput` (blogTitle, postsPerPage, etc., Issue
 * #543) has no pre-existing test file and is out of this issue's atomic
 * scope to retrofit.
 */
import { describe, expect, test } from "bun:test";

import { validateUpdateBlogSettingsInput } from "../src/modules/blog-content/domain/blog-settings-policy";

describe("validateUpdateBlogSettingsInput — contentQualityChecklistPolicy (Issue #640)", () => {
  test("undefined is left untouched (partial update)", () => {
    const result = validateUpdateBlogSettingsInput({});
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.contentQualityChecklistPolicy).toBeUndefined();
    }
  });

  test("accepts a valid override map for overridable rule ids", () => {
    const result = validateUpdateBlogSettingsInput({
      contentQualityChecklistPolicy: {
        excerpt_present: "blocking",
        featured_image_alt_text: "info"
      }
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.contentQualityChecklistPolicy).toEqual({
        excerpt_present: "blocking",
        featured_image_alt_text: "info"
      });
    }
  });

  test("accepts an empty object (clearing all overrides)", () => {
    const result = validateUpdateBlogSettingsInput({
      contentQualityChecklistPolicy: {}
    });
    expect(result.valid).toBe(true);
  });

  test("rejects a security rule id (unsafe_html_rejected) — never accepted, not even silently ignored", () => {
    const result = validateUpdateBlogSettingsInput({
      contentQualityChecklistPolicy: { unsafe_html_rejected: "info" }
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some((e) => e.field === "contentQualityChecklistPolicy")
      ).toBe(true);
    }
  });

  test("rejects a security rule id (no_local_image_path)", () => {
    const result = validateUpdateBlogSettingsInput({
      contentQualityChecklistPolicy: { no_local_image_path: "warning" }
    });
    expect(result.valid).toBe(false);
  });

  test("rejects an unknown rule id", () => {
    const result = validateUpdateBlogSettingsInput({
      contentQualityChecklistPolicy: { not_a_real_rule: "warning" }
    });
    expect(result.valid).toBe(false);
  });

  test("rejects an invalid severity value", () => {
    const result = validateUpdateBlogSettingsInput({
      contentQualityChecklistPolicy: { excerpt_present: "critical" }
    });
    expect(result.valid).toBe(false);
  });

  test("rejects a non-object value", () => {
    const result = validateUpdateBlogSettingsInput({
      contentQualityChecklistPolicy: "not-an-object"
    });
    expect(result.valid).toBe(false);
  });

  test("rejects an array value", () => {
    const result = validateUpdateBlogSettingsInput({
      contentQualityChecklistPolicy: ["excerpt_present"]
    });
    expect(result.valid).toBe(false);
  });
});
