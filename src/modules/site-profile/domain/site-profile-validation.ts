/**
 * Validation for the tenant site profile (Issue #596, ADR-0102).
 *
 * Pure — no database, no config, like its neighbours. Every field is optional
 * because a tenant that has filled in nothing is a valid tenant.
 *
 * ## `social_links` is the part with a security surface
 *
 * These URLs are rendered as `<a href>` on every public page. A `javascript:`
 * or `data:` href there is stored XSS with a very long reach, so this validator
 * REFUSES anything that is not an absolute `http(s)` URL rather than trying to
 * sanitize it — the same posture `content-validation.ts` takes toward markup,
 * and the same one `assertSafeRedirectTarget` takes toward redirect targets.
 *
 * The platform label is bounded but NOT an enumeration. Closing that set would
 * mean a migration every time a newsroom joins a new network, and unlike a
 * content block type there is no rendering behaviour keyed off it — it is a
 * label and an icon lookup, and an unknown one degrades to a plain link.
 */

export type ValidationError = { field: string; message: string };

export type SocialLink = {
  platform: string;
  url: string;
};

export type SiteProfileInput = {
  tagline: string | null;
  copyrightNotice: string | null;
  logoMediaId: string | null;
  faviconMediaId: string | null;
  editorialAddress: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  whatsappNumber: string | null;
  socialLinks: SocialLink[];
};

export type SiteProfileValidationResult =
  | { valid: true; value: SiteProfileInput }
  | { valid: false; errors: ValidationError[] };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Mirrors the `CHECK` bounds in `sql/135`, so the two cannot disagree. */
export const SITE_PROFILE_LIMITS = {
  tagline: 200,
  copyrightNotice: 300,
  editorialAddress: 1000,
  contactEmail: 320,
  contactPhone: 50,
  whatsappNumber: 50,
  platform: 40,
  url: 500,
  socialLinks: 20
} as const;

function optionalText(
  value: unknown,
  field: string,
  max: number,
  errors: ValidationError[]
): string | null {
  if (value === undefined || value === null) return null;

  if (typeof value !== "string") {
    errors.push({ field, message: `${field} must be a string or null.` });
    return null;
  }

  const trimmed = value.trim();

  // An empty string means "cleared", not "the empty string" — a footer that
  // renders a blank line is worse than one that omits the block.
  if (trimmed === "") return null;

  if (trimmed.length > max) {
    errors.push({
      field,
      message: `${field} must be at most ${max} characters.`
    });
    return null;
  }

  return trimmed;
}

function optionalUuid(
  value: unknown,
  field: string,
  errors: ValidationError[]
): string | null {
  if (value === undefined || value === null) return null;

  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    errors.push({ field, message: `${field} must be a UUID or null.` });
    return null;
  }

  return value;
}

/**
 * Absolute `http(s)` only.
 *
 * A protocol-relative (`//host`) or scheme-less value is refused too: both
 * parse as "something" in a browser and neither states an origin, which is
 * precisely the ambiguity an attacker uses.
 */
export function isSafeSocialUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  return parsed.protocol === "https:" || parsed.protocol === "http:";
}

function validateSocialLinks(
  value: unknown,
  errors: ValidationError[]
): SocialLink[] {
  if (value === undefined || value === null) return [];

  if (!Array.isArray(value)) {
    errors.push({
      field: "socialLinks",
      message: "socialLinks must be an array."
    });
    return [];
  }

  if (value.length > SITE_PROFILE_LIMITS.socialLinks) {
    errors.push({
      field: "socialLinks",
      message: `socialLinks must hold at most ${SITE_PROFILE_LIMITS.socialLinks} entries.`
    });
    return [];
  }

  const links: SocialLink[] = [];
  const seen = new Set<string>();

  value.forEach((raw, index) => {
    const record = (raw ?? {}) as Record<string, unknown>;
    const platform =
      typeof record.platform === "string" ? record.platform.trim() : "";
    const url = typeof record.url === "string" ? record.url.trim() : "";

    if (platform === "" || platform.length > SITE_PROFILE_LIMITS.platform) {
      errors.push({
        field: `socialLinks[${index}].platform`,
        message: `platform is required and must be at most ${SITE_PROFILE_LIMITS.platform} characters.`
      });
      return;
    }

    if (url.length > SITE_PROFILE_LIMITS.url || !isSafeSocialUrl(url)) {
      // Refused, not sanitized: this href is rendered on every public page.
      errors.push({
        field: `socialLinks[${index}].url`,
        message: "url must be an absolute http(s) URL."
      });
      return;
    }

    // One row per platform. Two "facebook" entries is a data-entry mistake with
    // no sensible render, and silently keeping both puts the choice in the
    // template.
    const key = platform.toLowerCase();
    if (seen.has(key)) {
      errors.push({
        field: `socialLinks[${index}].platform`,
        message: `platform "${platform}" appears more than once.`
      });
      return;
    }
    seen.add(key);

    links.push({ platform, url });
  });

  return links;
}

export function validateSiteProfileInput(
  body: unknown
): SiteProfileValidationResult {
  const errors: ValidationError[] = [];
  const record = (body ?? {}) as Record<string, unknown>;

  const value: SiteProfileInput = {
    tagline: optionalText(
      record.tagline,
      "tagline",
      SITE_PROFILE_LIMITS.tagline,
      errors
    ),
    copyrightNotice: optionalText(
      record.copyrightNotice,
      "copyrightNotice",
      SITE_PROFILE_LIMITS.copyrightNotice,
      errors
    ),
    logoMediaId: optionalUuid(record.logoMediaId, "logoMediaId", errors),
    faviconMediaId: optionalUuid(
      record.faviconMediaId,
      "faviconMediaId",
      errors
    ),
    editorialAddress: optionalText(
      record.editorialAddress,
      "editorialAddress",
      SITE_PROFILE_LIMITS.editorialAddress,
      errors
    ),
    contactEmail: optionalText(
      record.contactEmail,
      "contactEmail",
      SITE_PROFILE_LIMITS.contactEmail,
      errors
    ),
    contactPhone: optionalText(
      record.contactPhone,
      "contactPhone",
      SITE_PROFILE_LIMITS.contactPhone,
      errors
    ),
    whatsappNumber: optionalText(
      record.whatsappNumber,
      "whatsappNumber",
      SITE_PROFILE_LIMITS.whatsappNumber,
      errors
    ),
    socialLinks: validateSocialLinks(record.socialLinks, errors)
  };

  if (errors.length > 0) return { valid: false, errors };

  return { valid: true, value };
}
