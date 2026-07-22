import { describe, expect, test } from "bun:test";

import { resolveSocialPreviewImageSourceId } from "../src/modules/blog-content/domain/social-preview-image-resolution";

const EXPLICIT = "11111111-1111-1111-1111-111111111111";
const FEATURED = "22222222-2222-2222-2222-222222222222";
const CONTENT_1 = "33333333-3333-3333-3333-333333333333";
const CONTENT_2 = "44444444-4444-4444-4444-444444444444";
const TENANT_FALLBACK = "55555555-5555-5555-5555-555555555555";

describe("resolveSocialPreviewImageSourceId (Issue #649)", () => {
  test("priority 1: explicit SEO image wins when all four sources resolve safely", () => {
    const resolved = new Set([EXPLICIT, FEATURED, CONTENT_1, TENANT_FALLBACK]);
    const result = resolveSocialPreviewImageSourceId(
      {
        explicitSocialImageMediaId: EXPLICIT,
        featuredMediaId: FEATURED,
        contentImageMediaIds: [CONTENT_1],
        tenantFallbackImageMediaId: TENANT_FALLBACK
      },
      resolved
    );
    expect(result).toBe(EXPLICIT);
  });

  test("priority 2: featured image wins when explicit SEO image is null", () => {
    const resolved = new Set([FEATURED, CONTENT_1, TENANT_FALLBACK]);
    const result = resolveSocialPreviewImageSourceId(
      {
        explicitSocialImageMediaId: null,
        featuredMediaId: FEATURED,
        contentImageMediaIds: [CONTENT_1],
        tenantFallbackImageMediaId: TENANT_FALLBACK
      },
      resolved
    );
    expect(result).toBe(FEATURED);
  });

  test("priority 3: first verified content image wins when explicit + featured are absent", () => {
    const resolved = new Set([CONTENT_1, CONTENT_2, TENANT_FALLBACK]);
    const result = resolveSocialPreviewImageSourceId(
      {
        explicitSocialImageMediaId: null,
        featuredMediaId: null,
        contentImageMediaIds: [CONTENT_1, CONTENT_2],
        tenantFallbackImageMediaId: TENANT_FALLBACK
      },
      resolved
    );
    expect(result).toBe(CONTENT_1);
  });

  test("priority 3 falls through to the SECOND content image when the first one did not resolve safely", () => {
    const resolved = new Set([CONTENT_2, TENANT_FALLBACK]);
    const result = resolveSocialPreviewImageSourceId(
      {
        explicitSocialImageMediaId: null,
        featuredMediaId: null,
        contentImageMediaIds: [CONTENT_1, CONTENT_2],
        tenantFallbackImageMediaId: TENANT_FALLBACK
      },
      resolved
    );
    expect(result).toBe(CONTENT_2);
  });

  test("priority 4: tenant fallback wins when nothing else resolves", () => {
    const resolved = new Set([TENANT_FALLBACK]);
    const result = resolveSocialPreviewImageSourceId(
      {
        explicitSocialImageMediaId: EXPLICIT,
        featuredMediaId: FEATURED,
        contentImageMediaIds: [CONTENT_1],
        tenantFallbackImageMediaId: TENANT_FALLBACK
      },
      resolved
    );
    expect(result).toBe(TENANT_FALLBACK);
  });

  test("null when NOTHING resolves safely, even though every candidate id is present", () => {
    const result = resolveSocialPreviewImageSourceId(
      {
        explicitSocialImageMediaId: EXPLICIT,
        featuredMediaId: FEATURED,
        contentImageMediaIds: [CONTENT_1],
        tenantFallbackImageMediaId: TENANT_FALLBACK
      },
      new Set()
    );
    expect(result).toBeNull();
  });

  test("null when every candidate is null/empty", () => {
    const result = resolveSocialPreviewImageSourceId(
      {
        explicitSocialImageMediaId: null,
        featuredMediaId: null,
        contentImageMediaIds: [],
        tenantFallbackImageMediaId: null
      },
      new Set(["irrelevant-id"])
    );
    expect(result).toBeNull();
  });

  test("an unsafe (unresolved) higher-priority candidate is skipped, not treated as a hard stop", () => {
    // explicit id is present but NOT in resolved set -> falls through to featured.
    const resolved = new Set([FEATURED]);
    const result = resolveSocialPreviewImageSourceId(
      {
        explicitSocialImageMediaId: EXPLICIT,
        featuredMediaId: FEATURED,
        contentImageMediaIds: [],
        tenantFallbackImageMediaId: null
      },
      resolved
    );
    expect(result).toBe(FEATURED);
  });
});
