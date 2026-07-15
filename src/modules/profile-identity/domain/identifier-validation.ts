import { IDENTIFIER_TYPES, type IdentifierType } from "./identifier";

export type ValidationError = { field: string; message: string };

export type ValidationResult<T> =
  { valid: true; value: T } | { valid: false; errors: ValidationError[] };

export type AddIdentifierInput = {
  identifierType: IdentifierType;
  value: string;
  isPrimary: boolean;
};

export function validateAddIdentifierInput(
  body: unknown
): ValidationResult<AddIdentifierInput> {
  const record = (body ?? {}) as Record<string, unknown>;
  const errors: ValidationError[] = [];

  if (
    typeof record.identifierType !== "string" ||
    !IDENTIFIER_TYPES.includes(record.identifierType as IdentifierType)
  ) {
    errors.push({
      field: "identifierType",
      message: `identifierType must be one of: ${IDENTIFIER_TYPES.join(", ")}.`
    });
  }

  if (typeof record.value !== "string" || record.value.trim().length === 0) {
    errors.push({ field: "value", message: "value is required." });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      identifierType: record.identifierType as IdentifierType,
      value: (record.value as string).trim(),
      isPrimary: record.isPrimary === true
    }
  };
}

export type ResolveProfileQuery = {
  identifierType: IdentifierType;
  value: string;
};

export function validateResolveProfileQuery(query: {
  type: string | null;
  value: string | null;
}): ValidationResult<ResolveProfileQuery> {
  const errors: ValidationError[] = [];

  if (!query.type || !IDENTIFIER_TYPES.includes(query.type as IdentifierType)) {
    errors.push({
      field: "type",
      message: `type must be one of: ${IDENTIFIER_TYPES.join(", ")}.`
    });
  }

  if (!query.value || query.value.trim().length === 0) {
    errors.push({ field: "value", message: "value is required." });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      identifierType: query.type as IdentifierType,
      value: query.value!.trim()
    }
  };
}
