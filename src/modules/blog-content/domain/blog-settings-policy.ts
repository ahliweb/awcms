/**
 * `PATCH /api/v1/blog/settings` validator (Issue #543 §Settings Page).
 * `awcms_blog_settings` (migration 026, Issue #537) already has typed
 * columns for `default_locale`/`default_visibility`/`posts_per_page`/
 * `seo_default_title`/`seo_default_description` — this issue is the first
 * to actually read/write them through an admin route. `blogTitle`,
 * `blogDescription`, `rssEnabled`, and `sitemapEnabled` have no dedicated
 * column (out of this issue's scope to add one — the table's existing
 * catch-all `settings jsonb` column is exactly for this), so they live
 * under that column instead. Partial-update shape, same convention as
 * `validateUpdateBlogPostInput`: only fields present in the body are
 * validated/copied.
 */
import { validateLocaleField } from "./content-validation";
import {
  isBlogContentVisibility,
  type BlogContentVisibility
} from "./post-status";
import {
  isOverridableChecklistRuleId,
  isValidChecklistSeverity,
  type ChecklistPolicyOverrides
} from "./content-quality-checklist";

export type ValidationError = {
  field: string;
  message: string;
};

const MAX_BLOG_TITLE_LENGTH = 200;
const MAX_BLOG_DESCRIPTION_LENGTH = 500;
const MAX_SEO_TITLE_LENGTH = 200;
const MAX_SEO_DESCRIPTION_LENGTH = 300;
const MIN_POSTS_PER_PAGE = 1;
const MAX_POSTS_PER_PAGE = 100;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type UpdateBlogSettingsInput = {
  blogTitle?: string;
  blogDescription?: string | null;
  postsPerPage?: number;
  rssEnabled?: boolean;
  sitemapEnabled?: boolean;
  defaultLocale?: string;
  defaultVisibility?: BlogContentVisibility;
  seoDefaultTitle?: string | null;
  seoDefaultDescription?: string | null;
  contentQualityChecklistPolicy?: ChecklistPolicyOverrides;
  /**
   * Issue #649 — tenant-level R2 fallback social preview image (source
   * priority #4 in `social-preview-image-resolution.ts`'s chain, the last
   * resort when a post has no explicit SEO image, no featured image, and no
   * usable verified image in its own content). A `awcms_news_media_
   * objects` id — existence/ownership/verified-status is re-checked at
   * RENDER time the exact same way `featuredMediaId` already is
   * (`NewsMediaPort.resolveMediaReferences`), never trusted from this
   * stored value alone. Storing the id in the generic tenant-writable
   * settings jsonb is safe for the same reason `contentQualityChecklistPolicy`
   * already is (see that field's comment below): this is a tenant BUSINESS
   * preference, not a security signal — the actual R2-only enforcement lives
   * entirely in the render-time resolution step.
   */
  socialPreviewFallbackImageMediaId?: string | null;
  /**
   * Issue #649 — source priority #3 ("first verified R2 image in content if
   * tenant policy allows") toggle. Default `true` (opt-out, matching this
   * repo's convention for a feature that adds no new attack surface — see
   * `blog-settings-directory.ts`'s `toView`).
   */
  socialPreviewContentImageFallbackEnabled?: boolean;
};

export type UpdateBlogSettingsValidationResult =
  | { valid: true; value: UpdateBlogSettingsInput }
  | { valid: false; errors: ValidationError[] };

function validateOptionalBoundedString(
  value: unknown,
  field: string,
  maxLength: number,
  requireNonEmpty: boolean
): ValidationError | null {
  if (value === null && !requireNonEmpty) {
    return null;
  }

  if (
    typeof value !== "string" ||
    (requireNonEmpty && value.trim().length === 0)
  ) {
    return {
      field,
      message: requireNonEmpty
        ? `${field} must be a non-empty string.`
        : `${field} must be a string or null.`
    };
  }

  if (value.length > maxLength) {
    return {
      field,
      message: `${field} must be at most ${maxLength} characters.`
    };
  }

  return null;
}

/**
 * `contentQualityChecklistPolicy` (Issue #640) — a tenant-configurable
 * warning-vs-blocking/info override for the checklist's NON-security rules
 * only. Unknown keys (typos, or an attempt to name a security rule id like
 * `unsafe_html_rejected`/`no_local_image_path`) are rejected with a `400`
 * rather than silently ignored — same "surface the mistake, don't eat it"
 * choice `resolveSeverity`'s defense-in-depth re-check in `content-quality-
 * checklist.ts` documents for the read side. Storing this in
 * `awcms_blog_settings.settings` (the existing tenant-writable
 * catch-all jsonb column, same as `blogTitle`/`rssEnabled`) is intentional,
 * NOT the anti-pattern Issue #636 documented (`.claude/skills/awcms-
 * news-portal/SKILL.md` §636 "JANGAN pernah menaruh sinyal keamanan/
 * enforcement..."): that lesson was about a SECURITY signal living in a
 * generic-writable place. This is the opposite — a tenant BUSINESS
 * preference for non-security severities, where the security rule ids are
 * hard-coded in `content-quality-checklist.ts` and never read from this
 * settings blob at all, so there is no bypass path a tenant-writable value
 * could ever unlock here.
 */
function validateContentQualityChecklistPolicy(
  value: unknown
): { valid: true; value: ChecklistPolicyOverrides } | { valid: false } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { valid: false };
  }

  const record = value as Record<string, unknown>;
  const result: ChecklistPolicyOverrides = {};

  for (const [key, severity] of Object.entries(record)) {
    if (
      !isOverridableChecklistRuleId(key) ||
      !isValidChecklistSeverity(severity)
    ) {
      return { valid: false };
    }

    result[key] = severity;
  }

  return { valid: true, value: result };
}

export function validateUpdateBlogSettingsInput(
  body: unknown
): UpdateBlogSettingsValidationResult {
  const errors: ValidationError[] = [];
  const record = (body ?? {}) as Record<string, unknown>;
  const value: UpdateBlogSettingsInput = {};

  if (record.blogTitle !== undefined) {
    const error = validateOptionalBoundedString(
      record.blogTitle,
      "blogTitle",
      MAX_BLOG_TITLE_LENGTH,
      true
    );
    if (error) {
      errors.push(error);
    } else {
      value.blogTitle = (record.blogTitle as string).trim();
    }
  }

  if (record.blogDescription !== undefined) {
    const error = validateOptionalBoundedString(
      record.blogDescription,
      "blogDescription",
      MAX_BLOG_DESCRIPTION_LENGTH,
      false
    );
    if (error) {
      errors.push(error);
    } else {
      value.blogDescription =
        record.blogDescription === null
          ? null
          : (record.blogDescription as string).trim();
    }
  }

  if (record.postsPerPage !== undefined) {
    if (
      typeof record.postsPerPage !== "number" ||
      !Number.isInteger(record.postsPerPage) ||
      record.postsPerPage < MIN_POSTS_PER_PAGE ||
      record.postsPerPage > MAX_POSTS_PER_PAGE
    ) {
      errors.push({
        field: "postsPerPage",
        message: `postsPerPage must be an integer between ${MIN_POSTS_PER_PAGE} and ${MAX_POSTS_PER_PAGE}.`
      });
    } else {
      value.postsPerPage = record.postsPerPage;
    }
  }

  if (record.rssEnabled !== undefined) {
    if (typeof record.rssEnabled !== "boolean") {
      errors.push({
        field: "rssEnabled",
        message: "rssEnabled must be a boolean."
      });
    } else {
      value.rssEnabled = record.rssEnabled;
    }
  }

  if (record.sitemapEnabled !== undefined) {
    if (typeof record.sitemapEnabled !== "boolean") {
      errors.push({
        field: "sitemapEnabled",
        message: "sitemapEnabled must be a boolean."
      });
    } else {
      value.sitemapEnabled = record.sitemapEnabled;
    }
  }

  if (record.defaultLocale !== undefined) {
    const error = validateLocaleField(record.defaultLocale);
    if (error) {
      errors.push({ field: "defaultLocale", message: error.message });
    } else {
      value.defaultLocale = (record.defaultLocale as string).trim();
    }
  }

  if (record.defaultVisibility !== undefined) {
    if (!isBlogContentVisibility(record.defaultVisibility)) {
      errors.push({
        field: "defaultVisibility",
        message: "defaultVisibility must be one of public, private, unlisted."
      });
    } else {
      value.defaultVisibility = record.defaultVisibility;
    }
  }

  if (record.seoDefaultTitle !== undefined) {
    const error = validateOptionalBoundedString(
      record.seoDefaultTitle,
      "seoDefaultTitle",
      MAX_SEO_TITLE_LENGTH,
      false
    );
    if (error) {
      errors.push(error);
    } else {
      value.seoDefaultTitle =
        record.seoDefaultTitle === null
          ? null
          : (record.seoDefaultTitle as string).trim();
    }
  }

  if (record.seoDefaultDescription !== undefined) {
    const error = validateOptionalBoundedString(
      record.seoDefaultDescription,
      "seoDefaultDescription",
      MAX_SEO_DESCRIPTION_LENGTH,
      false
    );
    if (error) {
      errors.push(error);
    } else {
      value.seoDefaultDescription =
        record.seoDefaultDescription === null
          ? null
          : (record.seoDefaultDescription as string).trim();
    }
  }

  if (record.contentQualityChecklistPolicy !== undefined) {
    const policyResult = validateContentQualityChecklistPolicy(
      record.contentQualityChecklistPolicy
    );
    if (!policyResult.valid) {
      errors.push({
        field: "contentQualityChecklistPolicy",
        message:
          "contentQualityChecklistPolicy must map overridable rule ids (excerpt_present, meta_description_present, featured_image_exists, featured_image_alt_text, featured_image_dimensions, og_image_trusted, taxonomy_exists, social_preview_image_ready, social_preview_image_alt_text) to a severity (blocking, warning, info)."
      });
    } else {
      value.contentQualityChecklistPolicy = policyResult.value;
    }
  }

  if (record.socialPreviewFallbackImageMediaId !== undefined) {
    const raw = record.socialPreviewFallbackImageMediaId;
    if (raw !== null && (typeof raw !== "string" || !UUID_PATTERN.test(raw))) {
      errors.push({
        field: "socialPreviewFallbackImageMediaId",
        message: "socialPreviewFallbackImageMediaId must be a UUID or null."
      });
    } else {
      value.socialPreviewFallbackImageMediaId = raw;
    }
  }

  if (record.socialPreviewContentImageFallbackEnabled !== undefined) {
    if (typeof record.socialPreviewContentImageFallbackEnabled !== "boolean") {
      errors.push({
        field: "socialPreviewContentImageFallbackEnabled",
        message: "socialPreviewContentImageFallbackEnabled must be a boolean."
      });
    } else {
      value.socialPreviewContentImageFallbackEnabled =
        record.socialPreviewContentImageFallbackEnabled;
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, value };
}
