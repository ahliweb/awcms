export type ValidationError = { field: string; message: string };

export type ValidationResult<T> =
  { valid: true; value: T } | { valid: false; errors: ValidationError[] };

export const PARTY_TYPES = ["person", "organization"] as const;
export type PartyType = (typeof PARTY_TYPES)[number];

export const PARTY_RISK_LEVELS = ["low", "normal", "high"] as const;
export type PartyRiskLevel = (typeof PARTY_RISK_LEVELS)[number];

export const PARTY_VERIFICATION_STATUSES = [
  "unverified",
  "pending",
  "verified"
] as const;
export type PartyVerificationStatus =
  (typeof PARTY_VERIFICATION_STATUSES)[number];

/** `merged` is never settable directly — only a future merge workflow transitions a profile to `merged`. */
export const PARTY_SETTABLE_STATUSES = ["active", "inactive"] as const;
export type PartySettableStatus = (typeof PARTY_SETTABLE_STATUSES)[number];

const MAX_DISPLAY_NAME_LENGTH = 200;
const MAX_LEGAL_NAME_LENGTH = 200;

export type CreatePartyInput = {
  profileType: PartyType;
  displayName: string;
  legalName: string | null;
  riskLevel: PartyRiskLevel;
};

export function validateCreatePartyInput(
  body: unknown
): ValidationResult<CreatePartyInput> {
  const record = (body ?? {}) as Record<string, unknown>;
  const errors: ValidationError[] = [];

  if (
    typeof record.profileType !== "string" ||
    !PARTY_TYPES.includes(record.profileType as PartyType)
  ) {
    errors.push({
      field: "profileType",
      message: "profileType must be one of: person, organization."
    });
  }

  if (
    typeof record.displayName !== "string" ||
    record.displayName.trim().length === 0
  ) {
    errors.push({ field: "displayName", message: "displayName is required." });
  } else if (record.displayName.trim().length > MAX_DISPLAY_NAME_LENGTH) {
    errors.push({
      field: "displayName",
      message: `displayName must be at most ${MAX_DISPLAY_NAME_LENGTH} characters.`
    });
  }

  let legalName: string | null = null;

  if (record.legalName !== undefined && record.legalName !== null) {
    if (
      typeof record.legalName !== "string" ||
      record.legalName.trim().length > MAX_LEGAL_NAME_LENGTH
    ) {
      errors.push({
        field: "legalName",
        message: `legalName must be a string of at most ${MAX_LEGAL_NAME_LENGTH} characters.`
      });
    } else {
      legalName = record.legalName.trim() || null;
    }
  }

  let riskLevel: PartyRiskLevel = "normal";

  if (record.riskLevel !== undefined) {
    if (
      typeof record.riskLevel !== "string" ||
      !PARTY_RISK_LEVELS.includes(record.riskLevel as PartyRiskLevel)
    ) {
      errors.push({
        field: "riskLevel",
        message: "riskLevel must be one of: low, normal, high."
      });
    } else {
      riskLevel = record.riskLevel as PartyRiskLevel;
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      profileType: record.profileType as PartyType,
      displayName: (record.displayName as string).trim(),
      legalName,
      riskLevel
    }
  };
}

export type UpdatePartyInput = {
  displayName?: string;
  legalName?: string | null;
  riskLevel?: PartyRiskLevel;
  verificationStatus?: PartyVerificationStatus;
  status?: PartySettableStatus;
};

export function validateUpdatePartyInput(
  body: unknown
): ValidationResult<UpdatePartyInput> {
  const record = (body ?? {}) as Record<string, unknown>;
  const errors: ValidationError[] = [];
  const value: UpdatePartyInput = {};

  if (record.displayName !== undefined) {
    if (
      typeof record.displayName !== "string" ||
      record.displayName.trim().length === 0 ||
      record.displayName.trim().length > MAX_DISPLAY_NAME_LENGTH
    ) {
      errors.push({
        field: "displayName",
        message: `displayName must be a non-empty string of at most ${MAX_DISPLAY_NAME_LENGTH} characters.`
      });
    } else {
      value.displayName = record.displayName.trim();
    }
  }

  if (record.legalName !== undefined) {
    if (record.legalName === null) {
      value.legalName = null;
    } else if (
      typeof record.legalName !== "string" ||
      record.legalName.trim().length > MAX_LEGAL_NAME_LENGTH
    ) {
      errors.push({
        field: "legalName",
        message: `legalName must be a string of at most ${MAX_LEGAL_NAME_LENGTH} characters, or null.`
      });
    } else {
      value.legalName = record.legalName.trim() || null;
    }
  }

  if (record.riskLevel !== undefined) {
    if (
      typeof record.riskLevel !== "string" ||
      !PARTY_RISK_LEVELS.includes(record.riskLevel as PartyRiskLevel)
    ) {
      errors.push({
        field: "riskLevel",
        message: "riskLevel must be one of: low, normal, high."
      });
    } else {
      value.riskLevel = record.riskLevel as PartyRiskLevel;
    }
  }

  if (record.verificationStatus !== undefined) {
    if (
      typeof record.verificationStatus !== "string" ||
      !PARTY_VERIFICATION_STATUSES.includes(
        record.verificationStatus as PartyVerificationStatus
      )
    ) {
      errors.push({
        field: "verificationStatus",
        message:
          "verificationStatus must be one of: unverified, pending, verified."
      });
    } else {
      value.verificationStatus =
        record.verificationStatus as PartyVerificationStatus;
    }
  }

  if (record.status !== undefined) {
    if (
      typeof record.status !== "string" ||
      !PARTY_SETTABLE_STATUSES.includes(record.status as PartySettableStatus)
    ) {
      errors.push({
        field: "status",
        message: "status must be one of: active, inactive."
      });
    } else {
      value.status = record.status as PartySettableStatus;
    }
  }

  if (Object.keys(value).length === 0) {
    errors.push({
      field: "body",
      message: "At least one updatable field must be provided."
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, value };
}
