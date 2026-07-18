/**
 * Validation for ABAC policy authoring (Issue #171). Pure functions, no I/O —
 * the same posture as `office-validation.ts`: shape/enum checks here, uniqueness
 * (a DB constraint) is enforced downstream and surfaced as 409.
 *
 * `awcms_abac_policies` columns worked within (schema unchanged): policy_code
 * (text, unique per tenant), effect (text CHECK IN 'allow'|'deny'), description
 * (text, nullable), is_active (boolean).
 */
export type ValidationError = { field: string; message: string };

type ValidationResult<T> =
  { valid: true; value: T } | { valid: false; errors: ValidationError[] };

export const ABAC_EFFECTS = ["allow", "deny"] as const;
export type AbacEffect = (typeof ABAC_EFFECTS)[number];

/**
 * A conservative policy-code shape: a leading alphanumeric then alphanumerics
 * plus `.`, `_`, `-`. Bounds the length so a caller can't wedge an unbounded
 * string into the unique index, and keeps codes URL/log-safe.
 */
const POLICY_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const DESCRIPTION_MAX = 500;

export type CreateAbacPolicyInput = {
  policyCode: string;
  effect: AbacEffect;
  description: string | null;
};

function validateEffect(
  value: unknown,
  errors: ValidationError[]
): AbacEffect | undefined {
  if (
    typeof value !== "string" ||
    !ABAC_EFFECTS.includes(value as AbacEffect)
  ) {
    errors.push({
      field: "effect",
      message: `effect must be one of: ${ABAC_EFFECTS.join(", ")}.`
    });
    return undefined;
  }
  return value as AbacEffect;
}

/**
 * `description` accepts a non-empty string (trimmed, length-bounded) or an
 * explicit `null` to clear it. `undefined` means "not provided" and is handled
 * by the caller (kept as null on create, left unchanged on update). An empty /
 * whitespace-only string is normalised to null.
 */
function validateDescription(
  value: unknown,
  errors: ValidationError[]
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") {
    errors.push({
      field: "description",
      message: "description must be a string or null."
    });
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > DESCRIPTION_MAX) {
    errors.push({
      field: "description",
      message: `description must be at most ${DESCRIPTION_MAX} characters.`
    });
    return undefined;
  }
  return trimmed;
}

export function validateCreateAbacPolicyInput(
  body: unknown
): ValidationResult<CreateAbacPolicyInput> {
  const record = (body ?? {}) as Record<string, unknown>;
  const errors: ValidationError[] = [];

  let policyCode = "";
  if (
    typeof record.policyCode !== "string" ||
    record.policyCode.trim().length === 0
  ) {
    errors.push({ field: "policyCode", message: "policyCode is required." });
  } else {
    policyCode = record.policyCode.trim();
    if (!POLICY_CODE_PATTERN.test(policyCode)) {
      errors.push({
        field: "policyCode",
        message:
          "policyCode must start alphanumeric and contain only letters, digits, '.', '_', '-' (max 100 chars)."
      });
    }
  }

  const effect = validateEffect(record.effect, errors);
  const description = validateDescription(record.description, errors);

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    value: {
      policyCode,
      effect: effect!,
      description: description ?? null
    }
  };
}

export type UpdateAbacPolicyInput = {
  effect?: AbacEffect;
  description?: string | null;
  isActive?: boolean;
};

export function validateUpdateAbacPolicyInput(
  body: unknown
): ValidationResult<UpdateAbacPolicyInput> {
  const record = (body ?? {}) as Record<string, unknown>;
  const errors: ValidationError[] = [];
  const value: UpdateAbacPolicyInput = {};

  if (record.effect !== undefined) {
    const effect = validateEffect(record.effect, errors);
    if (effect !== undefined) value.effect = effect;
  }

  if (record.description !== undefined) {
    const description = validateDescription(record.description, errors);
    // A cleared description is represented as null, which we must keep — so
    // only skip assignment when validation itself pushed an error.
    if (errors.length === 0) value.description = description ?? null;
  }

  if (record.isActive !== undefined) {
    if (typeof record.isActive !== "boolean") {
      errors.push({
        field: "isActive",
        message: "isActive must be a boolean."
      });
    } else {
      value.isActive = record.isActive;
    }
  }

  if (errors.length === 0 && Object.keys(value).length === 0) {
    errors.push({
      field: "body",
      message: "Provide at least one of effect, description, isActive."
    });
  }

  if (errors.length > 0) return { valid: false, errors };

  return { valid: true, value };
}
