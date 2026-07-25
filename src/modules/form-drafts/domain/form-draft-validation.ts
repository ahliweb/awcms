/**
 * Pure validation for the form-drafts endpoints (ported from awcms-micro Issue #484). Same
 * shape/style as `tenant-admin/domain/settings-validation.ts` — no I/O here.
 */
export type ValidationError = {
  field: string;
  message: string;
};

type Result<T> =
  { valid: true; value: T } | { valid: false; errors: ValidationError[] };

export type CreateFormDraftInput = {
  moduleKey: string;
  wizardKey: string;
  resourceType: string;
  resourceId?: string;
  currentStep: string;
  payload: Record<string, unknown>;
  expiresAt?: string;
};

export type UpdateFormDraftInput = {
  currentStep?: string;
  payload?: Record<string, unknown>;
  expiresAt?: string | null;
};

// Mirrors the SQL CHECK constraints in sql/062 — keep both in sync.
const KEY_FORMAT = /^[a-z][a-z0-9_]{1,63}$/;
const MAX_RESOURCE_ID_LENGTH = 128;
const MAX_CURRENT_STEP_LENGTH = 64;

/**
 * Payload cannot exceed this size (awcms-micro Issue #484 acceptance criteria: "payload
 * memiliki ukuran maksimum yang eksplisit"). 32KB is generous for a form's
 * worth of scratch field values while still bounding worst-case row/index
 * bloat — this is draft scratch state, not a document/file store.
 */
export const MAX_PAYLOAD_BYTES = 32 * 1024;

/**
 * Field names that must never be persisted in a draft payload (awcms-micro Issue #484:
 * "field yang dilarang ... harus ditolak"). Matched case-insensitively
 * against every key at every nesting depth, tolerant of common separators
 * (apiKey, api_key, api-key all match) — rejecting outright rather than
 * silently redacting, so a caller can't mistake a stripped field for a
 * saved one.
 */
const FORBIDDEN_PAYLOAD_KEY_PATTERNS: readonly RegExp[] = [
  /password/i,
  /token/i,
  /secret/i,
  /credential/i,
  /api[_-]?key/i,
  /private[_-]?key/i
];

/** `value === null` checked before `typeof` narrowing — avoids a CodeQL `js/comparison-between-incompatible-types` false positive on the more common `typeof value === "object" && value !== null` ordering (see `email/domain/email-template-validation.ts`'s `isPlainObject` for the full explanation). Same runtime behavior. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || Array.isArray(value)) {
    return false;
  }

  return typeof value === "object";
}

/**
 * Recursively walks a JSON-serializable value looking for a forbidden key at
 * any depth (including inside arrays of objects). Returns the first
 * offending key path found, or `null` if none.
 */
export function findForbiddenPayloadKey(
  value: unknown,
  path: string = ""
): string | null {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const found = findForbiddenPayloadKey(value[i], `${path}[${i}]`);
      if (found) return found;
    }
    return null;
  }

  if (isPlainObject(value)) {
    for (const [key, nested] of Object.entries(value)) {
      if (FORBIDDEN_PAYLOAD_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
        return path ? `${path}.${key}` : key;
      }
      const found = findForbiddenPayloadKey(
        nested,
        path ? `${path}.${key}` : key
      );
      if (found) return found;
    }
  }

  return null;
}

/** Validates a payload value is a plain JSON object, within size limits, and free of forbidden keys. */
function validatePayload(
  value: unknown,
  errors: ValidationError[]
): Record<string, unknown> | undefined {
  if (!isPlainObject(value)) {
    errors.push({
      field: "payload",
      message: "payload must be a JSON object."
    });
    return undefined;
  }

  const serialized = JSON.stringify(value);

  if (serialized.length > MAX_PAYLOAD_BYTES) {
    errors.push({
      field: "payload",
      message: `payload must not exceed ${MAX_PAYLOAD_BYTES} bytes when serialized.`
    });
    return undefined;
  }

  const forbiddenKey = findForbiddenPayloadKey(value);

  if (forbiddenKey) {
    errors.push({
      field: "payload",
      message: `payload must not contain a field resembling a secret (found "${forbiddenKey}"). Never persist passwords, tokens, credentials, or keys in a draft.`
    });
    return undefined;
  }

  return value;
}

function validateKeyFormat(
  field: string,
  value: unknown,
  errors: ValidationError[]
): string | undefined {
  if (typeof value !== "string" || !KEY_FORMAT.test(value)) {
    errors.push({
      field,
      message: `${field} must be lowercase snake_case, 2-64 characters, starting with a letter.`
    });
    return undefined;
  }
  return value;
}

export function validateCreateFormDraftInput(
  body: unknown
): Result<CreateFormDraftInput> {
  const errors: ValidationError[] = [];
  const record = (body ?? {}) as Record<string, unknown>;

  const moduleKey = validateKeyFormat("moduleKey", record.moduleKey, errors);
  const wizardKey = validateKeyFormat("wizardKey", record.wizardKey, errors);
  const resourceType = validateKeyFormat(
    "resourceType",
    record.resourceType,
    errors
  );

  let resourceId: string | undefined;
  if (record.resourceId !== undefined) {
    if (
      typeof record.resourceId !== "string" ||
      record.resourceId.trim().length === 0 ||
      record.resourceId.length > MAX_RESOURCE_ID_LENGTH
    ) {
      errors.push({
        field: "resourceId",
        message: `resourceId must be a non-empty string up to ${MAX_RESOURCE_ID_LENGTH} characters.`
      });
    } else {
      resourceId = record.resourceId.trim();
    }
  }

  let currentStep: string | undefined;
  if (
    typeof record.currentStep !== "string" ||
    record.currentStep.trim().length === 0 ||
    record.currentStep.length > MAX_CURRENT_STEP_LENGTH
  ) {
    errors.push({
      field: "currentStep",
      message: `currentStep is required and must be up to ${MAX_CURRENT_STEP_LENGTH} characters.`
    });
  } else {
    currentStep = record.currentStep.trim();
  }

  const payload = validatePayload(record.payload, errors);

  let expiresAt: string | undefined;
  if (record.expiresAt !== undefined) {
    if (
      typeof record.expiresAt !== "string" ||
      Number.isNaN(Date.parse(record.expiresAt))
    ) {
      errors.push({
        field: "expiresAt",
        message: "expiresAt must be a valid ISO 8601 timestamp."
      });
    } else {
      expiresAt = record.expiresAt;
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      moduleKey: moduleKey!,
      wizardKey: wizardKey!,
      resourceType: resourceType!,
      resourceId,
      currentStep: currentStep!,
      payload: payload!,
      expiresAt
    }
  };
}

export function validateUpdateFormDraftInput(
  body: unknown
): Result<UpdateFormDraftInput> {
  const errors: ValidationError[] = [];
  const record = (body ?? {}) as Record<string, unknown>;
  const value: UpdateFormDraftInput = {};

  if (record.currentStep !== undefined) {
    if (
      typeof record.currentStep !== "string" ||
      record.currentStep.trim().length === 0 ||
      record.currentStep.length > MAX_CURRENT_STEP_LENGTH
    ) {
      errors.push({
        field: "currentStep",
        message: `currentStep must be a non-empty string up to ${MAX_CURRENT_STEP_LENGTH} characters.`
      });
    } else {
      value.currentStep = record.currentStep.trim();
    }
  }

  if (record.payload !== undefined) {
    const payload = validatePayload(record.payload, errors);
    if (payload !== undefined) {
      value.payload = payload;
    }
  }

  if (record.expiresAt !== undefined) {
    if (
      record.expiresAt !== null &&
      (typeof record.expiresAt !== "string" ||
        Number.isNaN(Date.parse(record.expiresAt)))
    ) {
      errors.push({
        field: "expiresAt",
        message: "expiresAt must be a valid ISO 8601 timestamp or null."
      });
    } else {
      value.expiresAt = record.expiresAt;
    }
  }

  if (errors.length === 0 && Object.keys(value).length === 0) {
    errors.push({
      field: "body",
      message: "Provide at least one of currentStep, payload, expiresAt."
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, value };
}
