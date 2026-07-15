export type ValidationError = { field: string; message: string };

export type UpdateTenantSettingsInput = {
  tenantName?: string;
  legalName?: string | null;
  defaultLocale?: "id" | "en" | "ms" | "ar";
  defaultTheme?: "light" | "dark" | "system";
  timezone?: string;
  featureFlags?: Record<string, unknown>;
};

type Result<T> =
  { valid: true; value: T } | { valid: false; errors: ValidationError[] };

const VALID_LOCALES = new Set(["id", "en", "ms", "ar"]);
const VALID_THEMES = new Set(["light", "dark", "system"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || Array.isArray(value)) return false;

  return typeof value === "object";
}

export function validateUpdateTenantSettingsInput(
  body: unknown
): Result<UpdateTenantSettingsInput> {
  const errors: ValidationError[] = [];
  const record = (body ?? {}) as Record<string, unknown>;
  const value: UpdateTenantSettingsInput = {};

  if (record.tenantName !== undefined) {
    if (
      typeof record.tenantName !== "string" ||
      record.tenantName.trim().length === 0
    ) {
      errors.push({
        field: "tenantName",
        message: "tenantName must be a non-empty string."
      });
    } else {
      value.tenantName = record.tenantName.trim();
    }
  }

  if (record.legalName !== undefined) {
    if (record.legalName !== null && typeof record.legalName !== "string") {
      errors.push({
        field: "legalName",
        message: "legalName must be a string or null."
      });
    } else {
      value.legalName =
        typeof record.legalName === "string" ? record.legalName.trim() : null;
    }
  }

  if (record.defaultLocale !== undefined) {
    if (
      typeof record.defaultLocale !== "string" ||
      !VALID_LOCALES.has(record.defaultLocale)
    ) {
      errors.push({
        field: "defaultLocale",
        message: "defaultLocale must be one of id, en, ms, ar."
      });
    } else {
      value.defaultLocale = record.defaultLocale as "id" | "en" | "ms" | "ar";
    }
  }

  if (record.defaultTheme !== undefined) {
    if (
      typeof record.defaultTheme !== "string" ||
      !VALID_THEMES.has(record.defaultTheme)
    ) {
      errors.push({
        field: "defaultTheme",
        message: "defaultTheme must be one of light, dark, system."
      });
    } else {
      value.defaultTheme = record.defaultTheme as "light" | "dark" | "system";
    }
  }

  if (record.timezone !== undefined) {
    if (
      typeof record.timezone !== "string" ||
      record.timezone.trim().length === 0
    ) {
      errors.push({
        field: "timezone",
        message: "timezone must be a non-empty string."
      });
    } else {
      value.timezone = record.timezone.trim();
    }
  }

  if (record.featureFlags !== undefined) {
    if (!isPlainObject(record.featureFlags)) {
      errors.push({
        field: "featureFlags",
        message: "featureFlags must be a JSON object."
      });
    } else {
      value.featureFlags = record.featureFlags;
    }
  }

  if (errors.length === 0 && Object.keys(value).length === 0) {
    errors.push({
      field: "body",
      message:
        "Provide at least one of tenantName, legalName, defaultLocale, defaultTheme, timezone, featureFlags."
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, value };
}
