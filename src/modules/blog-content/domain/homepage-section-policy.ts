/**
 * Editorial homepage section composer (Issue #637, epic `news_portal`).
 * Six section types, each with its own strictly-whitelisted `config_json`
 * shape — no field on any type ever accepts raw HTML or an arbitrary image
 * URL, only UUIDs referencing already-public-safe/already-R2-verified data
 * (`blog_content` posts via `postId`/`postIds`, the R2 media registry via
 * `mediaObjectIds`). `sectionType` is immutable after creation (an update
 * can change `config`/`title`/`sortOrder`/`isEnabled`/`startsAt`/`endsAt`,
 * never `sectionType` itself) — the caller (`homepage-section-directory.ts`)
 * passes the existing row's `sectionType` back into
 * `validateUpdateHomepageSectionInput` so `config` is always validated
 * against the one shape it must match, same "type gates which fields are
 * meaningful" convention `ad-policy.ts`/`menu-policy.ts` already use.
 *
 * `video_block`/`ad_slot`/`custom_widget_block` deliberately NOT included —
 * see migration `044_awcms_news_portal_homepage_sections_schema.sql`'s
 * header comment for why (blocked on #639/#638, and explicitly out of scope
 * per the issue body, respectively). A `static_page_block` was considered
 * and dropped for the same reason — no existing public page-detail
 * visibility-tested query exists yet to reuse.
 */
export type HomepageSectionType =
  | "headline"
  | "latest_posts"
  | "featured_posts"
  | "editor_picks"
  | "category_grid"
  | "gallery_block";

export const HOMEPAGE_SECTION_TYPES: readonly HomepageSectionType[] = [
  "headline",
  "latest_posts",
  "featured_posts",
  "editor_picks",
  "category_grid",
  "gallery_block"
];

export function isHomepageSectionType(
  value: unknown
): value is HomepageSectionType {
  return (
    typeof value === "string" &&
    (HOMEPAGE_SECTION_TYPES as string[]).includes(value)
  );
}

export type ValidationError = {
  field: string;
  message: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECTION_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const LATEST_POSTS_DEFAULT_LIMIT = 5;
const LATEST_POSTS_MAX_LIMIT = 20;
const CURATED_POSTS_MIN = 1;
const CURATED_POSTS_MAX = 20;
const CATEGORY_GRID_MIN_CATEGORIES = 1;
const CATEGORY_GRID_MAX_CATEGORIES = 8;
const CATEGORY_GRID_DEFAULT_POSTS_PER_CATEGORY = 3;
const CATEGORY_GRID_MAX_POSTS_PER_CATEGORY = 6;
const GALLERY_MIN_ITEMS = 1;
const GALLERY_MAX_ITEMS = 20;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isUuidArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => isUuid(item));
}

export type HeadlineSectionConfig = { postId: string };
export type LatestPostsSectionConfig = {
  limit: number;
  categorySlug: string | null;
};
export type CuratedPostsSectionConfig = { postIds: string[] };
export type CategoryGridSectionConfig = {
  categorySlugs: string[];
  postsPerCategory: number;
};
export type GalleryBlockSectionConfig = {
  mediaObjectIds: string[];
  caption: string | null;
};

export type HomepageSectionConfigOf<T extends HomepageSectionType> =
  T extends "headline"
    ? HeadlineSectionConfig
    : T extends "latest_posts"
      ? LatestPostsSectionConfig
      : T extends "featured_posts" | "editor_picks"
        ? CuratedPostsSectionConfig
        : T extends "category_grid"
          ? CategoryGridSectionConfig
          : T extends "gallery_block"
            ? GalleryBlockSectionConfig
            : never;

function validateHeadlineConfig(
  record: Record<string, unknown>,
  errors: ValidationError[]
): HeadlineSectionConfig | null {
  if (!isUuid(record.postId)) {
    errors.push({
      field: "config.postId",
      message: "config.postId is required and must be a UUID."
    });
    return null;
  }

  return { postId: record.postId };
}

function validateLatestPostsConfig(
  record: Record<string, unknown>,
  errors: ValidationError[]
): LatestPostsSectionConfig | null {
  let limit = LATEST_POSTS_DEFAULT_LIMIT;

  if (record.limit !== undefined) {
    if (
      typeof record.limit !== "number" ||
      !Number.isInteger(record.limit) ||
      record.limit < 1 ||
      record.limit > LATEST_POSTS_MAX_LIMIT
    ) {
      errors.push({
        field: "config.limit",
        message: `config.limit must be an integer between 1 and ${LATEST_POSTS_MAX_LIMIT}.`
      });
      return null;
    }

    limit = record.limit;
  }

  let categorySlug: string | null = null;

  if (record.categorySlug !== undefined && record.categorySlug !== null) {
    if (!isNonEmptyString(record.categorySlug)) {
      errors.push({
        field: "config.categorySlug",
        message: "config.categorySlug must be a non-empty string when provided."
      });
      return null;
    }

    categorySlug = record.categorySlug.trim();
  }

  return { limit, categorySlug };
}

function validateCuratedPostsConfig(
  record: Record<string, unknown>,
  errors: ValidationError[]
): CuratedPostsSectionConfig | null {
  if (
    !isUuidArray(record.postIds) ||
    record.postIds.length < CURATED_POSTS_MIN ||
    record.postIds.length > CURATED_POSTS_MAX
  ) {
    errors.push({
      field: "config.postIds",
      message: `config.postIds is required and must be an array of ${CURATED_POSTS_MIN}-${CURATED_POSTS_MAX} UUIDs.`
    });
    return null;
  }

  return { postIds: record.postIds };
}

function validateCategoryGridConfig(
  record: Record<string, unknown>,
  errors: ValidationError[]
): CategoryGridSectionConfig | null {
  if (
    !Array.isArray(record.categorySlugs) ||
    record.categorySlugs.length < CATEGORY_GRID_MIN_CATEGORIES ||
    record.categorySlugs.length > CATEGORY_GRID_MAX_CATEGORIES ||
    !record.categorySlugs.every((item) => isNonEmptyString(item))
  ) {
    errors.push({
      field: "config.categorySlugs",
      message: `config.categorySlugs is required and must be an array of ${CATEGORY_GRID_MIN_CATEGORIES}-${CATEGORY_GRID_MAX_CATEGORIES} non-empty strings.`
    });
    return null;
  }

  let postsPerCategory = CATEGORY_GRID_DEFAULT_POSTS_PER_CATEGORY;

  if (record.postsPerCategory !== undefined) {
    if (
      typeof record.postsPerCategory !== "number" ||
      !Number.isInteger(record.postsPerCategory) ||
      record.postsPerCategory < 1 ||
      record.postsPerCategory > CATEGORY_GRID_MAX_POSTS_PER_CATEGORY
    ) {
      errors.push({
        field: "config.postsPerCategory",
        message: `config.postsPerCategory must be an integer between 1 and ${CATEGORY_GRID_MAX_POSTS_PER_CATEGORY}.`
      });
      return null;
    }

    postsPerCategory = record.postsPerCategory;
  }

  return {
    categorySlugs: record.categorySlugs.map((slug) => (slug as string).trim()),
    postsPerCategory
  };
}

function validateGalleryBlockConfig(
  record: Record<string, unknown>,
  errors: ValidationError[]
): GalleryBlockSectionConfig | null {
  if (
    !isUuidArray(record.mediaObjectIds) ||
    record.mediaObjectIds.length < GALLERY_MIN_ITEMS ||
    record.mediaObjectIds.length > GALLERY_MAX_ITEMS
  ) {
    errors.push({
      field: "config.mediaObjectIds",
      message: `config.mediaObjectIds is required and must be an array of ${GALLERY_MIN_ITEMS}-${GALLERY_MAX_ITEMS} UUIDs.`
    });
    return null;
  }

  let caption: string | null = null;

  if (record.caption !== undefined && record.caption !== null) {
    if (!isNonEmptyString(record.caption)) {
      errors.push({
        field: "config.caption",
        message: "config.caption must be a non-empty string when provided."
      });
      return null;
    }

    caption = record.caption.trim();
  }

  return { mediaObjectIds: record.mediaObjectIds, caption };
}

/** Discriminated `config` validator — the ONLY place a `sectionType` is mapped to its allowed `config_json` shape. `rawConfig` must already be a plain object (checked by the caller). */
export function validateHomepageSectionConfig(
  sectionType: HomepageSectionType,
  rawConfig: unknown,
  errors: ValidationError[]
): Record<string, unknown> | null {
  const record = (
    typeof rawConfig === "object" &&
    rawConfig !== null &&
    !Array.isArray(rawConfig)
      ? rawConfig
      : {}
  ) as Record<string, unknown>;

  switch (sectionType) {
    case "headline":
      return validateHeadlineConfig(record, errors);
    case "latest_posts":
      return validateLatestPostsConfig(record, errors);
    case "featured_posts":
    case "editor_picks":
      return validateCuratedPostsConfig(record, errors);
    case "category_grid":
      return validateCategoryGridConfig(record, errors);
    case "gallery_block":
      return validateGalleryBlockConfig(record, errors);
    default:
      return null;
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

export type CreateHomepageSectionInput = {
  sectionKey: string;
  sectionType: HomepageSectionType;
  title: string | null;
  config: Record<string, unknown>;
  sortOrder: number;
  isEnabled: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
};

export type CreateHomepageSectionValidationResult =
  | { valid: true; value: CreateHomepageSectionInput }
  | { valid: false; errors: ValidationError[] };

export function validateCreateHomepageSectionInput(
  body: unknown
): CreateHomepageSectionValidationResult {
  const record = (body ?? {}) as Record<string, unknown>;
  const errors: ValidationError[] = [];

  if (
    !isNonEmptyString(record.sectionKey) ||
    !SECTION_KEY_PATTERN.test(record.sectionKey.trim())
  ) {
    errors.push({
      field: "sectionKey",
      message:
        "sectionKey is required and must match ^[a-z0-9][a-z0-9_-]{0,63}$."
    });
  }

  if (!isHomepageSectionType(record.sectionType)) {
    errors.push({
      field: "sectionType",
      message: `sectionType must be one of ${HOMEPAGE_SECTION_TYPES.join(", ")}.`
    });
  }

  let title: string | null = null;

  if (record.title !== undefined && record.title !== null) {
    if (typeof record.title !== "string") {
      errors.push({ field: "title", message: "title must be a string." });
    } else {
      title = record.title.trim() || null;
    }
  }

  let sortOrder = 0;

  if (record.sortOrder !== undefined) {
    if (
      typeof record.sortOrder !== "number" ||
      !Number.isInteger(record.sortOrder)
    ) {
      errors.push({
        field: "sortOrder",
        message: "sortOrder must be an integer."
      });
    } else {
      sortOrder = record.sortOrder;
    }
  }

  const startsAt = parseOptionalDate(record.startsAt, "startsAt", errors);
  const endsAt = parseOptionalDate(record.endsAt, "endsAt", errors);

  if (startsAt && endsAt && endsAt <= startsAt) {
    errors.push({ field: "endsAt", message: "endsAt must be after startsAt." });
  }

  let config: Record<string, unknown> | null = null;

  if (isHomepageSectionType(record.sectionType)) {
    config = validateHomepageSectionConfig(
      record.sectionType,
      record.config,
      errors
    );
  }

  if (
    errors.length > 0 ||
    !config ||
    !isHomepageSectionType(record.sectionType)
  ) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      sectionKey: record.sectionKey as string,
      sectionType: record.sectionType,
      title,
      config,
      sortOrder,
      isEnabled: record.isEnabled !== false,
      startsAt,
      endsAt
    }
  };
}

export type UpdateHomepageSectionInput = {
  title?: string | null;
  config?: Record<string, unknown>;
  sortOrder?: number;
  isEnabled?: boolean;
  startsAt?: Date | null;
  endsAt?: Date | null;
};

export type UpdateHomepageSectionValidationResult =
  | { valid: true; value: UpdateHomepageSectionInput }
  | { valid: false; errors: ValidationError[] };

/** `currentSectionType` — the existing row's immutable type, supplied by the caller (`homepage-section-directory.ts`'s `updateHomepageSection`, which fetches the row first) — `config`, when present in the request, is validated against THIS type; a request cannot change `sectionType`. */
export function validateUpdateHomepageSectionInput(
  body: unknown,
  currentSectionType: HomepageSectionType
): UpdateHomepageSectionValidationResult {
  const record = (body ?? {}) as Record<string, unknown>;
  const errors: ValidationError[] = [];
  const value: UpdateHomepageSectionInput = {};

  if (
    record.sectionType !== undefined &&
    record.sectionType !== currentSectionType
  ) {
    errors.push({
      field: "sectionType",
      message: "sectionType cannot be changed after creation."
    });
  }

  if (record.title !== undefined) {
    if (record.title !== null && typeof record.title !== "string") {
      errors.push({
        field: "title",
        message: "title must be a string or null."
      });
    } else {
      value.title =
        typeof record.title === "string" ? record.title.trim() || null : null;
    }
  }

  if (record.sortOrder !== undefined) {
    if (
      typeof record.sortOrder !== "number" ||
      !Number.isInteger(record.sortOrder)
    ) {
      errors.push({
        field: "sortOrder",
        message: "sortOrder must be an integer."
      });
    } else {
      value.sortOrder = record.sortOrder;
    }
  }

  if (record.isEnabled !== undefined) {
    if (typeof record.isEnabled !== "boolean") {
      errors.push({
        field: "isEnabled",
        message: "isEnabled must be a boolean."
      });
    } else {
      value.isEnabled = record.isEnabled;
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

  if (record.config !== undefined) {
    const config = validateHomepageSectionConfig(
      currentSectionType,
      record.config,
      errors
    );

    if (config) {
      value.config = config;
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, value };
}
