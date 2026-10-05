/**
 * Request validation for procurement (Issue #888, ADR-0128).
 *
 * Pure — no database, no config. Three properties matter more than the field
 * checks themselves:
 *
 * 1. **Strict bodies.** Every validator rejects a key it does not know, so
 *    `{"status": "finalised"}` or `{"totalCost": "0"}` on a document is a 400
 *    naming the field and not a value silently ignored. A client can never write
 *    a lifecycle state, a stamp, a snapshot or a total: they are derived.
 * 2. **Exact decimals.** Quantities and costs are decimal STRINGS (or numbers
 *    that round-trip to a plain decimal), never floats. All arithmetic happens
 *    in SQL `numeric`.
 * 3. **Event-safe identifiers.** `itemRef` travels in ledger events, and
 *    `appendDomainEvent` hard-rejects a credential-shaped value; the same
 *    detector runs here so the answer is a 400, not a 500 from inside the
 *    transaction.
 */
import { findSecretShapedValues } from "../../_shared/redaction";
import {
  DEFAULT_CURRENCY_CODE,
  IDENTIFIER_TYPES,
  LOCATION_MODES,
  SUPPLIER_MODES,
  isDocumentMode,
  isSupplierStatus,
  type DocumentMode,
  type SupplierIdentifierType,
  type SupplierStatus
} from "./procurement-types";

export type ValidationError = { field: string; message: string };

export type Validated<T> =
  { valid: true; value: T } | { valid: false; errors: ValidationError[] };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Mirror the `CHECK` constraints in `sql/174`, so the two cannot disagree. */
export const PROCUREMENT_LIMITS = {
  vendorCode: 64,
  name: 200,
  label: 64,
  labelsPerKind: 20,
  identifierValue: 200,
  identifierLabel: 100,
  externalReference: 200,
  notes: 500,
  reason: 500,
  sku: 120,
  itemName: 200,
  itemRef: 200,
  lines: 500
} as const;

const VENDOR_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const LABEL_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,63}$/;
const ITEM_TYPE_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/;
const UNIT_CODE_PATTERN = /^[a-z][a-z0-9_.-]{0,31}$/;
// No `/`, `+`, `=` — the alphabet of a bearer token — so an opaque reference
// cannot be mistaken for a credential by the event-payload guard.
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// --- Exact decimals -----------------------------------------------------------

// Optional fraction of 1-6 digits, integer part <= 14 digits (numeric(20,6)).
const DECIMAL_PATTERN = /^(\d{1,14})(?:\.(\d{1,6}))?$/;

/**
 * Canonical decimal text (no trailing zeros), or `null` when `value` is not a
 * non-negative decimal with at most 6 fractional digits. Numbers are accepted
 * only when `String(n)` is already a plain decimal — `1e-7` is exactly what a
 * float round-trip produces, and refusing it keeps float residue out.
 */
export function normalizeDecimalInput(value: unknown): string | null {
  const text =
    typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : typeof value === "string"
        ? value.trim()
        : null;

  if (text === null) {
    return null;
  }

  const match = DECIMAL_PATTERN.exec(text);

  if (!match) {
    return null;
  }

  const integerPart = BigInt(match[1]!).toString();
  const fraction = (match[2] ?? "").replace(/0+$/, "");

  return fraction.length > 0 ? `${integerPart}.${fraction}` : integerPart;
}

export function isPositiveDecimal(canonical: string): boolean {
  return /[1-9]/.test(canonical);
}

// --- Body helpers -------------------------------------------------------------

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
        message: `${key} is not an accepted field. Lifecycle state, stamps, snapshots and totals are derived and can never be asserted by a client.`
      });
    }
  }

  return body;
}

function finish<T>(errors: ValidationError[], value: T): Validated<T> {
  return errors.length > 0 ? { valid: false, errors } : { valid: true, value };
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

function boundedText(
  value: unknown,
  field: string,
  max: number,
  required: boolean,
  errors: ValidationError[]
): string | null {
  if (value === undefined || value === null) {
    if (required) {
      errors.push({ field, message: `${field} is required.` });
    }

    return null;
  }

  if (typeof value !== "string") {
    errors.push({ field, message: `${field} must be a string.` });
    return null;
  }

  const trimmed = value.trim();

  if (trimmed === "") {
    if (required) {
      errors.push({ field, message: `${field} must not be empty.` });
    }

    return null;
  }

  if (trimmed.length > max) {
    errors.push({
      field,
      message: `${field} must be at most ${max} characters.`
    });
    return null;
  }

  return trimmed;
}

function refuseSecretShaped(
  values: Record<string, string | null>,
  errors: ValidationError[]
): void {
  for (const [field, value] of Object.entries(values)) {
    if (value && findSecretShapedValues({ [field]: value }).length > 0) {
      errors.push({
        field,
        message: `${field} looks like a credential and cannot be stored as a reference.`
      });
    }
  }
}

function labelList(
  value: unknown,
  field: string,
  errors: ValidationError[]
): string[] | null {
  if (value === undefined) {
    return null;
  }

  if (!Array.isArray(value)) {
    errors.push({ field, message: `${field} must be an array of strings.` });
    return null;
  }

  if (value.length > PROCUREMENT_LIMITS.labelsPerKind) {
    errors.push({
      field,
      message: `${field} may hold at most ${PROCUREMENT_LIMITS.labelsPerKind} entries.`
    });
    return null;
  }

  const seen = new Set<string>();

  for (const entry of value) {
    const label = typeof entry === "string" ? entry.trim().toLowerCase() : "";

    if (!LABEL_PATTERN.test(label)) {
      errors.push({
        field,
        message: `${field} entries must match ${LABEL_PATTERN.source}.`
      });
      return null;
    }

    seen.add(label);
  }

  return [...seen].sort();
}

// --- Suppliers ----------------------------------------------------------------

export type CreateSupplierInput = {
  vendorCode: string;
  name: string;
  status: SupplierStatus;
  profileId: string | null;
  categories: string[];
  tags: string[];
};

export function validateCreateSupplier(
  raw: unknown
): Validated<CreateSupplierInput> {
  const errors: ValidationError[] = [];
  const body = asBody(
    raw,
    ["vendorCode", "name", "status", "profileId", "categories", "tags"],
    errors
  );

  if (!body) {
    return finish(errors, null as never);
  }

  const vendorCode = patterned(
    body.vendorCode,
    "vendorCode",
    VENDOR_CODE_PATTERN,
    PROCUREMENT_LIMITS.vendorCode,
    errors
  );
  const name =
    boundedText(body.name, "name", PROCUREMENT_LIMITS.name, true, errors) ?? "";
  let status: SupplierStatus = "active";

  if (body.status !== undefined) {
    if (isSupplierStatus(body.status)) {
      status = body.status;
    } else {
      errors.push({
        field: "status",
        message: "status must be active, inactive or blocked."
      });
    }
  }

  return finish(errors, {
    vendorCode,
    name,
    status,
    profileId: optionalUuid(body, "profileId", errors),
    categories: labelList(body.categories, "categories", errors) ?? [],
    tags: labelList(body.tags, "tags", errors) ?? []
  });
}

export type UpdateSupplierInput = {
  name?: string;
  status?: SupplierStatus;
  /** `null` detaches the party; `undefined` leaves it. */
  profileId?: string | null;
  categories?: string[];
  tags?: string[];
};

export function validateUpdateSupplier(
  raw: unknown
): Validated<UpdateSupplierInput> {
  const errors: ValidationError[] = [];
  const body = asBody(
    raw,
    ["name", "status", "profileId", "categories", "tags"],
    errors
  );

  if (!body) {
    return finish(errors, null as never);
  }

  const value: UpdateSupplierInput = {};

  if (body.name !== undefined) {
    value.name =
      boundedText(body.name, "name", PROCUREMENT_LIMITS.name, true, errors) ??
      "";
  }

  if (body.status !== undefined) {
    if (isSupplierStatus(body.status)) {
      value.status = body.status;
    } else {
      errors.push({
        field: "status",
        message: "status must be active, inactive or blocked."
      });
    }
  }

  if (body.profileId !== undefined) {
    value.profileId = optionalUuid(body, "profileId", errors);
  }

  const categories = labelList(body.categories, "categories", errors);
  const tags = labelList(body.tags, "tags", errors);

  if (categories) value.categories = categories;
  if (tags) value.tags = tags;

  if (errors.length === 0 && Object.keys(value).length === 0) {
    errors.push({ field: "body", message: "Nothing to update." });
  }

  return finish(errors, value);
}

export type AddIdentifierInput = {
  type: SupplierIdentifierType;
  value: string;
  label: string | null;
};

export function validateAddIdentifier(
  raw: unknown
): Validated<AddIdentifierInput> {
  const errors: ValidationError[] = [];
  const body = asBody(raw, ["type", "value", "label"], errors);

  if (!body) {
    return finish(errors, null as never);
  }

  const type = (IDENTIFIER_TYPES as readonly unknown[]).includes(body.type)
    ? (body.type as SupplierIdentifierType)
    : null;

  if (type === null) {
    errors.push({
      field: "type",
      message: `type must be one of ${IDENTIFIER_TYPES.join(", ")}.`
    });
  }

  const value =
    boundedText(
      body.value,
      "value",
      PROCUREMENT_LIMITS.identifierValue,
      true,
      errors
    ) ?? "";
  const label = boundedText(
    body.label,
    "label",
    PROCUREMENT_LIMITS.identifierLabel,
    false,
    errors
  );

  return finish(errors, { type: type ?? "other", value, label });
}

/** A reason body: `required` for cancel/reverse, optional for supplier delete. */
export function validateReason(
  required: boolean
): (raw: unknown) => Validated<{ reason: string | null }> {
  return (raw) => {
    const errors: ValidationError[] = [];
    const body = asBody(raw ?? {}, ["reason"], errors);

    if (!body) {
      return finish(errors, null as never);
    }

    const reason = boundedText(
      body.reason,
      "reason",
      PROCUREMENT_LIMITS.reason,
      required,
      errors
    );

    return finish(errors, { reason });
  };
}

/** A body that must be absent or `{}` — finalise/submit carry no fields. */
export function validateEmptyBody(
  raw: unknown
): Validated<Record<string, never>> {
  const errors: ValidationError[] = [];

  asBody(raw ?? {}, [], errors);

  return finish(errors, {});
}

// --- Documents ----------------------------------------------------------------

export type DocumentLineInput = {
  itemType: string;
  itemRef: string;
  sku: string;
  itemName: string;
  unitCode: string;
  /** Canonical positive decimal text. */
  quantity: string;
  /** Canonical non-negative decimal text, or `null` when no cost is recorded. */
  unitCost: string | null;
};

export type DocumentInput = {
  supplierId: string | null;
  locationId: string;
  sourceLocationId: string | null;
  externalReference: string | null;
  /** `YYYY-MM-DD`, or `null` to let the database stamp today. */
  documentDate: string | null;
  notes: string | null;
  currencyCode: string;
  lines: DocumentLineInput[];
};

export type CreateDocumentInput = DocumentInput & { mode: DocumentMode };

function validateLines(
  value: unknown,
  mode: DocumentMode,
  errors: ValidationError[]
): DocumentLineInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push({
      field: "lines",
      message: "lines must be a non-empty array."
    });
    return [];
  }

  if (value.length > PROCUREMENT_LIMITS.lines) {
    errors.push({
      field: "lines",
      message: `A document holds at most ${PROCUREMENT_LIMITS.lines} lines.`
    });
    return [];
  }

  const lines: DocumentLineInput[] = [];
  const seenItems = new Set<string>();

  value.forEach((entry, index) => {
    const at = `lines[${index}]`;
    const lineErrors: ValidationError[] = [];
    const line = asBody(
      entry,
      [
        "itemType",
        "itemRef",
        "sku",
        "itemName",
        "unitCode",
        "quantity",
        "unitCost"
      ],
      lineErrors
    );

    if (!line) {
      errors.push(
        ...lineErrors.map((e) => ({ ...e, field: `${at}.${e.field}` }))
      );
      return;
    }

    const itemType = patterned(
      line.itemType,
      "itemType",
      ITEM_TYPE_PATTERN,
      64,
      lineErrors
    );
    const itemRef = patterned(
      line.itemRef,
      "itemRef",
      OPAQUE_ID_PATTERN,
      PROCUREMENT_LIMITS.itemRef,
      lineErrors
    );
    const sku =
      boundedText(line.sku, "sku", PROCUREMENT_LIMITS.sku, true, lineErrors) ??
      "";
    const itemName =
      boundedText(
        line.itemName,
        "itemName",
        PROCUREMENT_LIMITS.itemName,
        true,
        lineErrors
      ) ?? "";
    const unitCode =
      line.unitCode === undefined
        ? "unit"
        : patterned(
            line.unitCode,
            "unitCode",
            UNIT_CODE_PATTERN,
            32,
            lineErrors
          );
    const quantity = normalizeDecimalInput(line.quantity);

    if (quantity === null || !isPositiveDecimal(quantity)) {
      lineErrors.push({
        field: "quantity",
        message:
          "quantity must be a positive decimal with at most 6 fractional digits."
      });
    }

    let unitCost: string | null = null;

    if (line.unitCost !== undefined && line.unitCost !== null) {
      unitCost = normalizeDecimalInput(line.unitCost);

      if (unitCost === null) {
        lineErrors.push({
          field: "unitCost",
          message:
            "unitCost must be a non-negative decimal with at most 6 fractional digits."
        });
      }
    } else if (mode === "receive" || mode === "supplier_return") {
      // The approval threshold is COST-based (ADR-0128 §9): a supplier return
      // without a cost would sum to zero and skip approval.
      lineErrors.push({
        field: "unitCost",
        message:
          mode === "receive"
            ? "unitCost is required when receiving stock."
            : "unitCost is required on a supplier return."
      });
    }

    refuseSecretShaped({ itemType, itemRef }, lineErrors);

    const identity = `${itemType}\u0000${itemRef}`;

    if (itemType && seenItems.has(identity)) {
      lineErrors.push({
        field: "itemRef",
        message:
          "An item may appear on a document once; merge its quantities into one line."
      });
    }

    seenItems.add(identity);

    errors.push(
      ...lineErrors.map((e) => ({ ...e, field: `${at}.${e.field}` }))
    );

    if (lineErrors.length === 0) {
      lines.push({
        itemType,
        itemRef,
        sku,
        itemName,
        unitCode,
        quantity: quantity!,
        unitCost
      });
    }
  });

  return lines;
}

function validateDocumentFields(
  body: Body,
  mode: DocumentMode,
  errors: ValidationError[]
): DocumentInput {
  const locationId = requiredUuid(body, "locationId", errors);
  let supplierId: string | null = null;
  let sourceLocationId: string | null = null;

  if ((SUPPLIER_MODES as readonly string[]).includes(mode)) {
    supplierId = requiredUuid(body, "supplierId", errors) || null;

    if (body.sourceLocationId !== undefined && body.sourceLocationId !== null) {
      errors.push({
        field: "sourceLocationId",
        message: `sourceLocationId is not accepted for mode ${mode}.`
      });
    }
  } else if ((LOCATION_MODES as readonly string[]).includes(mode)) {
    sourceLocationId = requiredUuid(body, "sourceLocationId", errors) || null;

    if (body.supplierId !== undefined && body.supplierId !== null) {
      errors.push({
        field: "supplierId",
        message: `supplierId is not accepted for mode ${mode}.`
      });
    }

    if (sourceLocationId !== null && sourceLocationId === locationId) {
      errors.push({
        field: "sourceLocationId",
        message: "A requisition or transfer needs two different locations."
      });
    }
  }

  let documentDate: string | null = null;

  if (body.documentDate !== undefined && body.documentDate !== null) {
    const text = body.documentDate;

    if (
      typeof text !== "string" ||
      !DATE_PATTERN.test(text) ||
      Number.isNaN(new Date(`${text}T00:00:00Z`).getTime()) ||
      new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) !== text
    ) {
      errors.push({
        field: "documentDate",
        message: "documentDate must be a calendar date, YYYY-MM-DD."
      });
    } else {
      documentDate = text;
    }
  }

  let currencyCode = DEFAULT_CURRENCY_CODE;

  if (body.currencyCode !== undefined) {
    if (
      typeof body.currencyCode === "string" &&
      CURRENCY_PATTERN.test(body.currencyCode)
    ) {
      currencyCode = body.currencyCode;
    } else {
      errors.push({
        field: "currencyCode",
        message: "currencyCode must be an upper-case ISO 4217 code."
      });
    }
  }

  return {
    supplierId,
    locationId,
    sourceLocationId,
    externalReference: boundedText(
      body.externalReference,
      "externalReference",
      PROCUREMENT_LIMITS.externalReference,
      false,
      errors
    ),
    documentDate,
    notes: boundedText(
      body.notes,
      "notes",
      PROCUREMENT_LIMITS.notes,
      false,
      errors
    ),
    currencyCode,
    lines: validateLines(body.lines, mode, errors)
  };
}

const DOCUMENT_FIELDS = [
  "supplierId",
  "locationId",
  "sourceLocationId",
  "externalReference",
  "documentDate",
  "notes",
  "currencyCode",
  "lines"
] as const;

export function validateCreateDocument(
  raw: unknown
): Validated<CreateDocumentInput> {
  const errors: ValidationError[] = [];
  const body = asBody(raw, ["mode", ...DOCUMENT_FIELDS], errors);

  if (!body) {
    return finish(errors, null as never);
  }

  if (!isDocumentMode(body.mode)) {
    errors.push({
      field: "mode",
      message:
        "mode must be one of receive, supplier_return, requisition, transfer."
    });

    return finish(errors, null as never);
  }

  const input = validateDocumentFields(body, body.mode, errors);

  return finish(errors, { mode: body.mode, ...input });
}

// --- Policy -------------------------------------------------------------------

export type PolicyInput = { approvalThreshold: string | null };

export function validatePolicyInput(raw: unknown): Validated<PolicyInput> {
  const errors: ValidationError[] = [];
  const body = asBody(raw, ["approvalThreshold"], errors);

  if (!body) {
    return finish(errors, null as never);
  }

  if (!("approvalThreshold" in body)) {
    errors.push({
      field: "approvalThreshold",
      message:
        "approvalThreshold is required (a decimal, or null to turn approval off)."
    });

    return finish(errors, null as never);
  }

  if (body.approvalThreshold === null) {
    return finish(errors, { approvalThreshold: null });
  }

  const threshold = normalizeDecimalInput(body.approvalThreshold);

  if (threshold === null) {
    errors.push({
      field: "approvalThreshold",
      message:
        "approvalThreshold must be a non-negative decimal with at most 6 fractional digits, or null."
    });
  }

  return finish(errors, { approvalThreshold: threshold });
}
