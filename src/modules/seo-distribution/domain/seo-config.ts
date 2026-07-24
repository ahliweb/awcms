/**
 * Tenant SEO defaults — the shape `awcms_seo_tenant_settings` (sql/057 + sql/059)
 * carries and the validation the admin API applies before writing it (ADR-0038
 * §4). Pure: no I/O. The renderer applies these defaults UNDERNEATH resource-level
 * `SeoResourceFacts` (a resource's own value always wins — see `seo-document.ts`).
 */

/** Resolved, render-ready tenant SEO defaults (every field already validated). */
export type SeoTenantSettings = {
  /** Overrides the tenant display name for `og:site_name` / JSON-LD; `null` → fall back to tenant name. */
  siteName: string | null;
  defaultMetaDescription: string | null;
  /** Media object id (resolved via `MediaLibraryPort` at render time), or `null`. */
  defaultSocialMediaId: string | null;
  /** e.g. `"@example"` — rendered as `twitter:site`. */
  twitterSiteHandle: string | null;
  organizationName: string | null;
  organizationLogoMediaId: string | null;
  /** Tenant-wide "this whole site is noindex" switch. When true, robots.txt disallows all crawling and every surface degrades to noindex. */
  defaultRobotsNoindex: boolean;
  // --- feed/sitemap/robots discovery config (sql/059) ---
  /** Overrides the feed channel/title; `null` → fall back to `siteName`/tenant name. */
  feedTitle: string | null;
  /** Feed channel description; `null` → a generic "Latest from {site}" default. */
  feedDescription: string | null;
  /** Feed logo/icon media object id (resolved via `MediaLibraryPort`), or `null`. */
  feedLogoMediaId: string | null;
  /** Max items per feed (RSS/Atom/JSON); bounded 1..200, default 50. Only ever makes a feed SMALLER than the code ceiling. */
  feedItemLimit: number;
  /** Optional allow-list of `resourceType`s to include in sitemap/feeds; `null` → all eligible types. */
  includedResourceTypes: string[] | null;
  /** Whether this tenant's sitemap index/child sitemaps are served (and advertised in robots.txt). */
  sitemapEnabled: boolean;
  /** Whether this tenant's RSS/Atom/JSON feeds are served. */
  feedsEnabled: boolean;
};

/** The default per-item feed limit — mirrors the sql/059 column default. */
export const FEED_ITEM_LIMIT_DEFAULT = 50;
export const FEED_ITEM_LIMIT_MIN = 1;
/** Hard ceiling on the configurable feed size (sql/059 CHECK) — keeps every feed bounded regardless of tenant input. */
export const FEED_ITEM_LIMIT_MAX = 200;
/** Max entries in the optional content-type allow-list (sql/059 CHECK). */
export const INCLUDED_RESOURCE_TYPES_MAX = 50;
/** Per-entry cap for an included resource-type slug. */
export const RESOURCE_TYPE_MAX_LEN = 64;
/** A resource-type discriminator is a lowercase slug (matches `blog_post`, a future `product`, …). */
const RESOURCE_TYPE_PATTERN = /^[a-z][a-z0-9_]*$/;

/** The neutral default when a tenant has no config row yet — everything absent, site indexable, discovery on. */
export const EMPTY_SEO_TENANT_SETTINGS: SeoTenantSettings = {
  siteName: null,
  defaultMetaDescription: null,
  defaultSocialMediaId: null,
  twitterSiteHandle: null,
  organizationName: null,
  organizationLogoMediaId: null,
  defaultRobotsNoindex: false,
  feedTitle: null,
  feedDescription: null,
  feedLogoMediaId: null,
  feedItemLimit: FEED_ITEM_LIMIT_DEFAULT,
  includedResourceTypes: null,
  sitemapEnabled: true,
  feedsEnabled: true
};

/** Field length caps — mirror the CHECK constraints in sql/057 + sql/059 (defense in depth: validate here first with a clean error, the DB is the floor). */
export const SEO_SETTINGS_LIMITS = {
  siteName: 200,
  defaultMetaDescription: 500,
  twitterSiteHandle: 80,
  organizationName: 200,
  feedTitle: 200,
  feedDescription: 500
} as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SeoSettingsValidationError = {
  field: string;
  message: string;
};

export type SeoSettingsValidationResult =
  | { ok: true; value: SeoTenantSettings }
  | { ok: false; errors: SeoSettingsValidationError[] };

function normalizeOptionalText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Validate + normalize an untrusted request body into `SeoTenantSettings`.
 * Unknown keys are ignored (not an error — forward-compatible), every string is
 * trimmed and empty-collapsed to `null`, lengths are bounded, and the two media id
 * fields must be a UUID or `null` (a non-UUID string is rejected here rather than
 * stored and silently dropped at render time). `defaultRobotsNoindex` accepts only
 * a real boolean; a missing value defaults to `false` (indexable).
 */
export function validateSeoTenantSettings(
  body: unknown
): SeoSettingsValidationResult {
  const errors: SeoSettingsValidationError[] = [];

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      errors: [
        { field: "body", message: "Request body must be a JSON object." }
      ]
    };
  }

  const input = body as Record<string, unknown>;

  const boundedText = (
    field: keyof typeof SEO_SETTINGS_LIMITS
  ): string | null => {
    const normalized = normalizeOptionalText(input[field]);
    if (normalized !== null && normalized.length > SEO_SETTINGS_LIMITS[field]) {
      errors.push({
        field,
        message: `Must be at most ${SEO_SETTINGS_LIMITS[field]} characters.`
      });
      return null;
    }
    return normalized;
  };

  const mediaId = (field: string): string | null => {
    const normalized = normalizeOptionalText(input[field]);
    if (normalized !== null && !UUID_PATTERN.test(normalized)) {
      errors.push({ field, message: "Must be a media object UUID or null." });
      return null;
    }
    return normalized;
  };

  const boolField = (field: string, fallback: boolean): boolean => {
    if (input[field] === undefined) return fallback;
    if (typeof input[field] !== "boolean") {
      errors.push({ field, message: "Must be a boolean." });
      return fallback;
    }
    return input[field] as boolean;
  };

  const siteName = boundedText("siteName");
  const defaultMetaDescription = boundedText("defaultMetaDescription");
  const twitterSiteHandle = boundedText("twitterSiteHandle");
  const organizationName = boundedText("organizationName");
  const defaultSocialMediaId = mediaId("defaultSocialMediaId");
  const organizationLogoMediaId = mediaId("organizationLogoMediaId");
  const defaultRobotsNoindex = boolField("defaultRobotsNoindex", false);

  // Feed/sitemap/robots discovery config.
  const feedTitle = boundedText("feedTitle");
  const feedDescription = boundedText("feedDescription");
  const feedLogoMediaId = mediaId("feedLogoMediaId");
  const sitemapEnabled = boolField("sitemapEnabled", true);
  const feedsEnabled = boolField("feedsEnabled", true);

  // Item limit: an integer within the bounded range, default 50. A float,
  // non-number, or out-of-range value is rejected (never silently clamped — the
  // caller should see their config was invalid).
  let feedItemLimit = FEED_ITEM_LIMIT_DEFAULT;
  if (input.feedItemLimit !== undefined && input.feedItemLimit !== null) {
    const raw = input.feedItemLimit;
    if (
      typeof raw !== "number" ||
      !Number.isInteger(raw) ||
      raw < FEED_ITEM_LIMIT_MIN ||
      raw > FEED_ITEM_LIMIT_MAX
    ) {
      errors.push({
        field: "feedItemLimit",
        message: `Must be an integer between ${FEED_ITEM_LIMIT_MIN} and ${FEED_ITEM_LIMIT_MAX}.`
      });
    } else {
      feedItemLimit = raw;
    }
  }

  // Included content types: null/absent/empty → null (all eligible types). A
  // non-empty array must hold ≤ INCLUDED_RESOURCE_TYPES_MAX lowercase slugs.
  let includedResourceTypes: string[] | null = null;
  const rawTypes = input.includedResourceTypes;
  if (rawTypes !== undefined && rawTypes !== null) {
    if (!Array.isArray(rawTypes)) {
      errors.push({
        field: "includedResourceTypes",
        message: "Must be an array of resource-type slugs or null."
      });
    } else if (rawTypes.length > INCLUDED_RESOURCE_TYPES_MAX) {
      errors.push({
        field: "includedResourceTypes",
        message: `Must contain at most ${INCLUDED_RESOURCE_TYPES_MAX} entries.`
      });
    } else {
      const cleaned: string[] = [];
      let entryError = false;
      for (const entry of rawTypes) {
        if (
          typeof entry !== "string" ||
          entry.length > RESOURCE_TYPE_MAX_LEN ||
          !RESOURCE_TYPE_PATTERN.test(entry)
        ) {
          entryError = true;
          break;
        }
        if (!cleaned.includes(entry)) cleaned.push(entry);
      }
      if (entryError) {
        errors.push({
          field: "includedResourceTypes",
          message: `Each entry must be a lowercase slug (letters, digits, underscore) of at most ${RESOURCE_TYPE_MAX_LEN} characters.`
        });
      } else {
        // An explicit empty allow-list collapses to null (all) — turning off
        // discovery entirely is done via sitemapEnabled/feedsEnabled, not by an
        // empty include list that would silently produce an empty sitemap.
        includedResourceTypes = cleaned.length === 0 ? null : cleaned;
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      siteName,
      defaultMetaDescription,
      defaultSocialMediaId,
      twitterSiteHandle,
      organizationName,
      organizationLogoMediaId,
      defaultRobotsNoindex,
      feedTitle,
      feedDescription,
      feedLogoMediaId,
      feedItemLimit,
      includedResourceTypes,
      sitemapEnabled,
      feedsEnabled
    }
  };
}
