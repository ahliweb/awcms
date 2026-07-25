/**
 * Per-tenant `site_search` configuration (ADR-0040 §6, ported from awcms-micro
 * Issue #270) — the pure shape + defaults + validation for
 * `awcms_site_search_settings`. Bounds mirror the DB CHECK constraints in
 * sql/064 as an application-layer floor.
 */
export type SiteSearchSettings = {
  enabled: boolean;
  /** `null` = every admitted resource type; otherwise the allow-list of admitted types. */
  enabledResourceTypes: string[] | null;
  resultLimit: number;
  minQueryLength: number;
  suggestionsEnabled: boolean;
  suggestionLimit: number;
  /** Opt-in, minimized query analytics (query HASH + counts only). */
  analyticsEnabled: boolean;
};

export const RESULT_LIMIT_MIN = 1;
export const RESULT_LIMIT_MAX = 100;
export const MIN_QUERY_LENGTH_MIN = 1;
export const MIN_QUERY_LENGTH_MAX = 20;
export const SUGGESTION_LIMIT_MIN = 1;
export const SUGGESTION_LIMIT_MAX = 20;
export const MAX_ENABLED_RESOURCE_TYPES = 50;
export const MAX_RESOURCE_TYPE_LENGTH = 64;

export const DEFAULT_SITE_SEARCH_SETTINGS: SiteSearchSettings = {
  enabled: true,
  enabledResourceTypes: null,
  resultLimit: 20,
  minQueryLength: 2,
  suggestionsEnabled: true,
  suggestionLimit: 8,
  analyticsEnabled: false
};

export type SiteSearchSettingsValidation =
  { ok: true; value: SiteSearchSettings } | { ok: false; errors: string[] };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate an untrusted settings payload (the PUT body). Every field is
 * optional — omitted fields fall back to `base` (the current stored settings, or
 * `DEFAULT_SITE_SEARCH_SETTINGS`), so a partial update is a merge. A
 * `RESOURCE_TYPE` pattern gate keeps `enabledResourceTypes` to safe identifier
 * tokens (they are never interpolated into SQL — always bound — but bounding
 * their shape keeps the config clean and the type filter predictable).
 */
export function validateSiteSearchSettings(
  input: unknown,
  base: SiteSearchSettings = DEFAULT_SITE_SEARCH_SETTINGS
): SiteSearchSettingsValidation {
  if (!isPlainRecord(input)) {
    return { ok: false, errors: ["Body must be a JSON object."] };
  }

  const errors: string[] = [];
  const next: SiteSearchSettings = { ...base };

  if ("enabled" in input) {
    if (typeof input.enabled !== "boolean")
      errors.push("enabled must be a boolean.");
    else next.enabled = input.enabled;
  }

  if ("suggestionsEnabled" in input) {
    if (typeof input.suggestionsEnabled !== "boolean")
      errors.push("suggestionsEnabled must be a boolean.");
    else next.suggestionsEnabled = input.suggestionsEnabled;
  }

  if ("analyticsEnabled" in input) {
    if (typeof input.analyticsEnabled !== "boolean")
      errors.push("analyticsEnabled must be a boolean.");
    else next.analyticsEnabled = input.analyticsEnabled;
  }

  next.resultLimit = validateBoundedInt(
    input,
    "resultLimit",
    base.resultLimit,
    RESULT_LIMIT_MIN,
    RESULT_LIMIT_MAX,
    errors
  );
  next.minQueryLength = validateBoundedInt(
    input,
    "minQueryLength",
    base.minQueryLength,
    MIN_QUERY_LENGTH_MIN,
    MIN_QUERY_LENGTH_MAX,
    errors
  );
  next.suggestionLimit = validateBoundedInt(
    input,
    "suggestionLimit",
    base.suggestionLimit,
    SUGGESTION_LIMIT_MIN,
    SUGGESTION_LIMIT_MAX,
    errors
  );

  if ("enabledResourceTypes" in input) {
    const raw = input.enabledResourceTypes;
    if (raw === null) {
      next.enabledResourceTypes = null;
    } else if (!Array.isArray(raw)) {
      errors.push("enabledResourceTypes must be an array of strings or null.");
    } else if (raw.length > MAX_ENABLED_RESOURCE_TYPES) {
      errors.push(
        `enabledResourceTypes must have at most ${MAX_ENABLED_RESOURCE_TYPES} entries.`
      );
    } else {
      const cleaned: string[] = [];
      for (const entry of raw) {
        if (
          typeof entry !== "string" ||
          !/^[a-z][a-z0-9_]{0,63}$/.test(entry)
        ) {
          errors.push(
            "enabledResourceTypes entries must be snake_case identifiers (<= 64 chars)."
          );
          break;
        }
        if (!cleaned.includes(entry)) cleaned.push(entry);
      }
      if (errors.length === 0) next.enabledResourceTypes = cleaned;
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: next };
}

function validateBoundedInt(
  input: Record<string, unknown>,
  field: keyof SiteSearchSettings,
  fallback: number,
  min: number,
  max: number,
  errors: string[]
): number {
  if (!(field in input)) return fallback;
  const raw = input[field];
  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    errors.push(`${String(field)} must be an integer.`);
    return fallback;
  }
  if (raw < min || raw > max) {
    errors.push(`${String(field)} must be between ${min} and ${max}.`);
    return fallback;
  }
  return raw;
}
