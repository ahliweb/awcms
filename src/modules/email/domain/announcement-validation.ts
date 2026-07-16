/**
 * Pure validation for the announcement/notification endpoints (Issue #497).
 * Same shape/style as `email-template-validation.ts` — no I/O here;
 * existence checks (does `roleId`/each `userId` actually exist) happen in
 * the application layer against the database.
 */
import { isKnownEmailTemplateCategory } from "./email-template-categories";

export type ValidationError = {
  field: string;
  message: string;
};

type Result<T> =
  { valid: true; value: T } | { valid: false; errors: ValidationError[] };

export type AnnouncementTarget =
  | { type: "users"; userIds: string[] }
  | { type: "role"; roleId: string }
  | { type: "tenant" };

export type AnnouncementInput = {
  templateKey: string;
  variables: Record<string, string>;
  target: AnnouncementTarget;
  locale?: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_EXPLICIT_USER_IDS = 500;

/** `value === null` checked before `typeof` narrowing — avoids a CodeQL `js/comparison-between-incompatible-types` false positive on the more common `typeof value === "object" && value !== null` ordering (see `email-template-validation.ts`'s `isPlainObject` for the full explanation). Same runtime behavior. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || Array.isArray(value)) {
    return false;
  }

  return typeof value === "object";
}

function validateTarget(
  value: unknown,
  errors: ValidationError[]
): AnnouncementTarget | undefined {
  if (!isPlainObject(value)) {
    errors.push({
      field: "target",
      message: 'target is required, e.g. { "type": "tenant" }.'
    });
    return undefined;
  }

  if (value.type === "tenant") {
    return { type: "tenant" };
  }

  if (value.type === "role") {
    if (typeof value.roleId !== "string" || !UUID_PATTERN.test(value.roleId)) {
      errors.push({
        field: "target.roleId",
        message: 'target.roleId must be a UUID when target.type is "role".'
      });
      return undefined;
    }
    return { type: "role", roleId: value.roleId };
  }

  if (value.type === "users") {
    if (
      !Array.isArray(value.userIds) ||
      value.userIds.length === 0 ||
      value.userIds.length > MAX_EXPLICIT_USER_IDS ||
      !value.userIds.every(
        (id) => typeof id === "string" && UUID_PATTERN.test(id)
      )
    ) {
      errors.push({
        field: "target.userIds",
        message: `target.userIds must be a non-empty array of up to ${MAX_EXPLICIT_USER_IDS} UUIDs when target.type is "users".`
      });
      return undefined;
    }
    return { type: "users", userIds: value.userIds as string[] };
  }

  errors.push({
    field: "target.type",
    message: 'target.type must be one of "users", "role", "tenant".'
  });
  return undefined;
}

function validateVariables(
  value: unknown,
  errors: ValidationError[]
): Record<string, string> | undefined {
  if (value === undefined) {
    return {};
  }

  if (!isPlainObject(value)) {
    errors.push({
      field: "variables",
      message: "variables must be an object of string values."
    });
    return undefined;
  }

  const result: Record<string, string> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") {
      errors.push({
        field: "variables",
        message: `variables.${key} must be a string.`
      });
      continue;
    }
    result[key] = entry;
  }

  return errors.length === 0 ? result : undefined;
}

export function validateAnnouncementInput(
  body: unknown
): Result<AnnouncementInput> {
  const record = (body ?? {}) as Record<string, unknown>;
  const errors: ValidationError[] = [];

  let templateKey: string | undefined;
  if (
    typeof record.templateKey !== "string" ||
    record.templateKey.trim().length === 0
  ) {
    errors.push({ field: "templateKey", message: "templateKey is required." });
  } else if (!isKnownEmailTemplateCategory(record.templateKey)) {
    errors.push({
      field: "templateKey",
      message: `templateKey "${record.templateKey}" is not a recognized category.`
    });
  } else {
    templateKey = record.templateKey;
  }

  const variables = validateVariables(record.variables, errors);
  const target = validateTarget(record.target, errors);

  let locale: string | undefined;
  if (record.locale !== undefined) {
    if (
      typeof record.locale !== "string" ||
      record.locale.trim().length === 0
    ) {
      errors.push({
        field: "locale",
        message: "locale must be a non-empty string."
      });
    } else {
      locale = record.locale;
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      templateKey: templateKey!,
      variables: variables!,
      target: target!,
      locale
    }
  };
}
