/**
 * `procurement` — suppliers, receiving, supplier returns, requisitions and
 * location transfers on top of the inventory ledger (Issue #888, ADR-0128).
 *
 * A generic module for ANY domain module that buys, receives, returns or moves
 * goods. A SUPPLIER is a business role (optionally referencing the canonical
 * `profile_identity` party) with vendor code, status, categories/tags and
 * SENSITIVE tax/business identifiers that are masked everywhere except one
 * audited, separately permissioned reveal. A DOCUMENT has a lifecycle
 * draft -> submitted -> finalised | cancelled; finalised -> reversed, enforced
 * by a database trigger, and finalised documents are immutable.
 *
 * ## Stock effects ONLY through the ledger
 *
 * Finalising posts inventory movements through `InventoryLedgerPort` and never
 * writes a balance; reversing posts compensating movements. Procurement is that
 * port's consumer and honours its contract: it verifies its own source documents,
 * its routes authorize and audit before calling the adapter, and it passes the
 * request's correlation id. Reconciliation proves finalised documents and ledger
 * agree.
 *
 * ## Dependencies
 *
 * `inventory` (the ledger, and the composite FK to its locations),
 * `profile_identity` (the optional party reference and the identifier masking
 * functions), `tenant_admin`, `identity_access`, `logging`,
 * `domain_event_runtime` (finalise/reverse publish through its outbox in the same
 * transaction) and `reporting` (two projections). `workflow_approval` is NOT a
 * dependency: approval is optional and soft (tests/module-boundary.test.ts).
 *
 * ## Surfaces
 *
 * The HTTP contract is the machine surface; the operator surface is
 * `/admin/procurement` (Issue #905, ADR-0128 §9): suppliers with masked
 * identifiers and an audited reveal, documents with lines for every mode
 * (draft, submit, finalise, cancel, reverse), the approval threshold, the
 * receiving and supplier reports, and the reconciliation. It never writes a
 * balance: stock moves only when the endpoint posts through the ledger.
 */
import {
  defineModule,
  type HighVolumeTableDescriptor,
  type ProjectionCursorStream
} from "../_shared/module-contract";
import {
  PROCUREMENT_DOCUMENT_FINALISED_EVENT_TYPE,
  PROCUREMENT_DOCUMENT_REVERSED_EVENT_TYPE
} from "./domain/procurement-events";
import { PROCUREMENT_MODULE_KEY } from "./domain/procurement-permissions";

export const PROCUREMENT_RECEIVING_PROJECTION_KEY = "procurement.receiving";
export const PROCUREMENT_SUPPLIERS_PROJECTION_KEY = "procurement.suppliers";

export const PROCUREMENT_RECEIVING_METRIC_KEYS = {
  receiptsFinalised: "receipts_finalised",
  supplierReturnsFinalised: "supplier_returns_finalised",
  requisitionsFinalised: "requisitions_finalised",
  transfersFinalised: "transfers_finalised",
  documentsReversed: "documents_reversed",
  documentsCancelled: "documents_cancelled"
} as const;

export const PROCUREMENT_SUPPLIER_METRIC_KEYS = {
  finalised: "supplier_documents_finalised",
  reversed: "supplier_documents_reversed",
  cancelled: "supplier_documents_cancelled"
} as const;

// The source is one append-only table. `kind_mode` and `supplier_event_kind`
// are GENERATED columns (sql/174) so each metric is a single `matchColumn`
// equality — the engine cannot express a conjunction. Every metric is a
// MONOTONIC counter (each document reaches finalised/cancelled/reversed at most
// once, by a unique index), so there is no decrement to lose.
const RECEIVING_STREAM: ProjectionCursorStream = {
  streamKey: "document_events",
  tableName: "awcms_procurement_document_events",
  cursorColumn: "created_at",
  metrics: [
    {
      metricKey: PROCUREMENT_RECEIVING_METRIC_KEYS.receiptsFinalised,
      effect: "increment",
      matchColumn: "kind_mode",
      matchValue: "finalised:receive"
    },
    {
      metricKey: PROCUREMENT_RECEIVING_METRIC_KEYS.supplierReturnsFinalised,
      effect: "increment",
      matchColumn: "kind_mode",
      matchValue: "finalised:supplier_return"
    },
    {
      metricKey: PROCUREMENT_RECEIVING_METRIC_KEYS.requisitionsFinalised,
      effect: "increment",
      matchColumn: "kind_mode",
      matchValue: "finalised:requisition"
    },
    {
      metricKey: PROCUREMENT_RECEIVING_METRIC_KEYS.transfersFinalised,
      effect: "increment",
      matchColumn: "kind_mode",
      matchValue: "finalised:transfer"
    },
    {
      metricKey: PROCUREMENT_RECEIVING_METRIC_KEYS.documentsReversed,
      effect: "increment",
      matchColumn: "event_kind",
      matchValue: "reversed"
    },
    {
      metricKey: PROCUREMENT_RECEIVING_METRIC_KEYS.documentsCancelled,
      effect: "increment",
      matchColumn: "event_kind",
      matchValue: "cancelled"
    }
  ]
};

const SUPPLIER_STREAM: ProjectionCursorStream = {
  streamKey: "supplier_document_events",
  tableName: "awcms_procurement_document_events",
  cursorColumn: "created_at",
  metrics: [
    {
      metricKey: PROCUREMENT_SUPPLIER_METRIC_KEYS.finalised,
      effect: "increment",
      matchColumn: "supplier_event_kind",
      matchValue: "finalised"
    },
    {
      metricKey: PROCUREMENT_SUPPLIER_METRIC_KEYS.reversed,
      effect: "increment",
      matchColumn: "supplier_event_kind",
      matchValue: "reversed"
    },
    {
      metricKey: PROCUREMENT_SUPPLIER_METRIC_KEYS.cancelled,
      effect: "increment",
      matchColumn: "supplier_event_kind",
      matchValue: "cancelled"
    }
  ]
};

/**
 * A `delegated` descriptor for a table nothing purges: the table answers the
 * retention question on the record instead of by silence (the shape
 * `inventory`'s `retainedWithTenant` set). An age-based purge would be wrong for
 * every table here — documents, lines, links and events are the evidence behind
 * a stock balance, and suppliers/settings are live state.
 */
function retained(input: {
  key: string;
  tableName: string;
  retentionClass: "system_event" | "financial_tax";
  why: string;
  deletionWhy: string;
  indexColumns?: string[];
  indexPurpose?: string;
}): HighVolumeTableDescriptor {
  return {
    key: input.key,
    tableName: input.tableName,
    ownerModuleKey: PROCUREMENT_MODULE_KEY,
    scope: "tenant",
    cursorColumn: "created_at",
    retentionClass: input.retentionClass,
    retentionMinDays: 2555,
    retentionMaxDays: 3650,
    defaultRetentionDays: 3650,
    partition: { eligible: false, rationale: input.why },
    archive: {
      archivable: false,
      rationale:
        "No archive step exists or is warranted: the table is the record behind a stock balance, or live state."
    },
    deletion: { mode: "hard_delete", rationale: input.deletionWhy },
    legalHold: {
      applicable: input.retentionClass === "financial_tax",
      precedence:
        input.retentionClass === "financial_tax"
          ? "overrides_retention"
          : "not_applicable"
    },
    requiredIndexes: [
      {
        columns: input.indexColumns ?? ["tenant_id"],
        purpose:
          input.indexPurpose ??
          "Leading column of the table's primary key / unique keys (sql/174); nothing scans this table by age."
      }
    ],
    batchLimit: 5000,
    backupRestoreNotes:
      "Included in ordinary full-database backup/restore. After a restore, run GET /api/v1/procurement/documents/reconciliation (and the inventory reconciliation): documents and ledger must come back from the same point in time.",
    executionMode: "delegated",
    existingAdopter: {
      purgeFunctionRef:
        "none — retained for the life of the tenant; see ADR-0128 §7",
      description:
        "There is deliberately no purge mechanism; this descriptor exists so the table answers the retention question on the record rather than by silence."
    }
  };
}

export const procurementModule = defineModule({
  key: PROCUREMENT_MODULE_KEY,
  name: "Procurement",
  version: "0.1.0",
  // `active` since the first admin screen (`/admin/procurement`, Issue #905)
  // landed with its `navigation` entry: ADR-0021 criterion 1 requires every
  // ACTIVE module to declare a screen, and this one now does.
  status: "active",
  description:
    "Suppliers, receiving, supplier returns, stock requisitions and location transfers (Issue #888, ADR-0128) on top of the inventory ledger, for any domain module that buys, receives, returns or moves goods. A supplier is a business role that may reference the canonical profile_identity party, with vendor code, status, categories/tags, and SENSITIVE tax/business identifiers and payment/contact references that are masked in every response, log and event and revealed only by one audited, separately permissioned endpoint. A document (receive, supplier_return, requisition, transfer) carries line snapshots of SKU, name, unit and exact-decimal cost and a lifecycle draft -> submitted -> finalised | cancelled, finalised -> reversed, enforced by a database trigger: finalised documents are immutable and nothing is ever deleted. Finalising posts inventory movements THROUGH THE LEDGER'S PORT (never writing a balance), all lines or none, idempotently — a replay posts nothing twice; reversing posts compensating movements; a requisition or transfer is a paired ledger transfer. Each movement is linked to its document line, and a read-only reconciliation proves finalised documents and ledger agree. Optional threshold approval through workflow_approval (fail-closed when no workflow is published). Receiving and supplier projections ride the reporting engine. No accounts-payable ledger and no provider call inside a transaction. Operator surface: /admin/procurement.",
  dependencies: [
    "tenant_admin",
    "identity_access",
    "profile_identity",
    "logging",
    "domain_event_runtime",
    "reporting",
    "inventory"
  ],
  type: "domain",
  api: {
    openApiPath: "openapi/modules/procurement.openapi.yaml",
    basePath: "/api/v1/procurement"
  },
  events: {
    asyncApiPath: "asyncapi/awcms-domain-events.asyncapi.yaml",
    publishes: [
      PROCUREMENT_DOCUMENT_FINALISED_EVENT_TYPE,
      PROCUREMENT_DOCUMENT_REVERSED_EVENT_TYPE
    ],
    subscribes: []
  },
  navigation: [
    {
      labelKey: "admin.layout.nav_procurement",
      path: "/admin/procurement",
      order: 15,
      requiredPermission: "procurement.documents.read"
    }
  ],
  permissions: [
    {
      activityCode: "suppliers",
      action: "read",
      description:
        "Read suppliers, their categories/tags and MASKED identifiers"
    },
    {
      activityCode: "suppliers",
      action: "create",
      description: "Register a supplier"
    },
    {
      activityCode: "suppliers",
      action: "update",
      description:
        "Edit a supplier, its labels, identifiers and payment/contact references (values stay masked on read)"
    },
    {
      activityCode: "suppliers",
      action: "delete",
      description: "Soft-delete a supplier (documents keep referencing it)"
    },
    {
      activityCode: "suppliers",
      action: "restore",
      description: "Restore a soft-deleted supplier"
    },
    {
      activityCode: "suppliers",
      action: "reveal",
      description:
        "Reveal ONE supplier tax/business identifier or payment/contact reference in clear text — audited, high-risk"
    },
    {
      activityCode: "documents",
      action: "read",
      description:
        "Read receiving, supplier-return, requisition and transfer documents"
    },
    {
      activityCode: "documents",
      action: "create",
      description: "Create a draft procurement document"
    },
    {
      activityCode: "documents",
      action: "update",
      description: "Edit a draft procurement document and its lines"
    },
    {
      activityCode: "documents",
      action: "submit",
      description:
        "Submit a draft for finalisation (starts the threshold approval when one applies)"
    },
    {
      activityCode: "documents",
      action: "finalise",
      description:
        "Finalise a submitted document — posts inventory movements through the ledger; high-risk"
    },
    {
      activityCode: "documents",
      action: "cancel",
      description: "Cancel a draft or submitted document (no stock was moved)"
    },
    {
      activityCode: "documents",
      action: "reverse",
      description:
        "Reverse a finalised document with compensating inventory movements; high-risk"
    },
    {
      activityCode: "documents",
      action: "reconcile",
      description:
        "Run the read-only reconciliation of finalised documents against the inventory ledger"
    },
    {
      activityCode: "policy",
      action: "read",
      description: "Read the document approval threshold"
    },
    {
      activityCode: "policy",
      action: "configure",
      description:
        "Change the document approval threshold — decides which documents need approval before they move stock"
    },
    {
      activityCode: "reports",
      action: "read",
      description:
        "Read supplier and receiving aggregates (spend and volume per supplier)"
    }
  ],
  reportingProjections: [
    {
      key: PROCUREMENT_RECEIVING_PROJECTION_KEY,
      version: 1,
      ownerModuleKey: PROCUREMENT_MODULE_KEY,
      scope: "tenant",
      description:
        "Procurement documents finalised, reversed and cancelled per tenant, counted from the append-only awcms_procurement_document_events log: finalised receipts, supplier returns, requisitions and transfers, plus reversals and cancellations. Every metric is a monotonic counter — a document reaches each of those states at most once (unique index) — so a rebuild reproduces the same figures. The detail (which documents, which cost) is the live, fully re-authorized GET /api/v1/procurement/reports/receiving; this projection is only the dashboard figure.",
      source: { strategy: "cursor_table", streams: [RECEIVING_STREAM] },
      rebuildSource: { streams: [RECEIVING_STREAM] },
      metricLabels: {
        [PROCUREMENT_RECEIVING_METRIC_KEYS.receiptsFinalised]:
          "Receipts finalised",
        [PROCUREMENT_RECEIVING_METRIC_KEYS.supplierReturnsFinalised]:
          "Supplier returns finalised",
        [PROCUREMENT_RECEIVING_METRIC_KEYS.requisitionsFinalised]:
          "Requisitions finalised",
        [PROCUREMENT_RECEIVING_METRIC_KEYS.transfersFinalised]:
          "Location transfers finalised",
        [PROCUREMENT_RECEIVING_METRIC_KEYS.documentsReversed]:
          "Documents reversed",
        [PROCUREMENT_RECEIVING_METRIC_KEYS.documentsCancelled]:
          "Documents cancelled"
      },
      requiredPermission: "procurement.reports.read",
      freshness: {
        targetSeconds: 300,
        staleAfterSeconds: 1800,
        errorAfterConsecutiveFailures: 3
      },
      drillDownPath: "/api/v1/procurement/reports/receiving",
      retentionClass:
        "Not separately registered with data_lifecycle — this projection's own tables (awcms_reporting_projection_*) are small per-tenant aggregate counters/cursors. Its SOURCE table, awcms_procurement_document_events, is registered (procurement.document_events).",
      batchLimit: 2000
    },
    {
      key: PROCUREMENT_SUPPLIERS_PROJECTION_KEY,
      version: 1,
      ownerModuleKey: PROCUREMENT_MODULE_KEY,
      scope: "tenant",
      description:
        "Supplier-bound procurement documents (receipts and supplier returns) finalised, reversed and cancelled per tenant, counted from the same append-only awcms_procurement_document_events log through its supplier_event_kind column (NULL for location-only documents, so a transfer is never counted as supplier activity). Monotonic counters, rebuildable. The per-supplier breakdown is the live, fully re-authorized GET /api/v1/procurement/reports/suppliers.",
      source: { strategy: "cursor_table", streams: [SUPPLIER_STREAM] },
      rebuildSource: { streams: [SUPPLIER_STREAM] },
      metricLabels: {
        [PROCUREMENT_SUPPLIER_METRIC_KEYS.finalised]:
          "Supplier documents finalised",
        [PROCUREMENT_SUPPLIER_METRIC_KEYS.reversed]:
          "Supplier documents reversed",
        [PROCUREMENT_SUPPLIER_METRIC_KEYS.cancelled]:
          "Supplier documents cancelled"
      },
      requiredPermission: "procurement.reports.read",
      freshness: {
        targetSeconds: 300,
        staleAfterSeconds: 1800,
        errorAfterConsecutiveFailures: 3
      },
      drillDownPath: "/api/v1/procurement/reports/suppliers",
      retentionClass:
        "Not separately registered with data_lifecycle — small per-tenant aggregate counters/cursors. Its SOURCE table, awcms_procurement_document_events, is registered (procurement.document_events).",
      batchLimit: 2000
    }
  ],
  dataLifecycle: [
    retained({
      key: "procurement.documents",
      tableName: "awcms_procurement_documents",
      retentionClass: "financial_tax",
      why: "One row per document, authored by people, never by traffic; the ceiling is the number of documents a tenant raises. It is the evidence behind stock movements, and a trigger refuses DELETE.",
      deletionWhy:
        "Not performed and not permitted: awcms_app is denied DELETE and a trigger rejects it. A document is cancelled or reversed, never removed.",
      indexColumns: ["tenant_id", "created_at"],
      indexPurpose:
        "awcms_procurement_documents_list_idx (sql/174) — the newest-first listing and any future bounded archive scan."
    }),
    retained({
      key: "procurement.document_lines",
      tableName: "awcms_procurement_document_lines",
      retentionClass: "financial_tax",
      why: "Bounded by 500 lines per document and immutable once the parent leaves draft; line snapshots are what a historical receipt meant.",
      deletionWhy:
        "Not performed. A trigger allows line writes only while the parent is a draft; a finalised document's lines can never be removed."
    }),
    retained({
      key: "procurement.document_movements",
      tableName: "awcms_procurement_document_movements",
      retentionClass: "financial_tax",
      why: "Append-only links from a document line to the ledger movements it produced; one or two rows per line and operation, bounded by documents.",
      deletionWhy:
        "NOT performed by anything: append-only by trigger and by privileges. Deleting a link would make reconciliation report the ledger row as unlinked.",
      indexColumns: ["tenant_id", "document_id", "line_no", "operation"],
      indexPurpose:
        "awcms_procurement_document_movements_doc_idx (sql/174) — the per-document read and reconciliation join."
    }),
    retained({
      key: "procurement.document_events",
      tableName: "awcms_procurement_document_events",
      retentionClass: "system_event",
      why: "At most four rows per document (submitted, finalised, cancelled, reversed — a unique index), so volume is bounded by documents, not by traffic.",
      deletionWhy:
        "NOT performed by anything: append-only by trigger and privileges, and it is the rebuild source of both reporting projections.",
      indexColumns: ["tenant_id", "created_at"],
      indexPurpose:
        "awcms_procurement_document_events_cursor_idx (sql/174) — the reporting projections' cursor scan."
    }),
    retained({
      key: "procurement.suppliers",
      tableName: "awcms_procurement_suppliers",
      retentionClass: "system_event",
      why: "Authored by an administrator, so its ceiling is the number of vendors a tenant trades with. Documents reference it by composite FK; it is soft-deleted, never removed.",
      deletionWhy:
        "Not performed. Rows are referenced by documents (composite FK) and are soft-deleted; no purge exists."
    }),
    retained({
      key: "procurement.supplier_labels",
      tableName: "awcms_procurement_supplier_labels",
      retentionClass: "system_event",
      why: "At most 20 categories and 20 tags per supplier, replaced wholesale on edit.",
      deletionWhy:
        "Not performed by a purge; the rows are replaced with their supplier's labels on edit."
    }),
    retained({
      key: "procurement.supplier_identifiers",
      tableName: "awcms_procurement_supplier_identifiers",
      retentionClass: "system_event",
      why: "A handful of identifiers per supplier, authored by an administrator.",
      deletionWhy:
        "Not performed by an age-based purge: an identifier is removed deliberately (audited) or retained with its supplier."
    }),
    retained({
      key: "procurement.settings",
      tableName: "awcms_procurement_settings",
      retentionClass: "system_event",
      why: "One row per tenant, upserted. An age-based purge would silently turn approval OFF for being old — the one direction this table must never change on its own.",
      deletionWhy:
        "Not performed. The row is the tenant's approval threshold; deleting it would silently disable approval."
    })
  ],
  subjectData: [
    {
      key: "procurement.suppliers",
      tableName: "awcms_procurement_suppliers",
      ownerModuleKey: PROCUREMENT_MODULE_KEY,
      subjectColumns: [
        { column: "profile_id", references: "profile" },
        { column: "created_by", references: "tenant_user" },
        { column: "updated_by", references: "tenant_user" },
        { column: "deleted_by", references: "tenant_user" },
        { column: "restored_by", references: "tenant_user" }
      ],
      exportable: true,
      erasure: "retain_under_obligation",
      rationale:
        "A supplier row says what a party IS to this tenant as a vendor — code, status, a trading name — and references the party (`profile_id`) rather than copying its identity, which `profile_identity` owns and erases. The trading name of a sole proprietor is personal data, but the row is the counterparty on purchase documents the tenant must keep (financial_tax retention), so it is retained under that obligation. Nothing in this module nulls `profile_id` on anonymisation: the link REMAINS, but it points at a profile row whose identity `profile_identity` has anonymised, so it resolves to no recognisable person. The trading name copied onto the supplier row (and the supplier snapshots on documents) is NOT erased — the retention basis is the financial_tax obligation, not severance."
    },
    {
      key: "procurement.documents",
      tableName: "awcms_procurement_documents",
      ownerModuleKey: PROCUREMENT_MODULE_KEY,
      subjectColumns: [
        { column: "created_by", references: "tenant_user" },
        { column: "updated_by", references: "tenant_user" },
        { column: "submitted_by", references: "tenant_user" },
        { column: "finalised_by", references: "tenant_user" },
        { column: "cancelled_by", references: "tenant_user" },
        { column: "reversed_by", references: "tenant_user" }
      ],
      exportable: false,
      erasure: "retain_under_obligation",
      rationale:
        "A purchase or stock-movement record: goods, quantities and costs, not facts about a person. A person appears only as the tenant user who created or actioned the document, and the snapshot supplier name is the trading name on a document the tenant must keep (financial_tax retention). The table is immutable once finalised, so an erasure could not rewrite it."
    },
    {
      key: "procurement.document_events",
      tableName: "awcms_procurement_document_events",
      ownerModuleKey: PROCUREMENT_MODULE_KEY,
      subjectColumns: [
        { column: "actor_tenant_user_id", references: "tenant_user" }
      ],
      exportable: false,
      erasure: "severed_with_subject_row",
      rationale:
        "An append-only lifecycle log; a person appears only as the tenant user who actioned it. The table rejects UPDATE by trigger, so anonymising the identity makes the stamp resolve to nobody."
    },
    {
      key: "procurement.supplier_identifiers",
      tableName: "awcms_procurement_supplier_identifiers",
      ownerModuleKey: PROCUREMENT_MODULE_KEY,
      subjectColumns: [{ column: "created_by", references: "tenant_user" }],
      exportable: false,
      erasure: "retain_under_obligation",
      // The values are SENSITIVE; the plaintext and its derived lookup key must
      // never ride out in any export of this table.
      redactedColumns: ["normalized_value", "value_hash", "masked_value"],
      rationale:
        "A supplier's tax/business registration and payment/contact references, classified sensitive and masked in every response. They belong to the SUPPLIER, reachable only through the supplier row, not through the user who typed them; the tenant must keep them with the purchase documents (financial_tax retention). Only the actor stamp is a subject column."
    }
  ]
});
