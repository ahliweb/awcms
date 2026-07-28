/**
 * News portal advertisement placement presets (Issue #638, epic
 * `news_portal`). `blog_content` already ships a generic ads system
 * (`ad-policy.ts`/`ads-directory.ts`, Issue #542) whose `imageUrl` is a
 * free-form absolute http(s) URL — this file deliberately does NOT extend
 * that system. Every ad configured here references a verified R2 media
 * object (`mediaObjectId`, checked at the application layer against the
 * registry from Issue #633 — see `../application/ad-placement-reference-
 * validation.ts`), never a client-supplied image URL, so R2-only-ness holds
 * by construction rather than by a runtime mode gate (see migration
 * `049_awcms_news_portal_ad_placements_schema.sql`'s header comment
 * for the full "why a new table, not a mode-gated extension of
 * `awcms_blog_ads`" reasoning).
 *
 * `placementKey` is NOT immutable after creation (contrast with
 * `homepage-section-policy.ts`'s `sectionType`) — every placement preset
 * shares the exact same row shape here (media reference + link + schedule
 * + rotation knobs), so there is no config-shape hazard in reassigning an
 * existing row to a different placement via PATCH.
 */
export type AdPlacementKey =
  | "header_banner"
  | "below_headline"
  | "homepage_middle"
  | "homepage_bottom"
  | "article_top"
  | "article_middle"
  | "article_bottom"
  | "sidebar_top"
  | "sidebar_middle"
  | "sidebar_bottom"
  | "category_archive_top"
  | "search_result_top";

export const AD_PLACEMENT_KEYS: readonly AdPlacementKey[] = [
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
];

export function isAdPlacementKey(value: unknown): value is AdPlacementKey {
  return (
    typeof value === "string" && (AD_PLACEMENT_KEYS as string[]).includes(value)
  );
}

export type AdRotationMode = "latest" | "priority" | "random_safe" | "weighted";

export const AD_ROTATION_MODES: readonly AdRotationMode[] = [
  "latest",
  "priority",
  "random_safe",
  "weighted"
];

export function isAdRotationMode(value: unknown): value is AdRotationMode {
  return (
    typeof value === "string" && (AD_ROTATION_MODES as string[]).includes(value)
  );
}

/**
 * Same base raster allow-list `NEWS_MEDIA_R2_KNOWN_MIME_TYPES`
 * (`news-media-r2-config.ts`) sniffs for (`news-media-mime-sniffer.ts`) —
 * SVG is excluded by design (Keputusan kunci #5). Duplicated here as a
 * plain literal rather than imported: this file must stay a dependency-free
 * pure module (no `Bun.SQL`/config plumbing) importable from both the
 * application layer and tests without pulling in env-var resolution.
 */
export const AD_PLACEMENT_DEFAULT_MEDIA_TYPES: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif"
];

export type AdPlacementPreset = {
  /** Advisory display metadata only — NOT enforced against the referenced media object's real `width`/`height`. Enforcing an exact/near pixel match risks rejecting legitimately-cropped-but-still-appropriate images and isn't required by the issue's acceptance criteria; this is admin-UI guidance only. */
  recommendedSize: string;
  /**
   * Restricts which of the referenced media object's (already server-side
   * sniffed, see `news-media-mime-sniffer.ts`) MIME types may be used in
   * this placement. Every preset below currently shares the same default
   * set, so this check is currently redundant with what the R2 upload
   * pipeline already guarantees (a verified media object's `mimeType` is
   * always one of these four) — it exists as real, tested, defense-in-depth
   * machinery (`../application/ad-placement-reference-validation.ts`) so a
   * FUTURE placement can narrow its allow-list (e.g. disallow animated GIF
   * in a tight banner slot) without a new migration or a new validation
   * mechanism, not because any placement narrows it today.
   */
  allowedMediaTypes: readonly string[];
  /**
   * Cap applied at RENDER-selection time only (`ad-placement-rotation.ts`'s
   * `selectAdsForRotation`) — see migration 049's header comment for why
   * this is not a write-time limit on configured row count.
   */
  maxItems: number;
};

export const AD_PLACEMENT_PRESETS: Readonly<
  Record<AdPlacementKey, AdPlacementPreset>
> = {
  header_banner: {
    recommendedSize: "728x90",
    allowedMediaTypes: AD_PLACEMENT_DEFAULT_MEDIA_TYPES,
    maxItems: 1
  },
  below_headline: {
    recommendedSize: "970x250",
    allowedMediaTypes: AD_PLACEMENT_DEFAULT_MEDIA_TYPES,
    maxItems: 1
  },
  homepage_middle: {
    recommendedSize: "300x250",
    allowedMediaTypes: AD_PLACEMENT_DEFAULT_MEDIA_TYPES,
    maxItems: 3
  },
  homepage_bottom: {
    recommendedSize: "728x90",
    allowedMediaTypes: AD_PLACEMENT_DEFAULT_MEDIA_TYPES,
    maxItems: 1
  },
  article_top: {
    recommendedSize: "728x90",
    allowedMediaTypes: AD_PLACEMENT_DEFAULT_MEDIA_TYPES,
    maxItems: 1
  },
  article_middle: {
    recommendedSize: "300x250",
    allowedMediaTypes: AD_PLACEMENT_DEFAULT_MEDIA_TYPES,
    maxItems: 1
  },
  article_bottom: {
    recommendedSize: "728x90",
    allowedMediaTypes: AD_PLACEMENT_DEFAULT_MEDIA_TYPES,
    maxItems: 1
  },
  sidebar_top: {
    recommendedSize: "300x250",
    allowedMediaTypes: AD_PLACEMENT_DEFAULT_MEDIA_TYPES,
    maxItems: 1
  },
  sidebar_middle: {
    recommendedSize: "300x250",
    allowedMediaTypes: AD_PLACEMENT_DEFAULT_MEDIA_TYPES,
    maxItems: 1
  },
  sidebar_bottom: {
    recommendedSize: "300x250",
    allowedMediaTypes: AD_PLACEMENT_DEFAULT_MEDIA_TYPES,
    maxItems: 1
  },
  category_archive_top: {
    recommendedSize: "728x90",
    allowedMediaTypes: AD_PLACEMENT_DEFAULT_MEDIA_TYPES,
    maxItems: 1
  },
  search_result_top: {
    recommendedSize: "728x90",
    allowedMediaTypes: AD_PLACEMENT_DEFAULT_MEDIA_TYPES,
    maxItems: 1
  }
};

export type ValidationError = {
  field: string;
  message: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Same cap as `content-validation.ts`'s `MAX_TITLE_LENGTH`/`blog-settings-policy.ts`'s `MAX_BLOG_TITLE_LENGTH` — security-auditor Low finding on PR #727: `name` previously had no upper bound. */
const MAX_AD_PLACEMENT_NAME_LENGTH = 200;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/**
 * Absolute http(s) check for the ad's (optional, possibly external) link
 * URL — same rule `blog-content/domain/seo-validation.ts`'s
 * `isAbsoluteHttpUrl`/`blog-content/domain/ad-policy.ts` already apply to
 * their own URL fields, deliberately DUPLICATED (not imported) here: a
 * `news_portal` `domain` file may never import `blog_content`'s
 * `application`/`domain` tree (`tests/unit/module-boundary.test.ts`, Issue
 * #681) — this two-line pure predicate is cheaper to keep in sync by eye
 * than to route through a cross-module port for. Rejects `javascript:`/
 * `data:`/relative paths/anything that isn't a well-formed `http:`/`https:`
 * URL — this is what keeps the (possibly external) link from ever becoming
 * an XSS or scheme-confusion channel.
 */
export function isSafeAdLinkUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function parseOptionalDate(
  value: unknown,
  field: string,
  errors: ValidationError[]
): Date | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    errors.push({
      field,
      message: `${field} must be an ISO 8601 datetime string.`
    });
    return null;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    errors.push({
      field,
      message: `${field} must be a valid ISO 8601 datetime.`
    });
    return null;
  }

  return parsed;
}

export type CreateAdPlacementInput = {
  placementKey: AdPlacementKey;
  name: string;
  mediaObjectId: string;
  linkUrl: string | null;
  rotationMode: AdRotationMode;
  priority: number;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
};

export type CreateAdPlacementValidationResult =
  | { valid: true; value: CreateAdPlacementInput }
  | { valid: false; errors: ValidationError[] };

export function validateCreateAdPlacementInput(
  body: unknown
): CreateAdPlacementValidationResult {
  const record = (body ?? {}) as Record<string, unknown>;
  const errors: ValidationError[] = [];

  if (!isAdPlacementKey(record.placementKey)) {
    errors.push({
      field: "placementKey",
      message: `placementKey must be one of ${AD_PLACEMENT_KEYS.join(", ")}.`
    });
  }

  if (!isNonEmptyString(record.name)) {
    errors.push({ field: "name", message: "name is required." });
  } else if (record.name.length > MAX_AD_PLACEMENT_NAME_LENGTH) {
    errors.push({
      field: "name",
      message: `name must be at most ${MAX_AD_PLACEMENT_NAME_LENGTH} characters.`
    });
  }

  if (!isUuid(record.mediaObjectId)) {
    errors.push({
      field: "mediaObjectId",
      message: "mediaObjectId is required and must be a UUID."
    });
  }

  let linkUrl: string | null = null;

  if (record.linkUrl !== undefined && record.linkUrl !== null) {
    if (
      typeof record.linkUrl !== "string" ||
      !isSafeAdLinkUrl(record.linkUrl)
    ) {
      errors.push({
        field: "linkUrl",
        message: "linkUrl must be an absolute http(s) URL when provided."
      });
    } else {
      linkUrl = record.linkUrl;
    }
  }

  let rotationMode: AdRotationMode = "latest";

  if (record.rotationMode !== undefined) {
    if (!isAdRotationMode(record.rotationMode)) {
      errors.push({
        field: "rotationMode",
        message: `rotationMode must be one of ${AD_ROTATION_MODES.join(", ")}.`
      });
    } else {
      rotationMode = record.rotationMode;
    }
  }

  let priority = 0;

  if (record.priority !== undefined) {
    if (
      typeof record.priority !== "number" ||
      !Number.isInteger(record.priority) ||
      record.priority < 0
    ) {
      errors.push({
        field: "priority",
        message: "priority must be a non-negative integer."
      });
    } else {
      priority = record.priority;
    }
  }

  const startsAt = parseOptionalDate(record.startsAt, "startsAt", errors);
  const endsAt = parseOptionalDate(record.endsAt, "endsAt", errors);

  if (startsAt && endsAt && endsAt <= startsAt) {
    errors.push({ field: "endsAt", message: "endsAt must be after startsAt." });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      placementKey: record.placementKey as AdPlacementKey,
      name: (record.name as string).trim(),
      mediaObjectId: record.mediaObjectId as string,
      linkUrl,
      rotationMode,
      priority,
      isActive: record.isActive !== false,
      startsAt,
      endsAt
    }
  };
}

export type UpdateAdPlacementInput = {
  placementKey?: AdPlacementKey;
  name?: string;
  mediaObjectId?: string;
  linkUrl?: string | null;
  rotationMode?: AdRotationMode;
  priority?: number;
  isActive?: boolean;
  startsAt?: Date | null;
  endsAt?: Date | null;
};

export type UpdateAdPlacementValidationResult =
  | { valid: true; value: UpdateAdPlacementInput }
  | { valid: false; errors: ValidationError[] };

export function validateUpdateAdPlacementInput(
  body: unknown
): UpdateAdPlacementValidationResult {
  const record = (body ?? {}) as Record<string, unknown>;
  const errors: ValidationError[] = [];
  const value: UpdateAdPlacementInput = {};

  if (record.placementKey !== undefined) {
    if (!isAdPlacementKey(record.placementKey)) {
      errors.push({
        field: "placementKey",
        message: `placementKey must be one of ${AD_PLACEMENT_KEYS.join(", ")}.`
      });
    } else {
      value.placementKey = record.placementKey;
    }
  }

  if (record.name !== undefined) {
    if (!isNonEmptyString(record.name)) {
      errors.push({
        field: "name",
        message: "name must be a non-empty string."
      });
    } else if (record.name.length > MAX_AD_PLACEMENT_NAME_LENGTH) {
      errors.push({
        field: "name",
        message: `name must be at most ${MAX_AD_PLACEMENT_NAME_LENGTH} characters.`
      });
    } else {
      value.name = record.name.trim();
    }
  }

  if (record.mediaObjectId !== undefined) {
    if (!isUuid(record.mediaObjectId)) {
      errors.push({
        field: "mediaObjectId",
        message: "mediaObjectId must be a UUID."
      });
    } else {
      value.mediaObjectId = record.mediaObjectId;
    }
  }

  if (record.linkUrl !== undefined) {
    if (record.linkUrl === null) {
      value.linkUrl = null;
    } else if (
      typeof record.linkUrl !== "string" ||
      !isSafeAdLinkUrl(record.linkUrl)
    ) {
      errors.push({
        field: "linkUrl",
        message: "linkUrl must be an absolute http(s) URL when provided."
      });
    } else {
      value.linkUrl = record.linkUrl;
    }
  }

  if (record.rotationMode !== undefined) {
    if (!isAdRotationMode(record.rotationMode)) {
      errors.push({
        field: "rotationMode",
        message: `rotationMode must be one of ${AD_ROTATION_MODES.join(", ")}.`
      });
    } else {
      value.rotationMode = record.rotationMode;
    }
  }

  if (record.priority !== undefined) {
    if (
      typeof record.priority !== "number" ||
      !Number.isInteger(record.priority) ||
      record.priority < 0
    ) {
      errors.push({
        field: "priority",
        message: "priority must be a non-negative integer."
      });
    } else {
      value.priority = record.priority;
    }
  }

  if (record.isActive !== undefined) {
    if (typeof record.isActive !== "boolean") {
      errors.push({
        field: "isActive",
        message: "isActive must be a boolean."
      });
    } else {
      value.isActive = record.isActive;
    }
  }

  if (record.startsAt !== undefined) {
    value.startsAt = parseOptionalDate(record.startsAt, "startsAt", errors);
  }

  if (record.endsAt !== undefined) {
    value.endsAt = parseOptionalDate(record.endsAt, "endsAt", errors);
  }

  if (
    value.startsAt !== undefined &&
    value.endsAt !== undefined &&
    value.startsAt &&
    value.endsAt &&
    value.endsAt <= value.startsAt
  ) {
    errors.push({ field: "endsAt", message: "endsAt must be after startsAt." });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, value };
}
