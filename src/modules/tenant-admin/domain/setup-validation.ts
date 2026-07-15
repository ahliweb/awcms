export type SetupInitializeInput = {
  tenantCode: string;
  tenantName: string;
  officeCode: string;
  officeName: string;
  ownerLoginIdentifier: string;
  ownerPassword: string;
  ownerDisplayName: string;
};

export type ValidationError = { field: string; message: string };

export type SetupInitializeValidationResult =
  | { valid: true; value: SetupInitializeInput }
  | { valid: false; errors: ValidationError[] };

const MIN_PASSWORD_LENGTH = 8;

const REQUIRED_STRING_FIELDS: Array<keyof SetupInitializeInput> = [
  "tenantCode",
  "tenantName",
  "officeCode",
  "officeName",
  "ownerLoginIdentifier",
  "ownerPassword",
  "ownerDisplayName"
];

export function validateSetupInitializeInput(
  body: unknown
): SetupInitializeValidationResult {
  const errors: ValidationError[] = [];
  const record = (body ?? {}) as Record<string, unknown>;

  for (const field of REQUIRED_STRING_FIELDS) {
    const value = record[field];

    if (typeof value !== "string" || value.trim().length === 0) {
      errors.push({ field, message: `${field} is required.` });
    }
  }

  if (
    typeof record.ownerPassword === "string" &&
    record.ownerPassword.length > 0 &&
    record.ownerPassword.length < MIN_PASSWORD_LENGTH
  ) {
    errors.push({
      field: "ownerPassword",
      message: `ownerPassword must be at least ${MIN_PASSWORD_LENGTH} characters.`
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      tenantCode: (record.tenantCode as string).trim(),
      tenantName: (record.tenantName as string).trim(),
      officeCode: (record.officeCode as string).trim(),
      officeName: (record.officeName as string).trim(),
      ownerLoginIdentifier: (record.ownerLoginIdentifier as string).trim(),
      ownerPassword: record.ownerPassword as string,
      ownerDisplayName: (record.ownerDisplayName as string).trim()
    }
  };
}
