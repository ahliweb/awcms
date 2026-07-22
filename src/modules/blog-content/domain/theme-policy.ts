/**
 * Blog theme mode (Issue #542 §Theme Mode: "Support dark/light
 * configuration at schema and rendering level. Respect existing
 * theme/design-token approach if present."). Same three-value set as the
 * base tenant-level theme (`awcms_tenants.default_theme`,
 * `tenant-admin/domain/settings-validation.ts`'s `VALID_THEMES`) —
 * deliberately not redefined as a shared import across modules (this repo
 * has no cross-module domain-constant sharing convention), but kept
 * value-identical so a blog override and the tenant default are always
 * interchangeable.
 */
export type BlogThemeMode = "light" | "dark" | "system";

export const BLOG_THEME_MODES: readonly BlogThemeMode[] = [
  "light",
  "dark",
  "system"
];

export function isBlogThemeMode(value: unknown): value is BlogThemeMode {
  return (
    typeof value === "string" && (BLOG_THEME_MODES as string[]).includes(value)
  );
}

export type ValidationError = {
  field: string;
  message: string;
};

export type UpdateThemeSettingsInput = {
  mode: BlogThemeMode;
};

export type UpdateThemeSettingsValidationResult =
  | { valid: true; value: UpdateThemeSettingsInput }
  | { valid: false; errors: ValidationError[] };

export function validateUpdateThemeSettingsInput(
  body: unknown
): UpdateThemeSettingsValidationResult {
  const record = (body ?? {}) as Record<string, unknown>;

  if (!isBlogThemeMode(record.mode)) {
    return {
      valid: false,
      errors: [
        {
          field: "mode",
          message: `mode must be one of ${BLOG_THEME_MODES.join(", ")}.`
        }
      ]
    };
  }

  return { valid: true, value: { mode: record.mode } };
}
