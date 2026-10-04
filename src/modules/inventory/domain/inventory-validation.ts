/**
 * Request validation for the stock ledger (Issue #887, ADR-0126).
 *
 * Pure — no database, no config. Three properties matter more than the field
 * checks themselves:
 *
 * 1. **Strict bodies.** Every validator rejects a key it does not know. That is
 *    how "clients can never assert a balance" is enforced at the edge and not
 *    just by omission: `{"onHand": 40}` or `{"balanceAfter": 40}` on a movement
 *    is a 400 naming the field, not a value silently ignored — and silently
 *    ignored is how a client comes to believe it set one.
 * 2. **Event-safe identifiers.** `itemRef` and the source identity travel in
 *    domain-event payloads, and `appendDomainEvent` HARD-REJECTS a payload that
 *    contains a credential-shaped value (a JWT, a PEM block…). An opaque
 *    consumer reference that happened to look like one would turn a legitimate
 *    stock posting into a 500 from inside the transaction. So the same
 *    detector runs here, at the edge, and answers 400 instead.
 * 3. **The type owns the sign.** The request carries a positive `quantity` and
 *    the movement type decides direction; only an adjustment carries a signed
 *    `quantityDelta`.
 */
import { createHash } from "node:crypto";

import { findSecretShapedValues } from "../../_shared/redaction";
import { normalizeQuantityInput, quantitySign } from "./inventory-quantity";
import {
  DEFAULT_UNIT_CODE,
  isLocationStatus,
  isNegativeStockPolicy,
  NEGATIVE_STOCK_POLICIES,
  POSTABLE_MOVEMENT_TYPES,
  type LocationStatus,
  type MovementOperation,
  type MovementType,
  type NegativeStockPolicy,
  type PostableOrOpeningType,
  RESERVED_SOURCE_TYPES
} from "./inventory-types";

export type ValidationError = { field: string; message: string };

export type Validated<T> =
  { valid: true; value: T } | { valid: false; errors: ValidationError[] };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Mirror the `CHECK` constraints in `sql/169`, so the two cannot disagree. */
export const INVENTORY_LIMITS = {
  locationCode: 64,
  locationName: 200,
  itemRef: 200,
  sourceId: 200,
  sourceLine: 64,
  note: 500,
  reasonCode: 64,
  /** A client clock may run ahead of ours; beyond this it is a bad value. */
  occurredAtSkewMs: 5 * 60 * 1000
} as const;

const LOCATION_CODE_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,63}$/;
const ITEM_TYPE_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/;
const UNIT_CODE_PATTERN = /^[a-z][a-z0-9_.-]{0,31}$/;
const REASON_CODE_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/;
const SOURCE_TYPE_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/;
// No `/`, `+`, `=` — the alphabet of a bearer token — so an opaque reference
// cannot be mistaken for a credential by the event-payload guard.
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;

type Body = Record<string, unknown>;

function asBody(
  value: unknown,
  allowed: readonly string[],
  errors: ValidationError[]
): Body | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    errors.push({ field: "body", message: "Body must be a JSON object." });
    return null;
  }

  const body = value as Body;

  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) {
      errors.push({
        field: key,
        message: `${key} is not an accepted field. A balance is derived from movements and can never be asserted by a client.`
      });
    }
  }

  return body;
}

function requiredUuid(
  body: Body,
  field: string,
  errors: ValidationError[]
): string {
  const value = body[field];

  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    errors.push({ field, message: `${field} must be a UUID.` });
    return "";
  }

  return value.toLowerCase();
}

function optionalUuid(
  body: Body,
  field: string,
  errors: ValidationError[]
): string | null {
  const value = body[field];

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    errors.push({ field, message: `${field} must be a UUID or null.` });
    return null;
  }

  return value.toLowerCase();
}

function patterned(
  value: unknown,
  field: string,
  pattern: RegExp,
  max: number,
  errors: ValidationError[]
): string {
  if (typeof value !== "string" || value.length === 0) {
    errors.push({ field, message: `${field} is required.` });
    return "";
  }

  if (value.length > max || !pattern.test(value)) {
    errors.push({
      field,
      message: `${field} must match ${pattern.source} and be at most ${max} characters.`
    });
    return "";
  }

  return value;
}

function optionalNote(
  value: unknown,
  errors: ValidationError[]
): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    errors.push({ field: "note", message: "note must be a string or null." });
    return null;
  }

  const trimmed = value.trim();

  if (trimmed === "") {
    return null;
  }

  if (trimmed.length > INVENTORY_LIMITS.note) {
    errors.push({
      field: "note",
      message: `note must be at most ${INVENTORY_LIMITS.note} characters.`
    });
    return null;
  }

  return trimmed;
}

function reasonCode(
  value: unknown,
  required: boolean,
  errors: ValidationError[]
): string | null {
  if (value === undefined || value === null) {
    if (required) {
      errors.push({
        field: "reasonCode",
        message: "reasonCode is required."
      });
    }
    return null;
  }

  return (
    patterned(
      value,
      "reasonCode",
      REASON_CODE_PATTERN,
      INVENTORY_LIMITS.reasonCode,
      errors
    ) || null
  );
}

function unitCode(value: unknown, errors: ValidationError[]): string {
  if (value === undefined || value === null) {
    return DEFAULT_UNIT_CODE;
  }

  return (
    patterned(value, "unitCode", UNIT_CODE_PATTERN, 32, errors) ||
    DEFAULT_UNIT_CODE
  );
}

function occurredAt(
  value: unknown,
  now: Date,
  errors: ValidationError[]
): Date | null {
  if (value === undefined || value === null) {
    return null;
  }

  const parsed = typeof value === "string" ? new Date(value) : null;

  if (
    parsed === null ||
    Number.isNaN(parsed.getTime()) ||
    !/^\d{4}-\d{2}-\d{2}T/.test(value as string)
  ) {
    errors.push({
      field: "occurredAt",
      message: "occurredAt must be an ISO-8601 timestamp."
    });
    return null;
  }

  if (parsed.getTime() > now.getTime() + INVENTORY_LIMITS.occurredAtSkewMs) {
    errors.push({
      field: "occurredAt",
      message: "occurredAt must not be in the future."
    });
    return null;
  }

  return parsed;
}

export type SourceIdentity = {
  sourceType: string;
  sourceId: string;
  /** '' when the source has no lines — never null, see `sql/169`. */
  sourceLine: string;
};

function sourceIdentity(
  value: unknown,
  errors: ValidationError[]
): SourceIdentity {
  const empty = { sourceType: "", sourceId: "", sourceLine: "" };

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    errors.push({
      field: "source",
      message:
        "source is required: { type, id, line? } identifies the business document behind this movement."
    });
    return empty;
  }

  const source = value as Body;

  for (const key of Object.keys(source)) {
    if (!["type", "id", "line"].includes(key)) {
      errors.push({
        field: `source.${key}`,
        message: `source.${key} is not an accepted field.`
      });
    }
  }

  const sourceType = patterned(
    source.type,
    "source.type",
    SOURCE_TYPE_PATTERN,
    64,
    errors
  );

  if (RESERVED_SOURCE_TYPES.includes(sourceType)) {
    errors.push({
      field: "source.type",
      message: `source.type "${sourceType}" is reserved for the server.`
    });
  }
  const sourceId = patterned(
    source.id,
    "source.id",
    OPAQUE_ID_PATTERN,
    INVENTORY_LIMITS.sourceId,
    errors
  );
  const sourceLine =
    source.line === undefined || source.line === null || source.line === ""
      ? ""
      : patterned(
          source.line,
          "source.line",
          OPAQUE_ID_PATTERN,
          INVENTORY_LIMITS.sourceLine,
          errors
        );

  return { sourceType, sourceId, sourceLine };
}

/**
 * Last gate before an identifier reaches an event payload: if the shared
 * secret-shape detector would flag it, refuse it HERE as a 400 rather than
 * letting `appendDomainEvent` throw from inside the posting transaction.
 */
function refuseSecretShapedIdentifiers(
  identifiers: Record<string, string>,
  errors: ValidationError[]
): void {
  for (const path of findSecretShapedValues(identifiers)) {
    errors.push({
      field: path,
      message: `${path} looks like a credential and cannot be used as an opaque reference.`
    });
  }
}

function finish<T>(errors: ValidationError[], value: T): Validated<T> {
  return errors.length > 0 ? { valid: false, errors } : { valid: true, value };
}

// --- Movements ---------------------------------------------------------------

export type PostMovementInput = {
  locationId: string;
  itemType: string;
  itemRef: string;
  unitCode: string;
  movementType: PostableOrOpeningType;
  /** Canonical, strictly positive decimal text. */
  quantity: string;
  source: SourceIdentity;
  occurredAt: Date | null;
  reasonCode: string | null;
  note: string | null;
};

export function validatePostMovementInput(
  raw: unknown,
  now: Date = new Date()
): Validated<PostMovementInput> {
  return validateMovementBody(raw, now, POSTABLE_MOVEMENT_TYPES);
}

function validateMovementBody(
  raw: unknown,
  now: Date,
  allowedTypes: readonly string[]
): Validated<PostMovementInput> {
  const errors: ValidationError[] = [];
  const body = asBody(
    raw,
    [
      "locationId",
      "itemType",
      "itemRef",
      "unitCode",
      "movementType",
      "quantity",
      "source",
      "occurredAt",
      "reasonCode",
      "note"
    ],
    errors
  );

  if (!body) {
    return finish(errors, null as never);
  }

  const locationId = requiredUuid(body, "locationId", errors);
  const itemType = patterned(
    body.itemType,
    "itemType",
    ITEM_TYPE_PATTERN,
    64,
    errors
  );
  const itemRef = patterned(
    body.itemRef,
    "itemRef",
    OPAQUE_ID_PATTERN,
    INVENTORY_LIMITS.itemRef,
    errors
  );

  if (
    typeof body.movementType !== "string" ||
    !allowedTypes.includes(body.movementType)
  ) {
    errors.push({
      field: "movementType",
      message: `movementType must be one of ${allowedTypes.join(", ")}. Openings, adjustments and transfers have their own endpoints and permissions.`
    });
  }

  const quantity = normalizeQuantityInput(body.quantity);

  if (quantity === null || quantitySign(quantity) !== 1) {
    errors.push({
      field: "quantity",
      message:
        "quantity must be a positive decimal with at most 6 fractional digits; the movement type decides direction."
    });
  }

  const source = sourceIdentity(body.source, errors);
  const unit = unitCode(body.unitCode, errors);

  refuseSecretShapedIdentifiers(
    {
      itemType,
      itemRef,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      sourceLine: source.sourceLine
    },
    errors
  );

  return finish(errors, {
    locationId,
    itemType,
    itemRef,
    unitCode: unit,
    movementType: body.movementType as PostableOrOpeningType,
    quantity: quantity ?? "",
    source,
    occurredAt: occurredAt(body.occurredAt, now, errors),
    reasonCode: reasonCode(body.reasonCode, false, errors),
    note: optionalNote(body.note, errors)
  });
}

/**
 * `POST /api/v1/inventory/openings`. The body is a movement WITHOUT
 * `movementType` (the endpoint fixes it) — naming one is refused rather than
 * ignored, so this cannot be used to smuggle a different type past the
 * permission that guards it.
 */
export function validateOpeningInput(
  raw: unknown,
  now: Date = new Date()
): Validated<PostMovementInput> {
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    if ("movementType" in raw) {
      return {
        valid: false,
        errors: [
          {
            field: "movementType",
            message:
              "movementType is not accepted here; this endpoint posts openings only."
          }
        ]
      };
    }

    return validateMovementBody(
      { ...(raw as Body), movementType: "opening" },
      now,
      ["opening"]
    );
  }

  return validateMovementBody(raw, now, ["opening"]);
}

export type AdjustmentInput = {
  locationId: string;
  itemType: string;
  itemRef: string;
  unitCode: string;
  /** Canonical, SIGNED, non-zero decimal text — the one type that carries its own sign. */
  quantityDelta: string;
  source: SourceIdentity;
  occurredAt: Date | null;
  /** Required: an adjustment has no business document, so its reason IS the audit trail. */
  reasonCode: string;
  note: string | null;
};

export function validateAdjustmentInput(
  raw: unknown,
  now: Date = new Date()
): Validated<AdjustmentInput> {
  const errors: ValidationError[] = [];
  const body = asBody(
    raw,
    [
      "locationId",
      "itemType",
      "itemRef",
      "unitCode",
      "quantityDelta",
      "source",
      "occurredAt",
      "reasonCode",
      "note"
    ],
    errors
  );

  if (!body) {
    return finish(errors, null as never);
  }

  const locationId = requiredUuid(body, "locationId", errors);
  const itemType = patterned(
    body.itemType,
    "itemType",
    ITEM_TYPE_PATTERN,
    64,
    errors
  );
  const itemRef = patterned(
    body.itemRef,
    "itemRef",
    OPAQUE_ID_PATTERN,
    INVENTORY_LIMITS.itemRef,
    errors
  );
  const quantityDelta = normalizeQuantityInput(body.quantityDelta);

  if (quantityDelta === null || quantitySign(quantityDelta) === 0) {
    errors.push({
      field: "quantityDelta",
      message:
        "quantityDelta must be a non-zero signed decimal with at most 6 fractional digits."
    });
  }

  const source = sourceIdentity(body.source, errors);
  const unit = unitCode(body.unitCode, errors);

  refuseSecretShapedIdentifiers(
    {
      itemType,
      itemRef,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      sourceLine: source.sourceLine
    },
    errors
  );

  return finish(errors, {
    locationId,
    itemType,
    itemRef,
    unitCode: unit,
    quantityDelta: quantityDelta ?? "",
    source,
    occurredAt: occurredAt(body.occurredAt, now, errors),
    reasonCode: reasonCode(body.reasonCode, true, errors) ?? "",
    note: optionalNote(body.note, errors)
  });
}

export type ReversalInput = { reasonCode: string; note: string | null };

export function validateReversalInput(raw: unknown): Validated<ReversalInput> {
  const errors: ValidationError[] = [];
  const body = asBody(raw, ["reasonCode", "note"], errors);

  if (!body) {
    return finish(errors, null as never);
  }

  return finish(errors, {
    reasonCode: reasonCode(body.reasonCode, true, errors) ?? "",
    note: optionalNote(body.note, errors)
  });
}

export type TransferInput = {
  fromLocationId: string;
  toLocationId: string;
  itemType: string;
  itemRef: string;
  unitCode: string;
  quantity: string;
  source: SourceIdentity;
  occurredAt: Date | null;
  reasonCode: string | null;
  note: string | null;
};

export function validateTransferInput(
  raw: unknown,
  now: Date = new Date()
): Validated<TransferInput> {
  const errors: ValidationError[] = [];
  const body = asBody(
    raw,
    [
      "fromLocationId",
      "toLocationId",
      "itemType",
      "itemRef",
      "unitCode",
      "quantity",
      "source",
      "occurredAt",
      "reasonCode",
      "note"
    ],
    errors
  );

  if (!body) {
    return finish(errors, null as never);
  }

  const fromLocationId = requiredUuid(body, "fromLocationId", errors);
  const toLocationId = requiredUuid(body, "toLocationId", errors);

  if (fromLocationId !== "" && fromLocationId === toLocationId) {
    errors.push({
      field: "toLocationId",
      message: "A transfer needs two different locations."
    });
  }

  const itemType = patterned(
    body.itemType,
    "itemType",
    ITEM_TYPE_PATTERN,
    64,
    errors
  );
  const itemRef = patterned(
    body.itemRef,
    "itemRef",
    OPAQUE_ID_PATTERN,
    INVENTORY_LIMITS.itemRef,
    errors
  );
  const quantity = normalizeQuantityInput(body.quantity);

  if (quantity === null || quantitySign(quantity) !== 1) {
    errors.push({
      field: "quantity",
      message:
        "quantity must be a positive decimal with at most 6 fractional digits."
    });
  }

  const source = sourceIdentity(body.source, errors);
  const unit = unitCode(body.unitCode, errors);

  refuseSecretShapedIdentifiers(
    {
      itemType,
      itemRef,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      sourceLine: source.sourceLine
    },
    errors
  );

  return finish(errors, {
    fromLocationId,
    toLocationId,
    itemType,
    itemRef,
    unitCode: unit,
    quantity: quantity ?? "",
    source,
    occurredAt: occurredAt(body.occurredAt, now, errors),
    reasonCode: reasonCode(body.reasonCode, false, errors),
    note: optionalNote(body.note, errors)
  });
}

// --- Fingerprint ------------------------------------------------------------

/**
 * SHA-256 over the fields that make two requests "the same posting". Excludes
 * only `occurredAt` (a retry that omits it gets a fresh server default).
 * Everything that changes stock is in, and so are the reason and the note.
 *
 * Key order is fixed by construction (an array, not an object), so the hash does
 * not depend on property enumeration order.
 */
export function movementFingerprint(parts: {
  operation: MovementOperation | "transfer";
  locationIds: readonly string[];
  itemType: string;
  itemRef: string;
  unitCode: string;
  quantity: string;
  source: SourceIdentity;
  /**
   * INCLUDED, unlike `occurredAt`. A retry that changes the reason or the note is
   * not "the same posting": silently replaying it would tell the caller their
   * new reason was recorded when the ledger kept the old one. A different body
   * under one identity is a `SOURCE_CONFLICT`.
   */
  reasonCode: string | null;
  note: string | null;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        parts.operation,
        parts.locationIds,
        parts.itemType,
        parts.itemRef,
        parts.unitCode,
        parts.quantity,
        parts.source.sourceType,
        parts.source.sourceId,
        parts.source.sourceLine,
        parts.reasonCode ?? "",
        parts.note ?? ""
      ])
    )
    .digest("hex");
}

// --- Locations & policy ------------------------------------------------------

export type CreateLocationInput = {
  code: string;
  name: string;
  officeId: string | null;
};

export function validateCreateLocationInput(
  raw: unknown
): Validated<CreateLocationInput> {
  const errors: ValidationError[] = [];
  const body = asBody(raw, ["code", "name", "officeId"], errors);

  if (!body) {
    return finish(errors, null as never);
  }

  const code = patterned(
    body.code,
    "code",
    LOCATION_CODE_PATTERN,
    INVENTORY_LIMITS.locationCode,
    errors
  );
  const name =
    typeof body.name === "string" ? body.name.trim() : ("" as string);

  if (name.length < 1 || name.length > INVENTORY_LIMITS.locationName) {
    errors.push({
      field: "name",
      message: `name is required and at most ${INVENTORY_LIMITS.locationName} characters.`
    });
  }

  return finish(errors, {
    code,
    name,
    officeId: optionalUuid(body, "officeId", errors)
  });
}

export type UpdateLocationInput = {
  name?: string;
  /** `null` clears; `undefined` leaves unchanged. */
  officeId?: string | null;
  status?: LocationStatus;
};

export function validateUpdateLocationInput(
  raw: unknown
): Validated<UpdateLocationInput> {
  const errors: ValidationError[] = [];
  const body = asBody(raw, ["name", "officeId", "status"], errors);

  if (!body) {
    return finish(errors, null as never);
  }

  const value: UpdateLocationInput = {};

  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";

    if (name.length < 1 || name.length > INVENTORY_LIMITS.locationName) {
      errors.push({
        field: "name",
        message: `name must be 1-${INVENTORY_LIMITS.locationName} characters.`
      });
    } else {
      value.name = name;
    }
  }

  if (body.officeId !== undefined) {
    value.officeId = optionalUuid(body, "officeId", errors);
  }

  if (body.status !== undefined) {
    if (isLocationStatus(body.status)) {
      value.status = body.status;
    } else {
      errors.push({
        field: "status",
        message: "status must be active or inactive."
      });
    }
  }

  if (errors.length === 0 && Object.keys(value).length === 0) {
    errors.push({
      field: "body",
      message: "Provide at least one of name, officeId, status."
    });
  }

  return finish(errors, value);
}

export type TenantPolicyInput = {
  defaultNegativeStockPolicy: NegativeStockPolicy;
};

export function validateTenantPolicyInput(
  raw: unknown
): Validated<TenantPolicyInput> {
  const errors: ValidationError[] = [];
  const body = asBody(raw, ["defaultNegativeStockPolicy"], errors);

  if (!body) {
    return finish(errors, null as never);
  }

  if (!isNegativeStockPolicy(body.defaultNegativeStockPolicy)) {
    errors.push({
      field: "defaultNegativeStockPolicy",
      message: `defaultNegativeStockPolicy must be one of ${NEGATIVE_STOCK_POLICIES.join(", ")}.`
    });
  }

  return finish(errors, {
    defaultNegativeStockPolicy:
      body.defaultNegativeStockPolicy as NegativeStockPolicy
  });
}

export type LocationPolicyInput = {
  /** `null` = inherit the tenant default. */
  negativeStockPolicy: NegativeStockPolicy | null;
};

export function validateLocationPolicyInput(
  raw: unknown
): Validated<LocationPolicyInput> {
  const errors: ValidationError[] = [];
  const body = asBody(raw, ["negativeStockPolicy"], errors);

  if (!body) {
    return finish(errors, null as never);
  }

  const value = body.negativeStockPolicy;

  if (value !== null && !isNegativeStockPolicy(value)) {
    errors.push({
      field: "negativeStockPolicy",
      message: `negativeStockPolicy must be one of ${NEGATIVE_STOCK_POLICIES.join(", ")}, or null to inherit.`
    });
  }

  return finish(errors, {
    negativeStockPolicy: value as NegativeStockPolicy | null
  });
}

export type ThresholdInput = {
  locationId: string;
  itemType: string;
  itemRef: string;
  unitCode: string;
  /** `null` removes the threshold. */
  lowStockThreshold: string | null;
};

export function validateThresholdInput(
  raw: unknown
): Validated<ThresholdInput> {
  const errors: ValidationError[] = [];
  const body = asBody(
    raw,
    ["locationId", "itemType", "itemRef", "unitCode", "lowStockThreshold"],
    errors
  );

  if (!body) {
    return finish(errors, null as never);
  }

  const locationId = requiredUuid(body, "locationId", errors);
  const itemType = patterned(
    body.itemType,
    "itemType",
    ITEM_TYPE_PATTERN,
    64,
    errors
  );
  const itemRef = patterned(
    body.itemRef,
    "itemRef",
    OPAQUE_ID_PATTERN,
    INVENTORY_LIMITS.itemRef,
    errors
  );
  let threshold: string | null = null;

  if (body.lowStockThreshold === undefined) {
    errors.push({
      field: "lowStockThreshold",
      message: "lowStockThreshold is required; send null to remove it."
    });
  } else if (body.lowStockThreshold !== null) {
    threshold = normalizeQuantityInput(body.lowStockThreshold);

    if (threshold === null || quantitySign(threshold) < 0) {
      errors.push({
        field: "lowStockThreshold",
        message:
          "lowStockThreshold must be a non-negative decimal with at most 6 fractional digits, or null."
      });
    }
  }

  refuseSecretShapedIdentifiers({ itemType, itemRef }, errors);

  return finish(errors, {
    locationId,
    itemType,
    itemRef,
    unitCode: unitCode(body.unitCode, errors),
    lowStockThreshold: threshold
  });
}

/** Re-exported so callers need one import for the sign table's consumers. */
export type { MovementType };
