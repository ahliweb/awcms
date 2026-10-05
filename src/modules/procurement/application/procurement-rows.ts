/**
 * Row shapes and mappers for procurement (Issue #888, ADR-0128). The ONE place a
 * database row becomes an API shape, so the masking rule ("no identifier value
 * leaves except through the reveal endpoint") has a single enforcement point.
 */

/** Canonical decimal text for a `numeric::text` value: no trailing zeros. */
export function canonicalDecimal(text: string): string {
  if (!text.includes(".")) {
    return text;
  }

  const trimmed = text.replace(/0+$/, "").replace(/\.$/, "");

  return trimmed === "" || trimmed === "-" ? "0" : trimmed;
}

export function canonicalDecimalOrNull(text: string | null): string | null {
  return text === null ? null : canonicalDecimal(text);
}

// --- Suppliers ----------------------------------------------------------------

export type SupplierRow = {
  id: string;
  vendor_code: string;
  name: string;
  status: string;
  profile_id: string | null;
  created_at: Date;
  created_at_cursor?: string;
  updated_at: Date;
  deleted_at: Date | null;
  restored_at: Date | null;
};

export type Supplier = {
  id: string;
  vendorCode: string;
  name: string;
  status: string;
  profileId: string | null;
  categories: string[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  restoredAt: string | null;
};

export const SUPPLIER_COLUMNS = `id, vendor_code, name, status, profile_id,
  created_at, updated_at, deleted_at, restored_at`;

export function mapSupplier(
  row: SupplierRow,
  labels: { categories: string[]; tags: string[] }
): Supplier {
  return {
    id: row.id,
    vendorCode: row.vendor_code,
    name: row.name,
    status: row.status,
    profileId: row.profile_id,
    categories: labels.categories,
    tags: labels.tags,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    deletedAt: row.deleted_at ? row.deleted_at.toISOString() : null,
    restoredAt: row.restored_at ? row.restored_at.toISOString() : null
  };
}

export type IdentifierRow = {
  id: string;
  supplier_id: string;
  identifier_type: string;
  label: string | null;
  masked_value: string;
  classification: string;
  created_at: Date;
};

/** Deliberately has NO value field: only `maskedValue` is representable. */
export type SupplierIdentifier = {
  id: string;
  supplierId: string;
  type: string;
  label: string | null;
  maskedValue: string;
  classification: string;
  createdAt: string;
};

export const IDENTIFIER_COLUMNS = `id, supplier_id, identifier_type, label,
  masked_value, classification, created_at`;

export function mapIdentifier(row: IdentifierRow): SupplierIdentifier {
  return {
    id: row.id,
    supplierId: row.supplier_id,
    type: row.identifier_type,
    label: row.label,
    maskedValue: row.masked_value,
    classification: row.classification,
    createdAt: row.created_at.toISOString()
  };
}

// --- Documents ----------------------------------------------------------------

export type DocumentRow = {
  id: string;
  document_no: string;
  mode: string;
  status: string;
  supplier_id: string | null;
  supplier_code_snapshot: string | null;
  supplier_name_snapshot: string | null;
  location_id: string;
  source_location_id: string | null;
  external_reference: string | null;
  document_date: string;
  notes: string | null;
  currency_code: string;
  total_cost: string | null;
  line_count: number;
  approval_status: string;
  approval_instance_id: string | null;
  created_at: Date;
  created_at_cursor?: string;
  updated_at: Date;
  submitted_at: Date | null;
  finalised_at: Date | null;
  cancelled_at: Date | null;
  cancel_reason: string | null;
  reversed_at: Date | null;
  reverse_reason: string | null;
};

export type ProcurementDocument = {
  id: string;
  documentNo: string;
  mode: string;
  status: string;
  /** Snapshots taken when the document was written — never rewritten. */
  supplier: { id: string; code: string; name: string } | null;
  locationId: string;
  sourceLocationId: string | null;
  externalReference: string | null;
  documentDate: string;
  notes: string | null;
  currencyCode: string;
  totalCost: string | null;
  lineCount: number;
  approvalStatus: string;
  approvalInstanceId: string | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  finalisedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  reversedAt: string | null;
  reverseReason: string | null;
};

export const DOCUMENT_COLUMNS = `id, document_no, mode, status, supplier_id,
  supplier_code_snapshot, supplier_name_snapshot, location_id,
  source_location_id, external_reference, document_date::text AS document_date,
  notes, currency_code, total_cost::text AS total_cost, line_count,
  approval_status, approval_instance_id, created_at, updated_at, submitted_at, finalised_at,
  cancelled_at, cancel_reason, reversed_at, reverse_reason`;

export function mapDocument(row: DocumentRow): ProcurementDocument {
  return {
    id: row.id,
    documentNo: row.document_no,
    mode: row.mode,
    status: row.status,
    supplier: row.supplier_id
      ? {
          id: row.supplier_id,
          code: row.supplier_code_snapshot ?? "",
          name: row.supplier_name_snapshot ?? ""
        }
      : null,
    locationId: row.location_id,
    sourceLocationId: row.source_location_id,
    externalReference: row.external_reference,
    documentDate: row.document_date,
    notes: row.notes,
    currencyCode: row.currency_code,
    totalCost: canonicalDecimalOrNull(row.total_cost),
    lineCount: row.line_count,
    approvalStatus: row.approval_status,
    approvalInstanceId: row.approval_instance_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    submittedAt: row.submitted_at ? row.submitted_at.toISOString() : null,
    finalisedAt: row.finalised_at ? row.finalised_at.toISOString() : null,
    cancelledAt: row.cancelled_at ? row.cancelled_at.toISOString() : null,
    cancelReason: row.cancel_reason,
    reversedAt: row.reversed_at ? row.reversed_at.toISOString() : null,
    reverseReason: row.reverse_reason
  };
}

export type LineRow = {
  line_no: number;
  item_type: string;
  item_ref: string;
  sku: string;
  item_name: string;
  unit_code: string;
  quantity: string;
  unit_cost: string | null;
  line_total: string | null;
};

export type DocumentLine = {
  lineNo: number;
  itemType: string;
  itemRef: string;
  sku: string;
  itemName: string;
  unitCode: string;
  quantity: string;
  unitCost: string | null;
  lineTotal: string | null;
};

export const LINE_COLUMNS = `line_no, item_type, item_ref, sku, item_name,
  unit_code, quantity::text AS quantity, unit_cost::text AS unit_cost,
  line_total::text AS line_total`;

export function mapLine(row: LineRow): DocumentLine {
  return {
    lineNo: row.line_no,
    itemType: row.item_type,
    itemRef: row.item_ref,
    sku: row.sku,
    itemName: row.item_name,
    unitCode: row.unit_code,
    quantity: canonicalDecimal(row.quantity),
    unitCost: canonicalDecimalOrNull(row.unit_cost),
    lineTotal: canonicalDecimalOrNull(row.line_total)
  };
}

export type DocumentMovementLink = {
  lineNo: number;
  operation: string;
  movementId: string;
};

export type DocumentDetail = ProcurementDocument & {
  lines: DocumentLine[];
  movements: DocumentMovementLink[];
};
