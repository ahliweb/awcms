/**
 * The SHAPE of the body of `POST /api/v1/booking/blocks` (Issue #1012,
 * ADR-0135). Pure -- no database, no clock.
 *
 * Bodies are STRICT, as in `booking-validation.ts`: only the five known keys, so
 * a client cannot assert a status, a release stamp or an actor. Whether the
 * values are well-formed (UUIDs, calendar dates, the closed reason list, the
 * 366-night span) is `validateCreateBlock` in `booking-stay.ts`; whether the
 * dates exist in the resource's zone is the service's.
 */
import type { ValidationIssue } from "./booking-allocation";
import type { CreateBlockInput } from "./booking-stay";

const CREATE_BLOCK_KEYS = [
  "resourceId",
  "unitId",
  "fromDate",
  "toDate",
  "reasonCode"
] as const;

export function parseCreateBlockBody(
  raw: unknown
):
  | { valid: true; value: CreateBlockInput }
  | { valid: false; errors: ValidationIssue[] } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      valid: false,
      errors: [{ field: "body", message: "Body must be a JSON object." }]
    };
  }

  const record = raw as Record<string, unknown>;
  const errors: ValidationIssue[] = [];

  for (const key of Object.keys(record)) {
    if (!(CREATE_BLOCK_KEYS as readonly string[]).includes(key)) {
      errors.push({ field: key, message: `${key} is not accepted.` });
    }
  }

  for (const key of [
    "resourceId",
    "fromDate",
    "toDate",
    "reasonCode"
  ] as const) {
    if (typeof record[key] !== "string") {
      errors.push({ field: key, message: `${key} is required (a string).` });
    }
  }

  if (
    record.unitId !== undefined &&
    record.unitId !== null &&
    typeof record.unitId !== "string"
  ) {
    errors.push({ field: "unitId", message: "unitId must be a UUID or null." });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      resourceId: String(record.resourceId).toLowerCase(),
      unitId:
        typeof record.unitId === "string" ? record.unitId.toLowerCase() : null,
      fromDate: String(record.fromDate),
      toDate: String(record.toDate),
      reasonCode: String(record.reasonCode)
    }
  };
}
