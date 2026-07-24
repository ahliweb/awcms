/**
 * Unit tests for `content-quality-checklist-gate.ts` (Issue #640) — the
 * application-layer orchestration between the pure evaluator and a
 * `MediaLibraryPort`. Uses a fake in-memory `MediaLibraryPort` (same technique
 * `news-media-port.ts`'s own header describes: any function taking a
 * `MediaLibraryPort` parameter can be unit-tested without a real database by
 * injecting a fake), so no DATABASE_URL/Postgres is needed — `tx` is never
 * actually dereferenced by the fake, only forwarded.
 */
import { describe, expect, test } from "bun:test";

import { evaluateContentQualityChecklistForContent } from "../src/modules/blog-content/application/content-quality-checklist-gate";
import type {
  MediaLibraryPort,
  ResolvedMediaReferenceDTO
} from "../src/modules/_shared/ports/media-library-port";

const FEATURED_ID = "11111111-1111-1111-1111-111111111111";
const GALLERY_ID = "22222222-2222-2222-2222-222222222222";

function fakePort(options: {
  modeActive: boolean;
  resolvable?: Record<string, ResolvedMediaReferenceDTO>;
}): MediaLibraryPort {
  const resolvable = options.resolvable ?? {};

  return {
    async isManagedMediaEnforcementActiveForTenant() {
      return options.modeActive;
    },
    async isMediaReferenceSafe(_tx, _tenantId, mediaObjectId) {
      return mediaObjectId in resolvable;
    },
    async resolveMediaReferences(_tx, _tenantId, mediaObjectIds) {
      const map = new Map<string, ResolvedMediaReferenceDTO>();
      for (const id of mediaObjectIds) {
        if (resolvable[id]) {
          map.set(id, resolvable[id]);
        }
      }
      return map;
    }
  };
}

const FAKE_TX = {} as Bun.SQL;

const BASE_CONTENT = {
  title: "Hello",
  slug: "hello",
  excerpt: "Excerpt",
  metaDescription: "Meta description",
  contentText: "Body",
  contentJson: { blocks: [{ type: "paragraph", text: "Body" }] },
  featuredMediaId: null as string | null
};

describe("evaluateContentQualityChecklistForContent (Issue #640)", () => {
  test("returns a non-applicable result when full-online R2-only mode is not active for the tenant", async () => {
    const result = await evaluateContentQualityChecklistForContent(
      FAKE_TX,
      "tenant-a",
      "post",
      BASE_CONTENT,
      0,
      fakePort({ modeActive: false }),
      {}
    );

    expect(result.applicable).toBe(false);
    expect(result.passed).toBe(true);
  });

  test("resolves featuredMediaId through the port and passes when verified", async () => {
    const result = await evaluateContentQualityChecklistForContent(
      FAKE_TX,
      "tenant-a",
      "post",
      { ...BASE_CONTENT, featuredMediaId: FEATURED_ID },
      1,
      fakePort({
        modeActive: true,
        resolvable: {
          [FEATURED_ID]: {
            publicUrl: "https://media.example.test/x.jpg",
            altText: "Alt",
            mimeType: "image/jpeg",
            width: 800,
            height: 600,
            sizeBytes: 1000
          }
        }
      }),
      {}
    );

    expect(result.applicable).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  test("blocks when featuredMediaId does not resolve (unverified/cross-tenant/nonexistent)", async () => {
    const result = await evaluateContentQualityChecklistForContent(
      FAKE_TX,
      "tenant-a",
      "post",
      { ...BASE_CONTENT, featuredMediaId: FEATURED_ID },
      1,
      fakePort({ modeActive: true, resolvable: {} }),
      {}
    );

    expect(result.passed).toBe(false);
    expect(result.blockers.map((b) => b.ruleId)).toContain(
      "featured_image_verified_r2"
    );
  });

  test("resolves gallery mediaObjectIds via the port and blocks the unresolved one", async () => {
    const result = await evaluateContentQualityChecklistForContent(
      FAKE_TX,
      "tenant-a",
      "post",
      {
        ...BASE_CONTENT,
        contentJson: {
          blocks: [
            {
              type: "gallery",
              items: [{ mediaType: "image", mediaObjectId: GALLERY_ID }]
            }
          ]
        }
      },
      1,
      fakePort({ modeActive: true, resolvable: {} }),
      {}
    );

    expect(result.passed).toBe(false);
    expect(result.blockers.map((b) => b.ruleId)).toContain(
      "gallery_images_verified"
    );
  });

  test("tenant policy override is applied through to the pure evaluator", async () => {
    const result = await evaluateContentQualityChecklistForContent(
      FAKE_TX,
      "tenant-a",
      "post",
      { ...BASE_CONTENT, excerpt: null },
      1,
      fakePort({ modeActive: true }),
      { excerpt_present: "blocking" }
    );

    expect(result.passed).toBe(false);
    expect(result.blockers.map((b) => b.ruleId)).toContain("excerpt_present");
  });

  describe("Issue #649 — social preview image priority chain reuse", () => {
    const SEO_IMAGE_ID = "33333333-3333-3333-3333-333333333333";
    const TENANT_FALLBACK_ID = "44444444-4444-4444-4444-444444444444";

    test("seoImageMediaId (explicit override) wins over featuredMediaId for the social_preview_image_* rules", async () => {
      const result = await evaluateContentQualityChecklistForContent(
        FAKE_TX,
        "tenant-a",
        "post",
        {
          ...BASE_CONTENT,
          featuredMediaId: FEATURED_ID,
          seoImageMediaId: SEO_IMAGE_ID
        },
        1,
        fakePort({
          modeActive: true,
          resolvable: {
            [FEATURED_ID]: {
              publicUrl: "https://media.example.test/featured.jpg",
              altText: null,
              mimeType: "image/jpeg",
              width: 800,
              height: 600,
              sizeBytes: 1000
            },
            [SEO_IMAGE_ID]: {
              publicUrl: "https://media.example.test/seo.jpg",
              altText: "SEO alt text",
              mimeType: "image/jpeg",
              width: 1200,
              height: 630,
              sizeBytes: 2000
            }
          }
        }),
        {}
      );

      // The explicit SEO image resolved WITH alt text, so both rules pass —
      // if the featured image (no alt text) had won instead, the alt-text
      // rule would have warned.
      expect(
        result.rules.find((r) => r.ruleId === "social_preview_image_ready")
          ?.passed
      ).toBe(true);
      expect(
        result.rules.find((r) => r.ruleId === "social_preview_image_alt_text")
          ?.passed
      ).toBe(true);
    });

    test("tenant fallback image is used when nothing else resolves", async () => {
      const result = await evaluateContentQualityChecklistForContent(
        FAKE_TX,
        "tenant-a",
        "post",
        BASE_CONTENT,
        1,
        fakePort({
          modeActive: true,
          resolvable: {
            [TENANT_FALLBACK_ID]: {
              publicUrl: "https://media.example.test/fallback.jpg",
              altText: "Fallback alt",
              mimeType: "image/jpeg",
              width: 1200,
              height: 630,
              sizeBytes: 2000
            }
          }
        }),
        {},
        {
          socialPreviewFallback: {
            tenantFallbackImageMediaId: TENANT_FALLBACK_ID,
            contentImageFallbackEnabled: true
          }
        }
      );

      expect(
        result.rules.find((r) => r.ruleId === "social_preview_image_ready")
          ?.passed
      ).toBe(true);
    });

    test("no social preview image resolves when nothing is configured — warns, does not block", async () => {
      const result = await evaluateContentQualityChecklistForContent(
        FAKE_TX,
        "tenant-a",
        "post",
        BASE_CONTENT,
        1,
        fakePort({ modeActive: true, resolvable: {} }),
        {}
      );

      expect(result.passed).toBe(true);
      expect(result.warnings.map((w) => w.ruleId)).toContain(
        "social_preview_image_ready"
      );
    });
  });
});
