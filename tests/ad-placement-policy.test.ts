import { describe, expect, test } from "bun:test";

import {
  AD_PLACEMENT_KEYS,
  AD_PLACEMENT_PRESETS,
  AD_ROTATION_MODES,
  AD_TARGET_TYPES,
  isAdPlacementKey,
  isAdRotationMode,
  isAdTargetType,
  isSafeAdLinkUrl,
  validateCreateAdPlacementInput,
  validateUpdateAdPlacementInput
} from "../src/modules/blog-content/domain/ad-placement-policy";

const VALID_MEDIA_ID = "11111111-1111-1111-1111-111111111111";

describe("isAdPlacementKey (Issue #638)", () => {
  test("accepts every declared placement key from the issue body", () => {
    expect(AD_PLACEMENT_KEYS).toEqual([
      "header_banner",
      "below_headline",
      "homepage_middle",
      "homepage_bottom",
      "article_top",
      "article_middle",
      "article_bottom",
      "sidebar_top",
      "sidebar_middle",
      "sidebar_bottom",
      "category_archive_top",
      "search_result_top"
    ]);

    for (const key of AD_PLACEMENT_KEYS) {
      expect(isAdPlacementKey(key)).toBe(true);
    }
  });

  test("rejects unknown values", () => {
    for (const value of ["ad_slot", "not_a_placement", 123, null, undefined]) {
      expect(isAdPlacementKey(value)).toBe(false);
    }
  });
});

describe("AD_PLACEMENT_PRESETS (Issue #638)", () => {
  test("every declared placement key has a preset with recommendedSize/allowedMediaTypes/maxItems", () => {
    for (const key of AD_PLACEMENT_KEYS) {
      const preset = AD_PLACEMENT_PRESETS[key];
      expect(preset.recommendedSize.length).toBeGreaterThan(0);
      expect(preset.allowedMediaTypes.length).toBeGreaterThan(0);
      expect(preset.maxItems).toBeGreaterThan(0);
      // SVG is never an allowed media type by default (Keputusan kunci #5).
      expect(preset.allowedMediaTypes).not.toContain("image/svg+xml");
    }
  });
});

describe("isAdRotationMode (Issue #638)", () => {
  test("accepts every declared rotation mode from the issue body", () => {
    expect(AD_ROTATION_MODES).toEqual([
      "latest",
      "priority",
      "random_safe",
      "weighted"
    ]);
    for (const mode of AD_ROTATION_MODES) {
      expect(isAdRotationMode(mode)).toBe(true);
    }
  });

  test("rejects unknown values", () => {
    for (const value of ["random", "fifo", 1, null]) {
      expect(isAdRotationMode(value)).toBe(false);
    }
  });
});

describe("isSafeAdLinkUrl (Issue #638)", () => {
  test("accepts absolute http/https URLs", () => {
    expect(isSafeAdLinkUrl("https://example.com/promo")).toBe(true);
    expect(isSafeAdLinkUrl("http://example.com")).toBe(true);
  });

  test("rejects javascript:/data:/relative/malformed URLs (XSS/scheme-confusion guard)", () => {
    expect(isSafeAdLinkUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeAdLinkUrl("data:text/html,<script>alert(1)</script>")).toBe(
      false
    );
    expect(isSafeAdLinkUrl("/relative/path")).toBe(false);
    expect(isSafeAdLinkUrl("not a url")).toBe(false);
    expect(isSafeAdLinkUrl("ftp://example.com/file")).toBe(false);
  });
});

describe("validateCreateAdPlacementInput (Issue #638)", () => {
  test("accepts a minimal valid input and applies defaults", () => {
    const result = validateCreateAdPlacementInput({
      placementKey: "header_banner",
      name: "Spring Sale",
      mediaObjectId: VALID_MEDIA_ID
    });

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value).toEqual({
      placementKey: "header_banner",
      name: "Spring Sale",
      mediaObjectId: VALID_MEDIA_ID,
      linkUrl: null,
      rotationMode: "latest",
      priority: 0,
      isActive: true,
      startsAt: null,
      endsAt: null,
      // ADR-0044 §4: an ad with no stated target is site-wide, which is also
      // what every row written before migration 078 means.
      targetType: "global",
      targetId: null
    });
  });

  test("rejects missing placementKey/name/mediaObjectId", () => {
    const result = validateCreateAdPlacementInput({});
    expect(result.valid).toBe(false);
    if (result.valid) return;
    const fields = result.errors.map((e) => e.field);
    expect(fields).toContain("placementKey");
    expect(fields).toContain("name");
    expect(fields).toContain("mediaObjectId");
  });

  test("rejects a name longer than 200 characters (security-auditor Low finding, PR #727)", () => {
    const result = validateCreateAdPlacementInput({
      placementKey: "header_banner",
      name: "x".repeat(201),
      mediaObjectId: VALID_MEDIA_ID
    });
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors.some((e) => e.field === "name")).toBe(true);
  });

  test("accepts a name exactly 200 characters", () => {
    const result = validateCreateAdPlacementInput({
      placementKey: "header_banner",
      name: "x".repeat(200),
      mediaObjectId: VALID_MEDIA_ID
    });
    expect(result.valid).toBe(true);
  });

  test("rejects a local path or arbitrary shape for mediaObjectId (must be a UUID)", () => {
    const result = validateCreateAdPlacementInput({
      placementKey: "header_banner",
      name: "Spring Sale",
      mediaObjectId: "/uploads/banner.jpg"
    });
    expect(result.valid).toBe(false);
  });

  test("rejects an unsafe linkUrl", () => {
    const result = validateCreateAdPlacementInput({
      placementKey: "header_banner",
      name: "Spring Sale",
      mediaObjectId: VALID_MEDIA_ID,
      linkUrl: "javascript:alert(1)"
    });
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors.map((e) => e.field)).toContain("linkUrl");
  });

  test("accepts a safe external linkUrl", () => {
    const result = validateCreateAdPlacementInput({
      placementKey: "header_banner",
      name: "Spring Sale",
      mediaObjectId: VALID_MEDIA_ID,
      linkUrl: "https://advertiser.example.com/landing"
    });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value.linkUrl).toBe("https://advertiser.example.com/landing");
  });

  test("rejects an unknown rotationMode", () => {
    const result = validateCreateAdPlacementInput({
      placementKey: "header_banner",
      name: "Spring Sale",
      mediaObjectId: VALID_MEDIA_ID,
      rotationMode: "round_robin"
    });
    expect(result.valid).toBe(false);
  });

  test("rejects a negative priority", () => {
    const result = validateCreateAdPlacementInput({
      placementKey: "header_banner",
      name: "Spring Sale",
      mediaObjectId: VALID_MEDIA_ID,
      priority: -1
    });
    expect(result.valid).toBe(false);
  });

  test("rejects endsAt <= startsAt", () => {
    const result = validateCreateAdPlacementInput({
      placementKey: "header_banner",
      name: "Spring Sale",
      mediaObjectId: VALID_MEDIA_ID,
      startsAt: "2026-02-01T00:00:00.000Z",
      endsAt: "2026-01-01T00:00:00.000Z"
    });
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors.map((e) => e.field)).toContain("endsAt");
  });

  test("accepts a valid schedule window", () => {
    const result = validateCreateAdPlacementInput({
      placementKey: "header_banner",
      name: "Spring Sale",
      mediaObjectId: VALID_MEDIA_ID,
      startsAt: "2026-01-01T00:00:00.000Z",
      endsAt: "2026-02-01T00:00:00.000Z"
    });
    expect(result.valid).toBe(true);
  });
});

describe("validateUpdateAdPlacementInput (Issue #638)", () => {
  test("allows placementKey to change (every preset shares the same row shape)", () => {
    const result = validateUpdateAdPlacementInput({
      placementKey: "sidebar_middle"
    });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value.placementKey).toBe("sidebar_middle");
  });

  test("allows clearing linkUrl to null", () => {
    const result = validateUpdateAdPlacementInput({ linkUrl: null });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value.linkUrl).toBeNull();
  });

  test("empty body is valid (no-op update)", () => {
    const result = validateUpdateAdPlacementInput({});
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value).toEqual({});
  });

  test("rejects an unsafe linkUrl on update", () => {
    const result = validateUpdateAdPlacementInput({
      linkUrl: "javascript:alert(1)"
    });
    expect(result.valid).toBe(false);
  });
});

/**
 * Targeting (ADR-0044 §4, migration 078). The whole point of these columns is
 * that dropping `awcms_blog_ads` must not silently destroy per-post and
 * per-page ad targeting, so the first test here is the equivalence claim: the
 * vocabulary the retired system could express is exactly the vocabulary this
 * one accepts. If a future edit narrows it, that test fails and the drop stops
 * being safe.
 */
describe("ad placement targeting (ADR-0044 §4)", () => {
  const VALID_TARGET_ID = "22222222-2222-2222-2222-222222222222";

  function createWith(extra: Record<string, unknown>) {
    return validateCreateAdPlacementInput({
      placementKey: "sidebar_top",
      name: "Sidebar promo",
      mediaObjectId: VALID_MEDIA_ID,
      ...extra
    });
  }

  test("accepts exactly the target vocabulary the retired free-URL system had", () => {
    expect(AD_TARGET_TYPES).toEqual(["global", "widget", "post", "page"]);

    for (const targetType of AD_TARGET_TYPES) {
      expect(isAdTargetType(targetType)).toBe(true);
    }

    expect(isAdTargetType("category")).toBe(false);
    expect(isAdTargetType("")).toBe(false);
    expect(isAdTargetType(undefined)).toBe(false);
  });

  test("a scoped target carries its id through", () => {
    for (const targetType of ["widget", "post", "page"] as const) {
      const result = createWith({ targetType, targetId: VALID_TARGET_ID });

      expect(result.valid).toBe(true);
      if (!result.valid) return;
      expect(result.value.targetType).toBe(targetType);
      expect(result.value.targetId).toBe(VALID_TARGET_ID);
    }
  });

  test("a scoped target without an id is rejected, not silently made global", () => {
    const result = createWith({ targetType: "post" });

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors.map((error) => error.field)).toContain("targetId");
  });

  test("a global target carrying an id is rejected", () => {
    const result = createWith({
      targetType: "global",
      targetId: VALID_TARGET_ID
    });

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors.map((error) => error.field)).toContain("targetId");
  });

  test("an unknown target type is rejected", () => {
    const result = createWith({ targetType: "category" });

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors.map((error) => error.field)).toContain("targetType");
  });

  test("PATCH moves the target as a pair — an id alone names no type", () => {
    const result = validateUpdateAdPlacementInput({
      targetId: VALID_TARGET_ID
    });

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors.map((error) => error.field)).toContain("targetType");
  });

  test("PATCH to global clears the id, so the stored target cannot survive", () => {
    const result = validateUpdateAdPlacementInput({ targetType: "global" });

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value.targetType).toBe("global");
    // Present and null, NOT absent: `updateAdPlacement` gates the `target_id`
    // write on `targetType`, and a row left as `global` with a stale id
    // violates migration 078's pairing CHECK.
    expect("targetId" in result.value).toBe(true);
    expect(result.value.targetId).toBe(null);
  });

  test("PATCH that names no target at all leaves both fields untouched", () => {
    const result = validateUpdateAdPlacementInput({ name: "Renamed" });

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect("targetType" in result.value).toBe(false);
    expect("targetId" in result.value).toBe(false);
  });
});
