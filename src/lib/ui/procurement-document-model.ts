/**
 * The request-body model of the `/admin/procurement` forms (Issue #905) — PURE:
 * no DOM, so it is unit-testable and costs the client bundle only what it uses.
 *
 * ## The server stays authoritative
 *
 * Nothing here validates a document. `validateCreateDocument` in the procurement
 * module is strict (an unknown key is a 400, a lifecycle state or a total can
 * never be asserted) and it is the authority; this file only shapes what the
 * operator typed into the body that validator accepts:
 *
 *   * quantities and costs stay exact decimal STRINGS the whole way through —
 *     they are never parsed to a number;
 *   * an empty optional field is OMITTED, not sent as `""`, because the server
 *     reads "absent" and "blank" differently for several of them;
 *   * the fields that do not belong to a mode (a supplier on a transfer, a source
 *     location on a receipt) are never sent, since the server refuses them.
 */
import { SUPPLIER_MODES } from "../../modules/procurement/domain/procurement-types";

/** One line, exactly as typed. */
export type LineFields = {
  itemType: string;
  itemRef: string;
  sku: string;
  itemName: string;
  unitCode: string;
  quantity: string;
  unitCost: string;
};

export type DocumentFormFields = {
  mode: string;
  supplierId: string;
  locationId: string;
  sourceLocationId: string;
  externalReference: string;
  documentDate: string;
  notes: string;
  currencyCode: string;
  lines: LineFields[];
};

/** Receipts and supplier returns name a supplier; the other two modes name two locations. */
export function isSupplierDocumentMode(mode: string): boolean {
  return (SUPPLIER_MODES as readonly string[]).includes(mode);
}

/** `"a, b ,,c"` -> `["a", "b", "c"]`: the supplier category/tag text field. */
export function parseLabelList(text: string): string[] {
  return text
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

function optional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function buildLine(line: LineFields): Record<string, string> {
  const unitCode = optional(line.unitCode);
  const unitCost = optional(line.unitCost);

  return {
    itemType: line.itemType.trim(),
    itemRef: line.itemRef.trim(),
    sku: line.sku.trim(),
    itemName: line.itemName.trim(),
    ...(unitCode ? { unitCode } : {}),
    quantity: line.quantity.trim(),
    ...(unitCost ? { unitCost } : {})
  };
}

/** The `POST /api/v1/procurement/documents` body for what the form holds. */
export function buildDocumentBody(
  fields: DocumentFormFields
): Record<string, unknown> {
  const supplierMode = isSupplierDocumentMode(fields.mode);
  const externalReference = optional(fields.externalReference);
  const documentDate = optional(fields.documentDate);
  const notes = optional(fields.notes);
  const currencyCode = optional(fields.currencyCode);

  return {
    mode: fields.mode,
    ...(supplierMode
      ? { supplierId: fields.supplierId.trim() }
      : { sourceLocationId: fields.sourceLocationId.trim() }),
    locationId: fields.locationId.trim(),
    ...(externalReference ? { externalReference } : {}),
    ...(documentDate ? { documentDate } : {}),
    ...(notes ? { notes } : {}),
    ...(currencyCode ? { currencyCode: currencyCode.toUpperCase() } : {}),
    lines: fields.lines.map(buildLine)
  };
}

/**
 * A line the operator has not touched: the unit default alone does not make it a
 * line. Lets "Add line" leave a spare empty row without it blocking the submit.
 */
export function isBlankLine(line: LineFields): boolean {
  return (
    line.itemType.trim() === "" &&
    line.itemRef.trim() === "" &&
    line.sku.trim() === "" &&
    line.itemName.trim() === "" &&
    line.quantity.trim() === "" &&
    line.unitCost.trim() === ""
  );
}

/** The date filter of the reports: `YYYY-MM-DD` as a real calendar date, else `""`. */
export function calendarDateOrEmpty(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
    ? value
    : "";
}
