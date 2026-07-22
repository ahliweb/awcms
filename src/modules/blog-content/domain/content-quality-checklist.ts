/**
 * Content quality checklist (Issue #640, epic `news_portal`) — pure rule
 * evaluation. Deliberately mirrors Issue #636's own mode-gating precedent
 * (`news-media-reference-gate.ts`): this ENTIRE checklist is a no-op
 * (`applicable: false`) unless full-online R2-only mode is genuinely active
 * for the calling tenant (checked by the caller, `content-quality-checklist-
 * gate.ts`, via `NewsMediaPort.isFullOnlineR2ModeActiveForTenant` — this
 * file never touches a database or the port itself, staying pure/testable
 * like every other `domain` file in this module). The overwhelming majority
 * of `blog_content`-only tenants (no news-portal R2-only preset applied) see
 * ZERO behavior change from this issue — publish/schedule works exactly as
 * before Issue #640. This is a deliberate scope decision (not an oversight):
 * forcing a NEW blocking editorial gate (missing meta description, missing
 * taxonomy, etc.) onto every generic `blog_content` tenant would be exactly
 * the "blanket tightening of a feature that's supposed to stay opt-in"
 * mistake this epic's skill repeatedly documents avoiding (see
 * `.claude/skills/awcms-news-portal/SKILL.md` §636 "Ketika mode TIDAK
 * aktif ... seluruh validasi baru ini adalah no-op").
 *
 * Rule catalog matches Issue #640's own "Scope" list. Five rules are
 * SECURITY blockers (`SECURITY_RULE_IDS` below) and can NEVER be downgraded
 * by tenant policy, in any environment — Issue #640's own "Security notes":
 * "Security blockers must not be downgraded by tenant policy in production."
 * This implementation is intentionally STRICTER than the letter of that
 * sentence: rather than branching on `APP_ENV` (which would mean a security
 * rule genuinely COULD be downgraded in a non-production environment, a
 * footgun for staging environments that mirror production data), overrides
 * for security rule ids are rejected unconditionally, everywhere. A stricter
 * global rule trivially satisfies a "not in production" minimum — see
 * `applyChecklistPolicyOverrides` below.
 *
 * Several rules that look independently checkable are, for a media object
 * that already reached `verified`/`attached` status, PROVABLY always true
 * by construction (Issue #634's finalize pipeline: MIME sniffing against a
 * fixed 4-type raster allow-list, and a hard byte cap during the capped
 * read) — `featured_image_mime_allowed`/`featured_image_size_within_policy`
 * below report the real recorded metadata rather than re-deriving R2
 * verification logic Issue #634 already owns; see their comments for the
 * precise reasoning. This checklist calls into the EXISTING verified-media
 * primitives (`collectGalleryImageReferences`,
 * `NewsMediaPort.resolveMediaReferences` via the application-layer gate)
 * rather than re-deriving them, per this issue's own instruction.
 */
import { isAbsoluteHttpUrl } from "./seo-validation";
import { containsUnsafeHtml } from "./content-validation";
import { isValidSlug } from "./slug-policy";
import type { GalleryImageReferenceViolation } from "./content-block-media-references";

export type ChecklistSeverity = "blocking" | "warning" | "info";

export type ChecklistRuleId =
  | "title_present"
  | "slug_valid"
  | "excerpt_present"
  | "meta_description_present"
  | "featured_image_exists"
  | "featured_image_verified_r2"
  | "featured_image_alt_text"
  | "featured_image_dimensions"
  | "featured_image_mime_allowed"
  | "featured_image_size_within_policy"
  | "og_image_trusted"
  | "no_local_image_path"
  | "no_external_image_url"
  | "gallery_images_verified"
  | "taxonomy_exists"
  | "unsafe_html_rejected"
  | "scheduled_publish_time_valid"
  | "social_preview_image_ready"
  | "social_preview_image_alt_text";

/**
 * Security blockers (Issue #640 "Suggested default blocking rules" +
 * "Security notes") — severity is ALWAYS `"blocking"`, never affected by
 * `ChecklistPolicyOverrides`, in any environment. `featured_image_verified_r2`
 * and `gallery_images_verified` also cover "cross-tenant media object
 * reference" (Issue #640's fifth suggested blocker) — `NewsMediaPort`'s
 * resolution already fails closed for a cross-tenant id, so there is no
 * separate rule id for it.
 */
export const SECURITY_RULE_IDS: readonly ChecklistRuleId[] = [
  "unsafe_html_rejected",
  "no_local_image_path",
  "no_external_image_url",
  "featured_image_verified_r2",
  "gallery_images_verified"
];

/**
 * Rules a tenant MAY reconfigure between `warning`/`blocking`/`info` via
 * `awcms_blog_settings.settings.contentQualityChecklistPolicy`
 * (`blog-settings-policy.ts`) — deliberately excludes every id in
 * `SECURITY_RULE_IDS` plus the structural ids (`title_present`/`slug_valid`/
 * `scheduled_publish_time_valid`) that are already enforced elsewhere
 * (write-time validation) and cannot meaningfully be "relaxed" by this
 * checklist. `featured_image_mime_allowed`/`featured_image_size_within_policy`
 * are also excluded — see their rule comments below for why overriding them
 * would not change anything real.
 */
export const OVERRIDABLE_RULE_IDS: readonly ChecklistRuleId[] = [
  "excerpt_present",
  "meta_description_present",
  "featured_image_exists",
  "featured_image_alt_text",
  "featured_image_dimensions",
  "og_image_trusted",
  "taxonomy_exists",
  "social_preview_image_ready",
  "social_preview_image_alt_text"
];

export type OverridableChecklistRuleId = (typeof OVERRIDABLE_RULE_IDS)[number];

export type ChecklistPolicyOverrides = Partial<
  Record<OverridableChecklistRuleId, ChecklistSeverity>
>;

export type ChecklistRuleOutcome = {
  ruleId: ChecklistRuleId;
  severity: ChecklistSeverity;
  /** `false` only when `applicable` is also `true` — a non-applicable rule is always reported as passed. */
  passed: boolean;
  /** `false` when the rule was skipped (mode inactive for the whole checklist, or the underlying data this rule needs — e.g. a featured image — isn't present). */
  applicable: boolean;
  message: string;
};

export type ContentQualityChecklistResult = {
  /** `false` only when full-online R2-only mode isn't active for the tenant — the whole checklist is then a no-op, `rules`/`blockers`/`warnings`/`info` are all empty, and `passed` is `true`. */
  applicable: boolean;
  /** `true` unless at least one applicable rule with severity `"blocking"` failed. */
  passed: boolean;
  rules: ChecklistRuleOutcome[];
  blockers: ChecklistRuleOutcome[];
  warnings: ChecklistRuleOutcome[];
  info: ChecklistRuleOutcome[];
};

const NOT_APPLICABLE: ContentQualityChecklistResult = {
  applicable: false,
  passed: true,
  rules: [],
  blockers: [],
  warnings: [],
  info: []
};

export function notApplicableChecklistResult(): ContentQualityChecklistResult {
  return NOT_APPLICABLE;
}

export type ResolvedFeaturedMediaForChecklist = {
  altText: string | null;
  width: number | null;
  height: number | null;
  mimeType: string;
  sizeBytes: number | null;
};

/**
 * Issue #649 — the winning social/SEO preview image, ALREADY resolved by
 * the caller through the exact same priority chain the render route uses
 * (`social-preview-image-resolution.ts`'s `resolveSocialPreviewImageSourceId`,
 * via `content-quality-checklist-gate.ts`). This may be a DIFFERENT media
 * object than `featuredMedia` above (an explicit SEO image override, a
 * content-embedded image, or the tenant fallback) — only `altText` is
 * needed here (existence alone is `social_preview_image_ready`; alt text is
 * the separate `social_preview_image_alt_text` rule). `null` means no
 * source in the priority chain resolved to a safe R2 object at all.
 */
export type ResolvedSocialPreviewImageForChecklist = {
  altText: string | null;
};

/**
 * Which "kind" of content this checklist runs for — `"page"` has no
 * taxonomy assignment table at all (`awcms_blog_pages` has no
 * `_terms` junction, unlike posts' `awcms_blog_post_terms`), so
 * `taxonomy_exists` is never applicable for a page.
 */
export type ChecklistContentKind = "post" | "page";

export type ContentQualityChecklistInput = {
  contentKind: ChecklistContentKind;
  title: string;
  slug: string;
  excerpt: string | null;
  metaDescription: string | null;
  contentText: string;
  contentJson: Record<string, unknown>;
  featuredMediaId: string | null;
  /** `null` if unresolved (missing, cross-tenant, wrong status) — the caller (application layer) is the only place that can know this, via `NewsMediaPort`. */
  featuredMedia: ResolvedFeaturedMediaForChecklist | null;
  galleryViolations: readonly GalleryImageReferenceViolation[];
  /** Well-formed `mediaObjectId`s referenced by gallery image items that did NOT resolve safely (missing/cross-tenant/wrong status) — the ones that DID resolve need no rule (they already passed). */
  unsafeGalleryMediaObjectIds: readonly string[];
  termCount: number;
  /** Present (non-null) only when evaluated for the "schedule" action; `null` for an immediate publish or the scheduled-publish job's own re-check. */
  scheduledAt: Date | null;
  now: Date;
  /** Issue #649 — see `ResolvedSocialPreviewImageForChecklist`'s comment. `null` when no source in the priority chain resolved. */
  socialPreviewImage: ResolvedSocialPreviewImageForChecklist | null;
};

function classifyRawImageUrl(url: string): "local_path" | "external_url" {
  return isAbsoluteHttpUrl(url) ? "external_url" : "local_path";
}

function outcome(
  ruleId: ChecklistRuleId,
  severity: ChecklistSeverity,
  passed: boolean,
  applicable: boolean,
  message: string
): ChecklistRuleOutcome {
  return { ruleId, severity, passed, applicable, message };
}

/**
 * Applies `overrides` on top of `defaultSeverity`, refusing to touch any id
 * outside `OVERRIDABLE_RULE_IDS` — defense in depth on top of
 * `blog-settings-policy.ts` already rejecting an unknown/security key at
 * write time (this function would still fail closed even if that write-time
 * guard were ever removed or bypassed by a future direct DB write, same
 * "don't trust a single enforcement point" lesson as Issue #636's restore-
 * revision bypass).
 */
function resolveSeverity(
  ruleId: ChecklistRuleId,
  defaultSeverity: ChecklistSeverity,
  overrides: ChecklistPolicyOverrides
): ChecklistSeverity {
  if (!(OVERRIDABLE_RULE_IDS as readonly string[]).includes(ruleId)) {
    return defaultSeverity;
  }

  const override = overrides[ruleId as OverridableChecklistRuleId];
  return override ?? defaultSeverity;
}

export function evaluateContentQualityChecklist(
  input: ContentQualityChecklistInput,
  overrides: ChecklistPolicyOverrides = {}
): ContentQualityChecklistResult {
  const sev = (ruleId: ChecklistRuleId, defaultSeverity: ChecklistSeverity) =>
    resolveSeverity(ruleId, defaultSeverity, overrides);

  const rules: ChecklistRuleOutcome[] = [];

  // --- Structural rules (already enforced at write time; re-checked here for defense-in-depth completeness, never overridable) ---
  rules.push(
    outcome(
      "title_present",
      "blocking",
      input.title.trim().length > 0,
      true,
      input.title.trim().length > 0
        ? "Title is present."
        : "Title is required before publishing."
    )
  );

  rules.push(
    outcome(
      "slug_valid",
      "blocking",
      isValidSlug(input.slug),
      true,
      isValidSlug(input.slug)
        ? "Slug is valid."
        : "Slug must be lowercase alphanumeric segments separated by single hyphens."
    )
  );

  const unsafe =
    containsUnsafeHtml(input.contentText) ||
    containsUnsafeHtml(JSON.stringify(input.contentJson));
  rules.push(
    outcome(
      "unsafe_html_rejected",
      "blocking",
      !unsafe,
      true,
      unsafe
        ? "Content contains unsafe HTML/script/embed markup and must be removed before publishing."
        : "No unsafe HTML/script/embed markup detected."
    )
  );

  // --- Editorial/SEO rules (overridable, default warning) ---
  const hasExcerpt = (input.excerpt ?? "").trim().length > 0;
  rules.push(
    outcome(
      "excerpt_present",
      sev("excerpt_present", "warning"),
      hasExcerpt,
      true,
      hasExcerpt
        ? "Excerpt is present."
        : "Excerpt is missing — recommended for listings and social previews."
    )
  );

  const hasMetaDescription = (input.metaDescription ?? "").trim().length > 0;
  rules.push(
    outcome(
      "meta_description_present",
      sev("meta_description_present", "warning"),
      hasMetaDescription,
      true,
      hasMetaDescription
        ? "Meta description is present."
        : "Meta description is missing — recommended for SEO."
    )
  );

  if (input.contentKind === "post") {
    const hasTaxonomy = input.termCount > 0;
    rules.push(
      outcome(
        "taxonomy_exists",
        sev("taxonomy_exists", "warning"),
        hasTaxonomy,
        true,
        hasTaxonomy
          ? "At least one category/tag is assigned."
          : "No category/tag assigned — recommended for discoverability."
      )
    );
  } else {
    rules.push(
      outcome(
        "taxonomy_exists",
        sev("taxonomy_exists", "warning"),
        true,
        false,
        "Not applicable — pages have no category/tag taxonomy."
      )
    );
  }

  // --- Scheduled publish time ---
  if (input.scheduledAt) {
    const valid = input.scheduledAt.getTime() > input.now.getTime();
    rules.push(
      outcome(
        "scheduled_publish_time_valid",
        "blocking",
        valid,
        true,
        valid
          ? "Scheduled publish time is in the future."
          : "Scheduled publish time must be in the future."
      )
    );
  } else {
    rules.push(
      outcome(
        "scheduled_publish_time_valid",
        "blocking",
        true,
        false,
        "Not applicable — this is not a scheduling request."
      )
    );
  }

  // --- Featured image ---
  const hasFeaturedMediaId = input.featuredMediaId !== null;
  rules.push(
    outcome(
      "featured_image_exists",
      sev("featured_image_exists", "warning"),
      hasFeaturedMediaId,
      true,
      hasFeaturedMediaId
        ? "Featured image is set."
        : "No featured image is set."
    )
  );

  if (hasFeaturedMediaId) {
    const verified = input.featuredMedia !== null;
    rules.push(
      outcome(
        "featured_image_verified_r2",
        "blocking",
        verified,
        true,
        verified
          ? "Featured image references a verified R2 media object."
          : "Featured image does not reference an existing, same-tenant, verified R2 media object."
      )
    );

    if (verified) {
      const media = input.featuredMedia!;
      const hasAlt = (media.altText ?? "").trim().length > 0;
      rules.push(
        outcome(
          "featured_image_alt_text",
          sev("featured_image_alt_text", "warning"),
          hasAlt,
          true,
          hasAlt
            ? "Featured image has alt text."
            : "Featured image is missing alt text — recommended for accessibility/SEO."
        )
      );

      const hasDimensions = media.width !== null && media.height !== null;
      rules.push(
        outcome(
          "featured_image_dimensions",
          sev("featured_image_dimensions", "warning"),
          hasDimensions,
          true,
          hasDimensions
            ? `Featured image dimensions recorded (${media.width}x${media.height}).`
            : "Featured image width/height metadata is missing."
        )
      );

      // Not independently overridable: any object that reached
      // verified/attached status necessarily already passed MIME
      // sniffing against Issue #634's fixed raster allow-list at upload
      // time — this rule reports the recorded value rather than
      // re-deriving that verification.
      rules.push(
        outcome(
          "featured_image_mime_allowed",
          "info",
          true,
          true,
          `Featured image MIME type "${media.mimeType}" was verified at upload time.`
        )
      );

      const hasSize = media.sizeBytes !== null && media.sizeBytes > 0;
      rules.push(
        outcome(
          "featured_image_size_within_policy",
          "info",
          hasSize,
          true,
          hasSize
            ? `Featured image size recorded (${media.sizeBytes} bytes).`
            : "Featured image size metadata is missing."
        )
      );

      rules.push(
        outcome(
          "og_image_trusted",
          sev("og_image_trusted", "warning"),
          true,
          true,
          "og:image/twitter:image will use this verified R2 media object."
        )
      );
    } else {
      for (const ruleId of [
        "featured_image_alt_text",
        "featured_image_dimensions",
        "featured_image_mime_allowed",
        "featured_image_size_within_policy"
      ] as const) {
        rules.push(
          outcome(
            ruleId,
            ruleId === "featured_image_mime_allowed" ||
              ruleId === "featured_image_size_within_policy"
              ? "info"
              : sev(ruleId, "warning"),
            true,
            false,
            "Not applicable — featured image failed R2 verification."
          )
        );
      }

      rules.push(
        outcome(
          "og_image_trusted",
          sev("og_image_trusted", "warning"),
          false,
          true,
          "og:image/twitter:image cannot use an unverified featured image."
        )
      );
    }
  } else {
    for (const ruleId of [
      "featured_image_verified_r2",
      "featured_image_alt_text",
      "featured_image_dimensions",
      "featured_image_mime_allowed",
      "featured_image_size_within_policy",
      "og_image_trusted"
    ] as const) {
      rules.push(
        outcome(
          ruleId,
          ruleId === "featured_image_verified_r2"
            ? "blocking"
            : ruleId === "featured_image_mime_allowed" ||
                ruleId === "featured_image_size_within_policy"
              ? "info"
              : sev(ruleId, "warning"),
          true,
          false,
          "Not applicable — no featured image is set."
        )
      );
    }
  }

  // --- Gallery images: local path / external URL / unverified reference ---
  const localPathViolations = input.galleryViolations.filter(
    (violation) =>
      violation.reason === "raw_url_not_allowed" &&
      violation.rawUrl !== undefined &&
      classifyRawImageUrl(violation.rawUrl) === "local_path"
  );
  const externalUrlViolations = input.galleryViolations.filter(
    (violation) =>
      violation.reason === "raw_url_not_allowed" &&
      violation.rawUrl !== undefined &&
      classifyRawImageUrl(violation.rawUrl) === "external_url"
  );
  const malformedReferenceCount = input.galleryViolations.filter(
    (violation) => violation.reason === "media_object_id_missing_or_malformed"
  ).length;

  rules.push(
    outcome(
      "no_local_image_path",
      "blocking",
      localPathViolations.length === 0,
      true,
      localPathViolations.length === 0
        ? "No local image path found in content."
        : `${localPathViolations.length} gallery image item(s) use a local image path — not allowed in full-online R2-only mode.`
    )
  );

  rules.push(
    outcome(
      "no_external_image_url",
      "blocking",
      externalUrlViolations.length === 0,
      true,
      externalUrlViolations.length === 0
        ? "No arbitrary external image URL found in news image blocks."
        : `${externalUrlViolations.length} gallery image item(s) use an arbitrary external URL — not allowed in full-online R2-only mode.`
    )
  );

  const galleryVerifiedFailures =
    malformedReferenceCount + input.unsafeGalleryMediaObjectIds.length;
  rules.push(
    outcome(
      "gallery_images_verified",
      "blocking",
      galleryVerifiedFailures === 0,
      true,
      galleryVerifiedFailures === 0
        ? "All gallery images reference verified R2 media objects."
        : `${galleryVerifiedFailures} gallery image item(s) do not reference an existing, same-tenant, verified R2 media object.`
    )
  );

  // --- Social preview readiness (Issue #649) ---
  const hasSocialPreviewImage = input.socialPreviewImage !== null;
  rules.push(
    outcome(
      "social_preview_image_ready",
      sev("social_preview_image_ready", "warning"),
      hasSocialPreviewImage,
      true,
      hasSocialPreviewImage
        ? "A verified R2 image is available for social/SEO preview sharing."
        : "No verified R2 image is available for social/SEO preview sharing (explicit SEO image, featured image, content image, and tenant fallback all unresolved)."
    )
  );

  if (hasSocialPreviewImage) {
    const hasSocialPreviewAlt =
      (input.socialPreviewImage!.altText ?? "").trim().length > 0;
    rules.push(
      outcome(
        "social_preview_image_alt_text",
        sev("social_preview_image_alt_text", "warning"),
        hasSocialPreviewAlt,
        true,
        hasSocialPreviewAlt
          ? "Social/SEO preview image has alt text."
          : "Social/SEO preview image is missing alt text — recommended for accessibility/SEO."
      )
    );
  } else {
    rules.push(
      outcome(
        "social_preview_image_alt_text",
        sev("social_preview_image_alt_text", "warning"),
        true,
        false,
        "Not applicable — no social/SEO preview image is available."
      )
    );
  }

  const blockers = rules.filter(
    (rule) => rule.applicable && rule.severity === "blocking" && !rule.passed
  );
  const warnings = rules.filter(
    (rule) => rule.applicable && rule.severity === "warning" && !rule.passed
  );
  const info = rules.filter(
    (rule) => rule.applicable && rule.severity === "info" && !rule.passed
  );

  return {
    applicable: true,
    passed: blockers.length === 0,
    rules,
    blockers,
    warnings,
    info
  };
}

/**
 * Validates a tenant-supplied policy override map (used by
 * `blog-settings-policy.ts`) — every key must be in `OVERRIDABLE_RULE_IDS`
 * (rejects a security rule id or an unknown rule id outright, rather than
 * silently ignoring it, so a typo/attempted-bypass surfaces as a `400` at
 * write time instead of silently doing nothing) and every value must be a
 * real `ChecklistSeverity`.
 */
export function isValidChecklistSeverity(
  value: unknown
): value is ChecklistSeverity {
  return value === "blocking" || value === "warning" || value === "info";
}

export function isOverridableChecklistRuleId(
  value: string
): value is OverridableChecklistRuleId {
  return (OVERRIDABLE_RULE_IDS as readonly string[]).includes(value);
}
