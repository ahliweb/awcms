/**
 * Small response helpers the `tax` routes share, so the same failure is spelled
 * the same way everywhere (ADR-0127).
 */
import { fail } from "../../_shared/api-response";
import { TaxCalculationError } from "../domain/tax-types";
import type { ValidationError } from "../domain/tax-validation";

/**
 * A payload that tried to supply a computed money field gets its OWN error code,
 * not a generic validation failure: "a client can never submit an authoritative
 * tax amount" is a contract a consumer should be able to test for by name.
 */
export function validationFailure(result: {
  errors: ValidationError[];
  clientSuppliedTaxAmount: boolean;
}): Response {
  return result.clientSuppliedTaxAmount
    ? fail(
        400,
        "TAX_AMOUNT_NOT_ACCEPTED",
        "Tax amounts are computed by the server and cannot be supplied.",
        {},
        result.errors
      )
    : fail(400, "VALIDATION_ERROR", "Request is invalid.", {}, result.errors);
}

/** A calculation the rules cannot answer is a 422, never a silently untaxed document. */
export function calculationFailure(error: unknown): Response | null {
  if (!(error instanceof TaxCalculationError)) return null;

  return fail(422, error.code, error.message);
}

export function idempotencyKeyRequired(request: Request): string | Response {
  const key = request.headers.get("idempotency-key");

  return key
    ? key
    : fail(400, "IDEMPOTENCY_REQUIRED", "Idempotency-Key header is required.");
}

export const NO_RULE_VERSION_RESPONSE = (
  profileCode: string,
  taxDate: string
): Response =>
  fail(
    422,
    "TAX_RULE_VERSION_NOT_FOUND",
    `No published rule version for profile "${profileCode}" covers ${taxDate}.`
  );

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A path `{id}` that is not a uuid cannot name any row. Checked before the query
 * so the database's `22P02` never surfaces as a 500: callers answer 404, the same
 * answer as an id that is well-formed but unknown (and as another tenant's).
 */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
