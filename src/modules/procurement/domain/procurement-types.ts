/**
 * Vocabulary of procurement (Issue #888, ADR-0128). Pure — no I/O, no imports —
 * so the validators, the state-machine tests, the OpenAPI schema test and the
 * SQL `CHECK`/trigger in `sql/174` all read the same lists.
 */

export const DOCUMENT_MODES = [
  "receive",
  "supplier_return",
  "requisition",
  "transfer"
] as const;
export type DocumentMode = (typeof DOCUMENT_MODES)[number];

/** Modes that name a supplier and one location. */
export const SUPPLIER_MODES: readonly DocumentMode[] = [
  "receive",
  "supplier_return"
];
/** Modes that move stock between two locations (a paired ledger transfer). */
export const LOCATION_MODES: readonly DocumentMode[] = [
  "requisition",
  "transfer"
];

export const DOCUMENT_STATUSES = [
  "draft",
  "submitted",
  "finalised",
  "cancelled",
  "reversed"
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/**
 * The legal transitions. Mirrors the BEFORE UPDATE trigger in `sql/174`, which
 * is the authority; this table lets the application refuse with a 409 before the
 * database has to.
 */
export const DOCUMENT_TRANSITIONS: Readonly<
  Record<DocumentStatus, readonly DocumentStatus[]>
> = {
  draft: ["submitted", "cancelled"],
  submitted: ["finalised", "cancelled"],
  finalised: ["reversed"],
  cancelled: [],
  reversed: []
};

export function canTransition(
  from: DocumentStatus,
  to: DocumentStatus
): boolean {
  return DOCUMENT_TRANSITIONS[from].includes(to);
}

export const APPROVAL_STATUSES = [
  "not_required",
  "pending",
  "approved",
  "rejected"
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const SUPPLIER_STATUSES = ["active", "inactive", "blocked"] as const;
export type SupplierStatus = (typeof SUPPLIER_STATUSES)[number];

export const LABEL_KINDS = ["category", "tag"] as const;
export type LabelKind = (typeof LABEL_KINDS)[number];

export const IDENTIFIER_TYPES = [
  "tax_id",
  "business_id",
  "payment_ref",
  "contact_ref",
  "other"
] as const;
export type SupplierIdentifierType = (typeof IDENTIFIER_TYPES)[number];

export type IdentifierClassification = "sensitive" | "confidential";

/** Mirrors the `sql/174` CHECK: tax/business identifiers are always `sensitive`. */
export function classifyIdentifier(
  type: SupplierIdentifierType
): IdentifierClassification {
  return type === "tax_id" || type === "business_id"
    ? "sensitive"
    : "confidential";
}

/**
 * The ledger source type a document posts under. Server-owned: a client never
 * supplies it, so it cannot squat another document's identity. The reversal
 * types are DISTINCT from the post types (and from the ledger's own reserved
 * `reversal`), so a compensation has an identity of its own and replays
 * independently of the original.
 */
export const LEDGER_SOURCE_TYPE: Readonly<
  Record<DocumentMode, { post: string; reversal: string }>
> = {
  receive: {
    post: "procurement_receipt",
    reversal: "procurement_receipt_reversal"
  },
  supplier_return: {
    post: "procurement_supplier_return",
    reversal: "procurement_supplier_return_reversal"
  },
  requisition: {
    post: "procurement_requisition",
    reversal: "procurement_requisition_reversal"
  },
  transfer: {
    post: "procurement_transfer",
    reversal: "procurement_transfer_reversal"
  }
};

export const DOCUMENT_NUMBER_PREFIX: Readonly<Record<DocumentMode, string>> = {
  receive: "RCV",
  supplier_return: "SRT",
  requisition: "REQ",
  transfer: "TRF"
};

/** Workflow key a tenant's published approval definition must use. */
export const APPROVAL_WORKFLOW_KEY = "procurement.document_approval";

export const DEFAULT_CURRENCY_CODE = "IDR";

export function isDocumentMode(value: unknown): value is DocumentMode {
  return (
    typeof value === "string" &&
    (DOCUMENT_MODES as readonly string[]).includes(value)
  );
}

export function isDocumentStatus(value: unknown): value is DocumentStatus {
  return (
    typeof value === "string" &&
    (DOCUMENT_STATUSES as readonly string[]).includes(value)
  );
}

export function isSupplierStatus(value: unknown): value is SupplierStatus {
  return (
    typeof value === "string" &&
    (SUPPLIER_STATUSES as readonly string[]).includes(value)
  );
}
