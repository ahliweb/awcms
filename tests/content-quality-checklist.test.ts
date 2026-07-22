/**
 * Unit tests for the pure content quality checklist evaluator (Issue #640,
 * epic `news_portal`). No database/port involved — `evaluateContentQuality
 * Checklist` takes already-resolved inputs (the DB/port round trip is
 * `content-quality-checklist-gate.ts`'s job, covered separately).
 */
import { describe, expect, test } from "bun:test";

import {
  evaluateContentQualityChecklist,
  notApplicableChecklistResult,
  SECURITY_RULE_IDS,
  OVERRIDABLE_RULE_IDS,
  isOverridableChecklistRuleId,
  isValidChecklistSeverity,
  type ContentQualityChecklistInput
} from "../src/modules/blog-content/domain/content-quality-checklist";

const NOW = new Date("2026-07-11T00:00:00.000Z");

function baseInput(
  overrides: Partial<ContentQualityChecklistInput> = {}
): ContentQualityChecklistInput {
  return {
    contentKind: "post",
    title: "Hello world",
    slug: "hello-world",
    excerpt: "An excerpt",
    metaDescription: "A meta description",
    contentText: "Body text",
    contentJson: { blocks: [{ type: "paragraph", text: "Body text" }] },
    featuredMediaId: null,
    featuredMedia: null,
    galleryViolations: [],
    unsafeGalleryMediaObjectIds: [],
    termCount: 1,
    scheduledAt: null,
    now: NOW,
    socialPreviewImage: null,
    ...overrides
  };
}

describe("evaluateContentQualityChecklist (Issue #640)", () => {
  test("a fully clean post with a verified featured image and gallery passes everything", () => {
    const result = evaluateContentQualityChecklist(
      baseInput({
        featuredMediaId: "11111111-1111-1111-1111-111111111111",
        featuredMedia: {
          altText: "A description",
          width: 1200,
          height: 630,
          mimeType: "image/jpeg",
          sizeBytes: 123_456
        },
        // Issue #649 — in a real gate call, this mirrors whichever image
        // the priority chain picked; here it resolves to the same featured
        // image (with alt text), so the social preview rules also pass.
        socialPreviewImage: { altText: "A description" }
      })
    );

    expect(result.applicable).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  test("missing title/slug/excerpt/meta description/taxonomy/featured image all report but do not block (except title/slug, which cannot actually occur since they're mandatory elsewhere)", () => {
    const result = evaluateContentQualityChecklist(
      baseInput({ excerpt: null, metaDescription: null, termCount: 0 })
    );

    expect(result.passed).toBe(true);
    const warningRuleIds = result.warnings.map((w) => w.ruleId);
    expect(warningRuleIds).toContain("excerpt_present");
    expect(warningRuleIds).toContain("meta_description_present");
    expect(warningRuleIds).toContain("taxonomy_exists");
    expect(warningRuleIds).toContain("featured_image_exists");
  });

  test("taxonomy_exists is never applicable for pages", () => {
    const result = evaluateContentQualityChecklist(
      baseInput({ contentKind: "page", termCount: 0 })
    );

    const taxonomyRule = result.rules.find(
      (r) => r.ruleId === "taxonomy_exists"
    );
    expect(taxonomyRule?.applicable).toBe(false);
    expect(taxonomyRule?.passed).toBe(true);
  });

  test("unsafe HTML in contentText blocks publish", () => {
    const result = evaluateContentQualityChecklist(
      baseInput({ contentText: "<script>alert(1)</script>" })
    );

    expect(result.passed).toBe(false);
    expect(result.blockers.map((b) => b.ruleId)).toContain(
      "unsafe_html_rejected"
    );
  });

  test("unsafe HTML in contentJson blocks publish", () => {
    const result = evaluateContentQualityChecklist(
      baseInput({
        contentJson: {
          blocks: [{ type: "paragraph", text: '<img onerror="alert(1)">' }]
        }
      })
    );

    expect(result.passed).toBe(false);
    expect(result.blockers.map((b) => b.ruleId)).toContain(
      "unsafe_html_rejected"
    );
  });

  test("featured image present but unresolved (unverified/cross-tenant/nonexistent) blocks publish", () => {
    const result = evaluateContentQualityChecklist(
      baseInput({
        featuredMediaId: "11111111-1111-1111-1111-111111111111",
        featuredMedia: null
      })
    );

    expect(result.passed).toBe(false);
    expect(result.blockers.map((b) => b.ruleId)).toContain(
      "featured_image_verified_r2"
    );
    // Downstream rules that need resolved metadata are not applicable, not silently passing as if checked.
    const altRule = result.rules.find(
      (r) => r.ruleId === "featured_image_alt_text"
    );
    expect(altRule?.applicable).toBe(false);
  });

  test("no featured image at all is not blocking by default (only a warning)", () => {
    const result = evaluateContentQualityChecklist(baseInput());
    expect(result.passed).toBe(true);
    expect(result.warnings.map((w) => w.ruleId)).toContain(
      "featured_image_exists"
    );
  });

  test("featured image missing alt text/dimensions is a warning by default, not blocking", () => {
    const result = evaluateContentQualityChecklist(
      baseInput({
        featuredMediaId: "11111111-1111-1111-1111-111111111111",
        featuredMedia: {
          altText: null,
          width: null,
          height: null,
          mimeType: "image/png",
          sizeBytes: 100
        }
      })
    );

    expect(result.passed).toBe(true);
    const warningIds = result.warnings.map((w) => w.ruleId);
    expect(warningIds).toContain("featured_image_alt_text");
    expect(warningIds).toContain("featured_image_dimensions");
  });

  test("tenant policy can escalate featured_image_alt_text to blocking", () => {
    const result = evaluateContentQualityChecklist(
      baseInput({
        featuredMediaId: "11111111-1111-1111-1111-111111111111",
        featuredMedia: {
          altText: null,
          width: 100,
          height: 100,
          mimeType: "image/png",
          sizeBytes: 100
        }
      }),
      { featured_image_alt_text: "blocking" }
    );

    expect(result.passed).toBe(false);
    expect(result.blockers.map((b) => b.ruleId)).toContain(
      "featured_image_alt_text"
    );
  });

  test("tenant policy CANNOT downgrade a security rule id (unsafe_html_rejected) — override is ignored", () => {
    const result = evaluateContentQualityChecklist(
      baseInput({ contentText: "<script>alert(1)</script>" }),
      // Cast bypasses the TS type restriction to prove the runtime guard
      // itself (not just the type system) refuses to honor this.
      { unsafe_html_rejected: "info" } as never
    );

    expect(result.passed).toBe(false);
    const rule = result.rules.find((r) => r.ruleId === "unsafe_html_rejected");
    expect(rule?.severity).toBe("blocking");
  });

  test("a gallery item with a local raw path is blocked via no_local_image_path", () => {
    const result = evaluateContentQualityChecklist(
      baseInput({
        galleryViolations: [
          {
            itemIndex: 0,
            reason: "raw_url_not_allowed",
            rawUrl: "/uploads/photo.jpg"
          }
        ]
      })
    );

    expect(result.passed).toBe(false);
    expect(result.blockers.map((b) => b.ruleId)).toContain(
      "no_local_image_path"
    );
    expect(result.blockers.map((b) => b.ruleId)).not.toContain(
      "no_external_image_url"
    );
  });

  test("a gallery item with an arbitrary external URL is blocked via no_external_image_url", () => {
    const result = evaluateContentQualityChecklist(
      baseInput({
        galleryViolations: [
          {
            itemIndex: 0,
            reason: "raw_url_not_allowed",
            rawUrl: "https://example.com/photo.jpg"
          }
        ]
      })
    );

    expect(result.passed).toBe(false);
    expect(result.blockers.map((b) => b.ruleId)).toContain(
      "no_external_image_url"
    );
    expect(result.blockers.map((b) => b.ruleId)).not.toContain(
      "no_local_image_path"
    );
  });

  test("a gallery item with a malformed/missing mediaObjectId blocks via gallery_images_verified", () => {
    const result = evaluateContentQualityChecklist(
      baseInput({
        galleryViolations: [
          { itemIndex: 0, reason: "media_object_id_missing_or_malformed" }
        ]
      })
    );

    expect(result.passed).toBe(false);
    expect(result.blockers.map((b) => b.ruleId)).toContain(
      "gallery_images_verified"
    );
  });

  test("a well-formed gallery mediaObjectId that failed to resolve safely blocks via gallery_images_verified", () => {
    const result = evaluateContentQualityChecklist(
      baseInput({
        unsafeGalleryMediaObjectIds: ["11111111-1111-1111-1111-111111111111"]
      })
    );

    expect(result.passed).toBe(false);
    expect(result.blockers.map((b) => b.ruleId)).toContain(
      "gallery_images_verified"
    );
  });

  test("scheduled_publish_time_valid is not applicable outside a scheduling request", () => {
    const result = evaluateContentQualityChecklist(baseInput());
    const rule = result.rules.find(
      (r) => r.ruleId === "scheduled_publish_time_valid"
    );
    expect(rule?.applicable).toBe(false);
  });

  test("scheduled_publish_time_valid blocks a scheduledAt that is not in the future", () => {
    const result = evaluateContentQualityChecklist(
      baseInput({ scheduledAt: new Date(NOW.getTime() - 1000) })
    );

    expect(result.passed).toBe(false);
    expect(result.blockers.map((b) => b.ruleId)).toContain(
      "scheduled_publish_time_valid"
    );
  });

  test("scheduled_publish_time_valid passes a future scheduledAt", () => {
    const result = evaluateContentQualityChecklist(
      baseInput({ scheduledAt: new Date(NOW.getTime() + 1000) })
    );

    const rule = result.rules.find(
      (r) => r.ruleId === "scheduled_publish_time_valid"
    );
    expect(rule?.applicable).toBe(true);
    expect(rule?.passed).toBe(true);
  });

  describe("social_preview_image_ready / social_preview_image_alt_text (Issue #649)", () => {
    test("warns (does not block) when no social preview image resolved from any source", () => {
      const result = evaluateContentQualityChecklist(
        baseInput({ socialPreviewImage: null })
      );

      expect(result.passed).toBe(true);
      expect(result.warnings.map((w) => w.ruleId)).toContain(
        "social_preview_image_ready"
      );
      const altRule = result.rules.find(
        (r) => r.ruleId === "social_preview_image_alt_text"
      );
      expect(altRule?.applicable).toBe(false);
      expect(altRule?.passed).toBe(true);
    });

    test("passes social_preview_image_ready and warns on missing alt text when an image resolved without alt text", () => {
      const result = evaluateContentQualityChecklist(
        baseInput({ socialPreviewImage: { altText: null } })
      );

      const readyRule = result.rules.find(
        (r) => r.ruleId === "social_preview_image_ready"
      );
      expect(readyRule?.passed).toBe(true);
      expect(result.warnings.map((w) => w.ruleId)).toContain(
        "social_preview_image_alt_text"
      );
    });

    test("passes both rules when an image with alt text resolved", () => {
      const result = evaluateContentQualityChecklist(
        baseInput({ socialPreviewImage: { altText: "A description" } })
      );

      expect(
        result.rules.find((r) => r.ruleId === "social_preview_image_ready")
          ?.passed
      ).toBe(true);
      expect(
        result.rules.find((r) => r.ruleId === "social_preview_image_alt_text")
          ?.passed
      ).toBe(true);
      expect(result.warnings.map((w) => w.ruleId)).not.toContain(
        "social_preview_image_ready"
      );
      expect(result.warnings.map((w) => w.ruleId)).not.toContain(
        "social_preview_image_alt_text"
      );
    });

    test("both rules are overridable (not security blockers)", () => {
      expect(OVERRIDABLE_RULE_IDS).toContain("social_preview_image_ready");
      expect(OVERRIDABLE_RULE_IDS).toContain("social_preview_image_alt_text");
      expect(SECURITY_RULE_IDS).not.toContain("social_preview_image_ready");
      expect(SECURITY_RULE_IDS).not.toContain("social_preview_image_alt_text");
    });

    test("tenant policy override can downgrade social_preview_image_ready to info", () => {
      const result = evaluateContentQualityChecklist(
        baseInput({ socialPreviewImage: null }),
        { social_preview_image_ready: "info" }
      );

      expect(
        result.rules.find((r) => r.ruleId === "social_preview_image_ready")
          ?.severity
      ).toBe("info");
      expect(result.warnings.map((w) => w.ruleId)).not.toContain(
        "social_preview_image_ready"
      );
      expect(result.info.map((i) => i.ruleId)).toContain(
        "social_preview_image_ready"
      );
    });
  });
});

describe("notApplicableChecklistResult (Issue #640)", () => {
  test("returns an all-empty, passed, non-applicable result", () => {
    const result = notApplicableChecklistResult();
    expect(result).toEqual({
      applicable: false,
      passed: true,
      rules: [],
      blockers: [],
      warnings: [],
      info: []
    });
  });
});

describe("SECURITY_RULE_IDS / OVERRIDABLE_RULE_IDS never overlap (Issue #640)", () => {
  test("no rule id appears in both lists", () => {
    const overlap = SECURITY_RULE_IDS.filter((id) =>
      (OVERRIDABLE_RULE_IDS as readonly string[]).includes(id)
    );
    expect(overlap).toEqual([]);
  });
});

describe("isOverridableChecklistRuleId / isValidChecklistSeverity (Issue #640)", () => {
  test("accepts every declared overridable rule id, rejects a security rule id", () => {
    for (const ruleId of OVERRIDABLE_RULE_IDS) {
      expect(isOverridableChecklistRuleId(ruleId)).toBe(true);
    }
    for (const ruleId of SECURITY_RULE_IDS) {
      expect(isOverridableChecklistRuleId(ruleId)).toBe(false);
    }
    expect(isOverridableChecklistRuleId("not_a_real_rule")).toBe(false);
  });

  test("accepts blocking/warning/info, rejects anything else", () => {
    expect(isValidChecklistSeverity("blocking")).toBe(true);
    expect(isValidChecklistSeverity("warning")).toBe(true);
    expect(isValidChecklistSeverity("info")).toBe(true);
    expect(isValidChecklistSeverity("critical")).toBe(false);
    expect(isValidChecklistSeverity(undefined)).toBe(false);
  });
});
