/**
 * Read-only reporting and ledger reconciliation for procurement (Issue #888,
 * ADR-0128).
 *
 * The reporting-engine projections (`module.ts`) are the dashboard figures; the
 * functions here are the live, fully re-authorized views behind them
 * (`drillDownPath`) and the proof that finalised documents and the ledger agree.
 * Nothing here writes.
 */
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  keysetCursorCreatedAtSql,
  type KeysetCursor
} from "../../_shared/keyset-pagination";
import { canonicalDecimal } from "./procurement-rows";

export const REPORT_PAGE_SIZE = 100;
export const RECONCILIATION_DISCREPANCY_LIMIT = 200;

// --- Reconciliation -------------------------------------------------------------

export type ReconciliationDiscrepancy = {
  documentId: string;
  lineNo: number;
  operation: "post" | "reversal";
  expectedMovements: number;
  linkedMovements: number;
  matchingMovements: number;
};

export type ReconciliationReport = {
  /** `true` only when every checked line matched and no ledger row is unlinked. */
  reconciled: boolean;
  documentsChecked: number;
  linesChecked: number;
  discrepancies: ReconciliationDiscrepancy[];
  /** `true` when more discrepancies exist than were listed. */
  discrepanciesTruncated: boolean;
  /**
   * Ledger movements posted under a procurement source identity that no document
   * line is linked to — stock that moved with no document behind it.
   */
  unlinkedLedgerMovements: number;
};

const PROCUREMENT_SOURCE_TYPES = [
  "procurement_receipt",
  "procurement_receipt_reversal",
  "procurement_supplier_return",
  "procurement_supplier_return_reversal",
  "procurement_requisition",
  "procurement_requisition_reversal",
  "procurement_transfer",
  "procurement_transfer_reversal"
];

/**
 * Proves, per (document, line, operation), that the ledger recorded exactly what
 * the document says: the right NUMBER of movements (1, or 2 for a transfer), each
 * of the right TYPE at the right LOCATION, with the line's quantity, under this
 * document's source identity. A missing link, a wrong quantity, a movement at the
 * wrong location, or an extra movement all surface as a discrepancy — as does a
 * ledger row under a procurement source identity that nothing links.
 *
 * Optionally scoped to one document. The scan is NOT bounded by design (it is
 * the proof, like inventory's reconciliation); the OUTPUT is bounded.
 */
export async function reconcileDocuments(
  tx: Bun.SQL,
  tenantId: string,
  documentId: string | null
): Promise<ReconciliationReport> {
  const sourceTypeList = PROCUREMENT_SOURCE_TYPES.map(
    (type) => `'${type}'`
  ).join(", ");
  const rows = (await tx`
    WITH expected AS (
      SELECT d.id AS document_id, d.mode, d.location_id, d.source_location_id,
             l.line_no, l.quantity, ops.operation,
             CASE WHEN d.mode IN ('requisition', 'transfer') THEN 2 ELSE 1 END
               AS expected_movements
      FROM awcms_procurement_documents d
      JOIN awcms_procurement_document_lines l
        ON l.tenant_id = d.tenant_id AND l.document_id = d.id
      CROSS JOIN (VALUES ('post'), ('reversal')) AS ops(operation)
      WHERE d.tenant_id = ${tenantId}
        AND d.status IN ('finalised', 'reversed')
        AND (ops.operation = 'post' OR d.status = 'reversed')
        AND (${documentId}::uuid IS NULL OR d.id = ${documentId})
    ),
    linked AS (
      SELECT e.document_id, e.line_no, e.operation,
             count(m.movement_id) AS linked_movements,
             count(m.movement_id) FILTER (WHERE
               im.source_id = e.document_id::text
               AND im.source_line = e.line_no::text
               AND abs(im.quantity_delta) = e.quantity
               AND im.source_type = CASE e.mode
                 WHEN 'receive' THEN 'procurement_receipt'
                 WHEN 'supplier_return' THEN 'procurement_supplier_return'
                 WHEN 'requisition' THEN 'procurement_requisition'
                 ELSE 'procurement_transfer' END
                 || CASE e.operation WHEN 'reversal' THEN '_reversal' ELSE '' END
               AND (
                 (e.mode = 'receive' AND im.location_id = e.location_id
                   AND ((e.operation = 'post' AND im.movement_type = 'receive')
                     OR (e.operation = 'reversal'
                         AND im.movement_type = 'supplier_return')))
                 OR (e.mode = 'supplier_return' AND im.location_id = e.location_id
                   AND ((e.operation = 'post'
                         AND im.movement_type = 'supplier_return')
                     OR (e.operation = 'reversal'
                         AND im.movement_type = 'receive')))
                 OR (e.mode IN ('requisition', 'transfer') AND (
                   (e.operation = 'post' AND (
                     (im.movement_type = 'transfer_out'
                       AND im.location_id = e.source_location_id)
                     OR (im.movement_type = 'transfer_in'
                       AND im.location_id = e.location_id)))
                   OR (e.operation = 'reversal' AND (
                     (im.movement_type = 'transfer_out'
                       AND im.location_id = e.location_id)
                     OR (im.movement_type = 'transfer_in'
                       AND im.location_id = e.source_location_id)))))
               )
             ) AS matching_movements,
             count(DISTINCT im.movement_type) FILTER (WHERE true)
               AS distinct_types
      FROM expected e
      LEFT JOIN awcms_procurement_document_movements m
        ON m.tenant_id = ${tenantId} AND m.document_id = e.document_id
       AND m.line_no = e.line_no AND m.operation = e.operation
      LEFT JOIN awcms_inventory_movements im
        ON im.tenant_id = m.tenant_id AND im.id = m.movement_id
      GROUP BY e.document_id, e.line_no, e.operation
    )
    SELECT e.document_id, e.line_no, e.operation, e.expected_movements,
           k.linked_movements::int AS linked_movements,
           k.matching_movements::int AS matching_movements,
           (SELECT count(DISTINCT document_id) FROM expected)::int AS documents,
           (SELECT count(*) FROM expected)::int AS checked,
           count(*) OVER ()::int AS total_rows,
           (k.linked_movements <> e.expected_movements
             OR k.matching_movements <> e.expected_movements
             OR k.distinct_types <> e.expected_movements) AS broken
    FROM expected e
    JOIN linked k USING (document_id, line_no, operation)
    ORDER BY broken DESC, e.document_id, e.line_no, e.operation
    LIMIT ${RECONCILIATION_DISCREPANCY_LIMIT + 1}
  `) as {
    document_id: string;
    line_no: number;
    operation: "post" | "reversal";
    expected_movements: number;
    linked_movements: number;
    matching_movements: number;
    documents: number;
    checked: number;
    broken: boolean;
  }[];

  const broken = rows.filter((row) => row.broken);
  const unlinked = (await tx`
    SELECT count(*)::int AS n
    FROM awcms_inventory_movements im
    WHERE im.tenant_id = ${tenantId}
      AND im.source_type IN (${tx.unsafe(sourceTypeList)})
      AND (${documentId}::text IS NULL OR im.source_id = ${documentId})
      AND NOT EXISTS (
        SELECT 1 FROM awcms_procurement_document_movements m
        WHERE m.tenant_id = im.tenant_id AND m.movement_id = im.id)
  `) as { n: number }[];
  const unlinkedCount = unlinked[0]!.n;

  return {
    reconciled: broken.length === 0 && unlinkedCount === 0,
    documentsChecked: rows[0]?.documents ?? 0,
    linesChecked: rows[0]?.checked ?? 0,
    discrepancies: broken
      .slice(0, RECONCILIATION_DISCREPANCY_LIMIT)
      .map((row) => ({
        documentId: row.document_id,
        lineNo: row.line_no,
        operation: row.operation,
        expectedMovements: row.expected_movements,
        linkedMovements: row.linked_movements,
        matchingMovements: row.matching_movements
      })),
    discrepanciesTruncated: broken.length > RECONCILIATION_DISCREPANCY_LIMIT,
    unlinkedLedgerMovements: unlinkedCount
  };
}

// --- Aggregates -----------------------------------------------------------------

export type SupplierActivity = {
  supplierId: string;
  vendorCode: string;
  status: string;
  /**
   * True for a soft-deleted supplier. They stay in the report so it reconciles
   * with the receiving summary, which counts every document regardless of the
   * supplier's lifecycle (audit L6).
   */
  deleted: boolean;
  receiptsFinalised: number;
  supplierReturnsFinalised: number;
  documentsReversed: number;
  openDocuments: number;
  /** Total cost of finalised receipts NOT since reversed, exact decimal text. */
  receivedCost: string;
  returnedCost: string;
};

export function parseReportCursor(cursor: string): KeysetCursor | null {
  return decodeKeysetCursor(cursor);
}

export async function supplierActivityReport(
  tx: Bun.SQL,
  tenantId: string,
  range: { from: string | null; to: string | null },
  cursor?: KeysetCursor
): Promise<{ suppliers: SupplierActivity[]; nextCursor: string | null }> {
  const cursorCreatedAt = cursor ? cursor.createdAt : null;
  const cursorId = cursor ? cursor.id : null;

  const rows = (await tx`
    SELECT s.id, s.vendor_code, s.status, (s.deleted_at IS NOT NULL) AS deleted,
      ${tx.unsafe(keysetCursorCreatedAtSql("s"))} AS created_at_cursor,
      count(d.id) FILTER (WHERE d.mode = 'receive'
        AND d.status = 'finalised')::int AS receipts_finalised,
      count(d.id) FILTER (WHERE d.mode = 'supplier_return'
        AND d.status = 'finalised')::int AS returns_finalised,
      count(d.id) FILTER (WHERE d.status = 'reversed')::int AS reversed,
      count(d.id) FILTER (WHERE d.status IN ('draft', 'submitted'))::int AS open_documents,
      COALESCE(sum(d.total_cost) FILTER (WHERE d.mode = 'receive'
        AND d.status = 'finalised'), 0)::text AS received_cost,
      COALESCE(sum(d.total_cost) FILTER (WHERE d.mode = 'supplier_return'
        AND d.status = 'finalised'), 0)::text AS returned_cost
    FROM awcms_procurement_suppliers s
    LEFT JOIN awcms_procurement_documents d
      ON d.tenant_id = s.tenant_id AND d.supplier_id = s.id
     AND (${range.from}::date IS NULL OR d.document_date >= ${range.from}::date)
     AND (${range.to}::date IS NULL OR d.document_date <= ${range.to}::date)
    WHERE s.tenant_id = ${tenantId}
      AND (
        ${cursorCreatedAt}::timestamptz IS NULL
        OR (s.created_at, s.id) < (${cursorCreatedAt}::timestamptz, ${cursorId}::uuid)
      )
    GROUP BY s.id
    ORDER BY s.created_at DESC, s.id DESC
    LIMIT ${REPORT_PAGE_SIZE}
  `) as {
    id: string;
    vendor_code: string;
    status: string;
    deleted: boolean;
    created_at_cursor: string;
    receipts_finalised: number;
    returns_finalised: number;
    reversed: number;
    open_documents: number;
    received_cost: string;
    returned_cost: string;
  }[];
  const last = rows[rows.length - 1];

  return {
    suppliers: rows.map((row) => ({
      supplierId: row.id,
      vendorCode: row.vendor_code,
      status: row.status,
      deleted: row.deleted,
      receiptsFinalised: row.receipts_finalised,
      supplierReturnsFinalised: row.returns_finalised,
      documentsReversed: row.reversed,
      openDocuments: row.open_documents,
      receivedCost: canonicalDecimal(row.received_cost),
      returnedCost: canonicalDecimal(row.returned_cost)
    })),
    nextCursor:
      rows.length === REPORT_PAGE_SIZE && last
        ? encodeKeysetCursor(last.created_at_cursor, last.id)
        : null
  };
}

export type ReceivingSummaryRow = {
  mode: string;
  status: string;
  documents: number;
  totalCost: string;
};

/** Documents and cost per (mode, status): at most 4 x 5 = 20 groups. */
export async function receivingSummaryReport(
  tx: Bun.SQL,
  tenantId: string,
  range: { from: string | null; to: string | null }
): Promise<ReceivingSummaryRow[]> {
  const rows = (await tx`
    SELECT mode, status, count(*)::int AS documents,
           COALESCE(sum(total_cost), 0)::text AS total_cost
    FROM awcms_procurement_documents
    WHERE tenant_id = ${tenantId}
      AND (${range.from}::date IS NULL OR document_date >= ${range.from}::date)
      AND (${range.to}::date IS NULL OR document_date <= ${range.to}::date)
    GROUP BY mode, status
    ORDER BY mode, status
  `) as {
    mode: string;
    status: string;
    documents: number;
    total_cost: string;
  }[];

  return rows.map((row) => ({
    mode: row.mode,
    status: row.status,
    documents: row.documents,
    totalCost: canonicalDecimal(row.total_cost)
  }));
}
