/**
 * Legal hold domain rules (ported from awcms-micro Issue #745, ADR-0037). Pure
 * functions only — no I/O, no database — so the critical invariant "legal hold
 * overrides ordinary retention/purge and cannot be silently bypassed by tenant
 * policy" is testable in complete isolation from Postgres, and so
 * `application/dry-run-planner.ts`/`application/archive-purge-job.ts` both call
 * through this SAME module rather than each re-deriving the precedence rule
 * slightly differently.
 *
 * Deliberate design choice: a hold's `endsAt` is REPORTING metadata only (an
 * operator's "expected review date"), never an automatic-expiry mechanism —
 * `isLegalHoldActive` only looks at `status`. A hold that "expires" unattended
 * must not silently stop protecting data (that would be a data-loss risk if the
 * underlying legal matter is still open); a human must take the explicit,
 * permission-gated, audited `release` action
 * (`application/legal-hold-service.ts`) for a hold to stop applying — this IS
 * "default-deny release": absent an explicit release, the hold's default state
 * is "still applies".
 */

export type LegalHoldStatus = "active" | "released";

export type LegalHoldRecord = {
  id: string;
  tenantId: string;
  /** `null` = applies to every registered descriptor for this tenant (a broad/litigation hold); a specific descriptor key = narrower. */
  descriptorKey: string | null;
  status: LegalHoldStatus;
};

/** See file header — `endsAt` is intentionally not consulted here. */
export function isLegalHoldActive(
  hold: Pick<LegalHoldRecord, "status">
): boolean {
  return hold.status === "active";
}

export type LegalHoldEvaluation = {
  held: boolean;
  matchedHoldIds: string[];
};

/**
 * Whether ANY active hold in `holds` applies to `descriptorKey` for this
 * tenant. `holds` must already be pre-filtered to the tenant in question
 * (callers fetch via `withTenant`, RLS confines the query to one tenant) — this
 * function does not itself check `tenantId` equality, it trusts its caller's
 * query already scoped that.
 */
export function evaluateLegalHoldForDescriptor(
  holds: readonly LegalHoldRecord[],
  descriptorKey: string
): LegalHoldEvaluation {
  const matched = holds.filter(
    (hold) =>
      isLegalHoldActive(hold) &&
      (hold.descriptorKey === null || hold.descriptorKey === descriptorKey)
  );

  return {
    held: matched.length > 0,
    matchedHoldIds: matched.map((hold) => hold.id)
  };
}

const MIN_REASON_LENGTH = 10;
const MAX_TEXT_FIELD_LENGTH = 2000;

export type CreateLegalHoldInput = {
  descriptorKey: string | null;
  scopeDescription: string;
  reason: string;
  authorityReference: string;
  endsAt: Date | null;
};

export type LegalHoldValidationError = { field: string; message: string };

/**
 * Structural validation only (non-empty, bounded length, sane date) — NOT an
 * ABAC/authorization check (that is `authorizeInTransaction`, applied
 * separately at the API layer, skill `awcms-abac-guard`). Kept deliberately
 * strict on `reason`/`authorityReference` length: a hold's own reason is the
 * thing that later justifies withholding data from a tenant's own purge request
 * — an empty or trivially short reason defeats that evidentiary purpose.
 */
export function validateCreateLegalHoldInput(
  input: CreateLegalHoldInput
): LegalHoldValidationError[] {
  const errors: LegalHoldValidationError[] = [];

  if (!input.scopeDescription || input.scopeDescription.trim().length === 0) {
    errors.push({
      field: "scopeDescription",
      message: "scopeDescription is required."
    });
  } else if (input.scopeDescription.length > MAX_TEXT_FIELD_LENGTH) {
    errors.push({
      field: "scopeDescription",
      message: `scopeDescription must be at most ${MAX_TEXT_FIELD_LENGTH} characters.`
    });
  }

  if (!input.reason || input.reason.trim().length < MIN_REASON_LENGTH) {
    errors.push({
      field: "reason",
      message: `reason is required and must be at least ${MIN_REASON_LENGTH} characters.`
    });
  } else if (input.reason.length > MAX_TEXT_FIELD_LENGTH) {
    errors.push({
      field: "reason",
      message: `reason must be at most ${MAX_TEXT_FIELD_LENGTH} characters.`
    });
  }

  if (
    !input.authorityReference ||
    input.authorityReference.trim().length === 0
  ) {
    errors.push({
      field: "authorityReference",
      message:
        "authorityReference is required (e.g. a court order or regulator reference number)."
    });
  } else if (input.authorityReference.length > MAX_TEXT_FIELD_LENGTH) {
    errors.push({
      field: "authorityReference",
      message: `authorityReference must be at most ${MAX_TEXT_FIELD_LENGTH} characters.`
    });
  }

  if (input.descriptorKey !== null && input.descriptorKey.trim().length === 0) {
    errors.push({
      field: "descriptorKey",
      message:
        "descriptorKey must be null (tenant-wide hold) or a non-empty descriptor key."
    });
  }

  if (input.endsAt !== null && Number.isNaN(input.endsAt.getTime())) {
    errors.push({
      field: "endsAt",
      message: "endsAt must be a valid date when provided."
    });
  }

  return errors;
}

export type ReleaseLegalHoldInput = {
  releaseReason: string;
};

export function validateReleaseLegalHoldInput(
  input: ReleaseLegalHoldInput
): LegalHoldValidationError[] {
  const errors: LegalHoldValidationError[] = [];

  if (
    !input.releaseReason ||
    input.releaseReason.trim().length < MIN_REASON_LENGTH
  ) {
    errors.push({
      field: "releaseReason",
      message: `releaseReason is required and must be at least ${MIN_REASON_LENGTH} characters.`
    });
  } else if (input.releaseReason.length > MAX_TEXT_FIELD_LENGTH) {
    errors.push({
      field: "releaseReason",
      message: `releaseReason must be at most ${MAX_TEXT_FIELD_LENGTH} characters.`
    });
  }

  return errors;
}
