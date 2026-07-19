/**
 * Business-scope assignment domain rules (Issue #180, epic #177 Wave 2
 * authorization). Ported verbatim from awcms-mini
 * (`identity-access/domain/business-scope-assignment.ts`, Issue #746) — pure
 * functions only, no I/O, no database. "Structural validation here,
 * ABAC/persistence elsewhere" — the same split the rest of this module's
 * domain layer uses.
 */
import { TENANT_WIDE_SCOPE_TYPE } from "./access-control";

const MAX_TEXT_FIELD_LENGTH = 2000;
const SCOPE_TYPE_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * scope_type values that must NEVER be STORED as an assignment scope (issue
 * #180 review F2). `TENANT_WIDE_SCOPE_TYPE` ("tenant") is a coverage SENTINEL
 * that `business-scope-facts.ts` short-circuits to unconditional tenant-wide
 * coverage WITHOUT calling the hierarchy port — so a permissive derived
 * adapter must never be able to mint a stored `tenant` grant that bypasses
 * scope validation. Rejected here (structural), independent of any resolver.
 */
const RESERVED_SCOPE_TYPES: ReadonlySet<string> = new Set([
  TENANT_WIDE_SCOPE_TYPE
]);

export type BusinessScopeAssignmentStatus = "active" | "expired" | "revoked";

export type BusinessScopeAssignmentValidationError = {
  field: string;
  message: string;
};

export type CreateBusinessScopeAssignmentInput = {
  tenantUserId: string;
  roleId: string | null;
  scopeType: string;
  scopeId: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  isTemporary: boolean;
  reason: string | null;
};

/**
 * Structural validation only — NOT an ABAC/authorization check, NOT scope
 * resolution (that is `BusinessScopeHierarchyPort`, applied separately by
 * `application/business-scope-assignment-service.ts`).
 */
export function validateCreateBusinessScopeAssignmentInput(
  input: CreateBusinessScopeAssignmentInput
): BusinessScopeAssignmentValidationError[] {
  const errors: BusinessScopeAssignmentValidationError[] = [];

  if (!input.scopeType || !SCOPE_TYPE_PATTERN.test(input.scopeType)) {
    errors.push({
      field: "scopeType",
      message:
        'scopeType is required and must be lowercase snake_case (e.g. "office").'
    });
  } else if (RESERVED_SCOPE_TYPES.has(input.scopeType)) {
    errors.push({
      field: "scopeType",
      message: `scopeType "${input.scopeType}" is reserved and cannot be assigned directly.`
    });
  }

  if (!input.scopeId) {
    errors.push({ field: "scopeId", message: "scopeId is required." });
  }

  if (Number.isNaN(input.effectiveFrom.getTime())) {
    errors.push({
      field: "effectiveFrom",
      message: "effectiveFrom must be a valid date."
    });
  }

  if (input.effectiveTo !== null) {
    if (Number.isNaN(input.effectiveTo.getTime())) {
      errors.push({
        field: "effectiveTo",
        message: "effectiveTo must be a valid date when provided."
      });
    } else if (input.effectiveTo <= input.effectiveFrom) {
      errors.push({
        field: "effectiveTo",
        message: "effectiveTo must be after effectiveFrom."
      });
    }
  }

  // "A temporary assignment must have an end date" (issue #180 scope,
  // mirrored by the migration's own CHECK constraint — validated here too so
  // the caller gets a clean 400 instead of a raw constraint violation).
  if (input.isTemporary && input.effectiveTo === null) {
    errors.push({
      field: "effectiveTo",
      message: "effectiveTo is required when isTemporary is true."
    });
  }

  if (input.reason !== null && input.reason.length > MAX_TEXT_FIELD_LENGTH) {
    errors.push({
      field: "reason",
      message: `reason must be at most ${MAX_TEXT_FIELD_LENGTH} characters.`
    });
  }

  return errors;
}

export type RevokeBusinessScopeAssignmentInput = {
  revokeReason: string;
};

export function validateRevokeBusinessScopeAssignmentInput(
  input: RevokeBusinessScopeAssignmentInput
): BusinessScopeAssignmentValidationError[] {
  const errors: BusinessScopeAssignmentValidationError[] = [];

  if (!input.revokeReason || input.revokeReason.trim().length === 0) {
    errors.push({
      field: "revokeReason",
      message: "revokeReason is required."
    });
  } else if (input.revokeReason.length > MAX_TEXT_FIELD_LENGTH) {
    errors.push({
      field: "revokeReason",
      message: `revokeReason must be at most ${MAX_TEXT_FIELD_LENGTH} characters.`
    });
  }

  return errors;
}

/**
 * Whether an assignment ROW is currently in force — checked against `now`,
 * not `status` alone ("status is a cache, the timestamp is the real gate").
 * An `active`-status row whose `effectiveTo` has passed, or whose
 * `effectiveFrom` is still in the future, is NOT currently in force. This is
 * what makes revocation/expiry take effect IMMEDIATELY at authorization time
 * (issue #180: "Revocation/expiry langsung memengaruhi authorization"),
 * without waiting for the batch expiry job to flip `status`.
 */
export function isBusinessScopeAssignmentCurrentlyActive(
  assignment: {
    status: BusinessScopeAssignmentStatus;
    effectiveFrom: Date;
    effectiveTo: Date | null;
  },
  now: Date
): boolean {
  if (assignment.status !== "active") {
    return false;
  }
  if (now < assignment.effectiveFrom) {
    return false;
  }
  if (assignment.effectiveTo !== null && now >= assignment.effectiveTo) {
    return false;
  }
  return true;
}
