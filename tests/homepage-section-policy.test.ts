import { describe, expect, test } from "bun:test";

import {
  HOMEPAGE_SECTION_TYPES,
  isHomepageSectionType,
  validateCreateHomepageSectionInput,
  validateHomepageSectionConfig,
  validateUpdateHomepageSectionInput
} from "../src/modules/news-portal/domain/homepage-section-policy";

const VALID_ID = "11111111-1111-1111-1111-111111111111";
const VALID_ID_2 = "22222222-2222-2222-2222-222222222222";

describe("isHomepageSectionType (Issue #637)", () => {
  test("accepts every declared type", () => {
    for (const type of HOMEPAGE_SECTION_TYPES) {
      expect(isHomepageSectionType(type)).toBe(true);
    }
  });

  test("rejects unknown/deferred types (video_block, ad_slot, custom_widget_block, static_page_block)", () => {
    for (const type of [
      "video_block",
      "ad_slot",
      "custom_widget_block",
      "static_page_block",
      "not_a_type",
      123,
      null
    ]) {
      expect(isHomepageSectionType(type)).toBe(false);
    }
  });
});

describe("validateHomepageSectionConfig (Issue #637)", () => {
  test("headline requires a UUID postId", () => {
    const errors: { field: string; message: string }[] = [];
    expect(
      validateHomepageSectionConfig("headline", { postId: VALID_ID }, errors)
    ).toEqual({ postId: VALID_ID });
    expect(errors).toEqual([]);

    const badErrors: { field: string; message: string }[] = [];
    expect(
      validateHomepageSectionConfig(
        "headline",
        { postId: "not-a-uuid" },
        badErrors
      )
    ).toBeNull();
    expect(badErrors.length).toBeGreaterThan(0);
  });

  test("latest_posts defaults limit and allows optional categorySlug", () => {
    const errors: { field: string; message: string }[] = [];
    expect(validateHomepageSectionConfig("latest_posts", {}, errors)).toEqual({
      limit: 5,
      categorySlug: null
    });
    expect(errors).toEqual([]);

    const errors2: { field: string; message: string }[] = [];
    expect(
      validateHomepageSectionConfig(
        "latest_posts",
        { limit: 10, categorySlug: "world" },
        errors2
      )
    ).toEqual({ limit: 10, categorySlug: "world" });
  });

  test("latest_posts rejects limit out of bounds", () => {
    const errors: { field: string; message: string }[] = [];
    expect(
      validateHomepageSectionConfig("latest_posts", { limit: 0 }, errors)
    ).toBeNull();
    expect(errors.length).toBeGreaterThan(0);

    const errors2: { field: string; message: string }[] = [];
    expect(
      validateHomepageSectionConfig("latest_posts", { limit: 21 }, errors2)
    ).toBeNull();
    expect(errors2.length).toBeGreaterThan(0);
  });

  test("featured_posts/editor_picks require a non-empty postIds array of UUIDs", () => {
    const errors: { field: string; message: string }[] = [];
    expect(
      validateHomepageSectionConfig(
        "featured_posts",
        { postIds: [VALID_ID, VALID_ID_2] },
        errors
      )
    ).toEqual({ postIds: [VALID_ID, VALID_ID_2] });

    const errors2: { field: string; message: string }[] = [];
    expect(
      validateHomepageSectionConfig("editor_picks", { postIds: [] }, errors2)
    ).toBeNull();
    expect(errors2.length).toBeGreaterThan(0);

    const errors3: { field: string; message: string }[] = [];
    expect(
      validateHomepageSectionConfig(
        "featured_posts",
        { postIds: ["not-a-uuid"] },
        errors3
      )
    ).toBeNull();
    expect(errors3.length).toBeGreaterThan(0);
  });

  test("category_grid requires categorySlugs and defaults postsPerCategory", () => {
    const errors: { field: string; message: string }[] = [];
    expect(
      validateHomepageSectionConfig(
        "category_grid",
        { categorySlugs: ["world", "sports"] },
        errors
      )
    ).toEqual({ categorySlugs: ["world", "sports"], postsPerCategory: 3 });

    const errors2: { field: string; message: string }[] = [];
    expect(
      validateHomepageSectionConfig(
        "category_grid",
        { categorySlugs: [] },
        errors2
      )
    ).toBeNull();
    expect(errors2.length).toBeGreaterThan(0);

    const errors3: { field: string; message: string }[] = [];
    expect(
      validateHomepageSectionConfig(
        "category_grid",
        { categorySlugs: ["a"], postsPerCategory: 7 },
        errors3
      )
    ).toBeNull();
    expect(errors3.length).toBeGreaterThan(0);
  });

  test("gallery_block requires a non-empty mediaObjectIds array and allows optional caption", () => {
    const errors: { field: string; message: string }[] = [];
    expect(
      validateHomepageSectionConfig(
        "gallery_block",
        { mediaObjectIds: [VALID_ID], caption: "Gallery" },
        errors
      )
    ).toEqual({ mediaObjectIds: [VALID_ID], caption: "Gallery" });

    const errors2: { field: string; message: string }[] = [];
    expect(
      validateHomepageSectionConfig(
        "gallery_block",
        { mediaObjectIds: [] },
        errors2
      )
    ).toBeNull();
    expect(errors2.length).toBeGreaterThan(0);
  });
});

describe("validateCreateHomepageSectionInput (Issue #637)", () => {
  test("accepts a well-formed headline section with defaults", () => {
    const result = validateCreateHomepageSectionInput({
      sectionKey: "front-page-headline",
      sectionType: "headline",
      config: { postId: VALID_ID }
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.sectionKey).toBe("front-page-headline");
      expect(result.value.sortOrder).toBe(0);
      expect(result.value.isEnabled).toBe(true);
      expect(result.value.startsAt).toBeNull();
      expect(result.value.endsAt).toBeNull();
    }
  });

  test("rejects a sectionKey that doesn't match the slug pattern", () => {
    const result = validateCreateHomepageSectionInput({
      sectionKey: "Not A Valid Key!",
      sectionType: "headline",
      config: { postId: VALID_ID }
    });
    expect(result.valid).toBe(false);
  });

  test("rejects an unknown sectionType", () => {
    const result = validateCreateHomepageSectionInput({
      sectionKey: "front-page",
      sectionType: "video_block",
      config: {}
    });
    expect(result.valid).toBe(false);
  });

  test("rejects endsAt before startsAt", () => {
    const result = validateCreateHomepageSectionInput({
      sectionKey: "front-page",
      sectionType: "latest_posts",
      config: {},
      startsAt: "2026-02-01T00:00:00.000Z",
      endsAt: "2026-01-01T00:00:00.000Z"
    });
    expect(result.valid).toBe(false);
  });

  test("rejects config that doesn't match the declared sectionType's shape", () => {
    const result = validateCreateHomepageSectionInput({
      sectionKey: "front-page",
      sectionType: "gallery_block",
      config: { postId: VALID_ID }
    });
    expect(result.valid).toBe(false);
  });
});

describe("validateUpdateHomepageSectionInput (Issue #637)", () => {
  test("allows a partial update touching only isEnabled", () => {
    const result = validateUpdateHomepageSectionInput(
      { isEnabled: false },
      "headline"
    );
    expect(result).toEqual({ valid: true, value: { isEnabled: false } });
  });

  test("validates config against the CURRENT sectionType, not a client-supplied one", () => {
    const result = validateUpdateHomepageSectionInput(
      { config: { mediaObjectIds: [VALID_ID] } },
      "gallery_block"
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.config).toEqual({
        mediaObjectIds: [VALID_ID],
        caption: null
      });
    }
  });

  test("rejects an attempt to change sectionType", () => {
    const result = validateUpdateHomepageSectionInput(
      { sectionType: "gallery_block" },
      "headline"
    );
    expect(result.valid).toBe(false);
  });

  test("rejects config that doesn't match the current sectionType's shape", () => {
    const result = validateUpdateHomepageSectionInput(
      { config: { postId: VALID_ID } },
      "gallery_block"
    );
    expect(result.valid).toBe(false);
  });
});
