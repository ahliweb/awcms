/**
 * Pure validation/merge/diff logic for tenant-aware module settings. No I/O
 * here — the application layer (`application/module-settings.ts`) reads the
 * descriptor's `settings.defaults` + the current `awcms_module_settings` row
 * and hands both to these functions, keeping the decision testable without a
 * database.
 */
import {
  findSecretShapedValues,
  findSensitiveKeys
} from "../../_shared/redaction";

export type ModuleSettingsErrorCode =
  | "VALIDATION_ERROR"
  | "SETTINGS_SENSITIVE_KEY_REJECTED"
  | "SETTINGS_SECRET_SHAPED_VALUE_REJECTED";

export type ModuleSettingsValidationResult =
  | { valid: true; value: Record<string, unknown> }
  | { valid: false; code: ModuleSettingsErrorCode; message: string };

/** `value === null` checked before `typeof` narrowing — avoids a CodeQL comparison-between-incompatible-types false positive on the reverse ordering. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || Array.isArray(value)) {
    return false;
  }

  return typeof value === "object";
}

/**
 * Validates a `PATCH .../settings` body: must be a JSON object, and must
 * never contain a secret-shaped key anywhere in it (nested included) — real
 * provider secrets belong in environment variables/a secret manager, never
 * in tenant-writable, DB-stored, admin-readable settings. Also rejects a
 * secret-*shaped value* even under an innocently-named key (e.g. a JWT or
 * `Bearer ...` token pasted into `publicLabel`) — key-name checking alone
 * can't catch that, since the field's name gives no hint of its content.
 */
export function validateModuleSettingsPatch(
  body: unknown
): ModuleSettingsValidationResult {
  if (!isPlainObject(body)) {
    return {
      valid: false,
      code: "VALIDATION_ERROR",
      message: "Settings must be a JSON object."
    };
  }

  const sensitiveKeys = findSensitiveKeys(body);

  if (sensitiveKeys.length > 0) {
    return {
      valid: false,
      code: "SETTINGS_SENSITIVE_KEY_REJECTED",
      message: `Settings cannot contain secret-shaped keys (${sensitiveKeys.join(", ")}). Provider secrets belong in environment variables or a secret manager, not tenant settings.`
    };
  }

  const secretShapedValuePaths = findSecretShapedValues(body);

  if (secretShapedValuePaths.length > 0) {
    return {
      valid: false,
      code: "SETTINGS_SECRET_SHAPED_VALUE_REJECTED",
      message: `Settings cannot contain a credential-shaped value, regardless of the field's name (found at: ${secretShapedValuePaths.join(", ")}). Provider secrets belong in environment variables or a secret manager, not tenant settings.`
    };
  }

  return { valid: true, value: body };
}

/** Effective settings = descriptor defaults, with the tenant's own override taking precedence key-by-key (shallow — the whole value replaces, not a deep JSON-merge-patch). */
export function mergeEffectiveSettings(
  defaults: Record<string, unknown> | undefined,
  tenantOverride: Record<string, unknown> | undefined
): Record<string, unknown> {
  return { ...(defaults ?? {}), ...(tenantOverride ?? {}) };
}

export type ModuleSettingsDiff = {
  addedKeys: string[];
  changedKeys: string[];
  removedKeys: string[];
};

/**
 * Safe diff metadata for the audit trail: which top-level keys were added,
 * changed, or removed between the previous and new tenant override — never
 * the values themselves, so this is safe to log even before redaction runs
 * (belt and suspenders with `recordAuditEvent`'s own redaction).
 */
export function diffModuleSettings(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): ModuleSettingsDiff {
  const beforeKeys = new Set(Object.keys(before));
  const afterKeys = new Set(Object.keys(after));

  const addedKeys = [...afterKeys].filter((key) => !beforeKeys.has(key));
  const removedKeys = [...beforeKeys].filter((key) => !afterKeys.has(key));
  const changedKeys = [...afterKeys].filter(
    (key) =>
      beforeKeys.has(key) &&
      JSON.stringify(before[key]) !== JSON.stringify(after[key])
  );

  return { addedKeys, changedKeys, removedKeys };
}
