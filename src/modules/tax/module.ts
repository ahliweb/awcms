import { defineModule } from "../_shared/module-contract";
import {
  TAX_RULE_VERSION_PUBLISHED_EVENT_TYPE,
  TAX_SNAPSHOT_FINALISED_EVENT_TYPE,
  TAX_SNAPSHOT_REVERSED_EVENT_TYPE
} from "./domain/tax-events";
import { TAX_MODULE_KEY, TAX_PERMISSIONS } from "./domain/tax-permissions";

export const TAX_SNAPSHOTS_LIFECYCLE_KEY = "tax.snapshots";
export const TAX_SNAPSHOT_ACTIVITY_PROJECTION_KEY = "tax.snapshot_activity";

/**
 * `tax` — a generic, jurisdiction-neutral tax calculation module (Issue #889,
 * ADR-0127).
 *
 * ## What it is, and what it refuses to be
 *
 * One calculator, one rule model, one immutable snapshot — behind an API that
 * every quote, POS and storefront caller shares, so a cart, a receipt and a
 * refund cannot disagree about the tax because they computed it three ways. Rule
 * versions carry an effective window, a pricing mode, a rounding mode/scale/level
 * and any number of components (stacked or compound); a finalised document stores
 * its tax in an append-only row that carries a copy of the rule it was computed
 * under; a refund is derived from that row and never from today's rule.
 *
 * It ships NO country's law. Indonesia (and any other jurisdiction) is a
 * configuration profile to be authored as a rule version AFTER a verified
 * regulatory mapping — the ADR records that as a non-goal for this change and the
 * reason (§Regulatory applicability). Nothing in `domain/` names a jurisdiction.
 *
 * ## Exact money
 *
 * Every amount is a decimal string and every computation is `bigint` rational
 * arithmetic (`domain/decimal.ts`). A JavaScript float never touches an amount.
 *
 * ## Server-authoritative
 *
 * No endpoint accepts a tax amount: a payload that names one is refused with its
 * own error code rather than ignored.
 *
 * ## Surfaces
 *
 * The HTTP contract is the machine surface; the operator surface is
 * `/admin/tax` (Issue #894, ADR-0127): rule profiles and versions (draft, then
 * publish with confirmation), the snapshot list and detail, and the
 * reconciliation report. Finalising and reversing a document stay consumer
 * actions.
 */
export const taxModule = defineModule({
  key: TAX_MODULE_KEY,
  name: "Tax",
  version: "0.1.0",
  // `active` since `/admin/tax` landed with its `navigation` entry (Issue #894):
  // ADR-0021 criterion 1 requires every ACTIVE module to declare a screen.
  status: "active",
  description:
    "Generic, jurisdiction-neutral tax calculation (Issue #889, ADR-0127). Versioned rule profiles with effective windows (half-open, non-overlapping per profile, enforced in the database), tax categories, a jurisdiction/scope reference, inclusive and exclusive pricing, multiple components including compound/stacked ones, an explicit rounding mode, scale and level, and exempt vs zero-rated treatment kept distinct. One pure, deterministic calculator on exact bigint-rational arithmetic — no floating point — behind a stateless quote endpoint and an idempotent snapshot/finalise endpoint. A finalised document's tax is an APPEND-ONLY snapshot carrying a copy of the rule version it was computed under, and a refund or return is computed from that snapshot alone, so updating a rule can never change a historical document. Server-authoritative: a client can never submit a tax amount. Ships no country profile — that needs a verified regulatory mapping first (ADR-0127 §Regulatory applicability). Reconciliation: a counting projection on the reporting engine plus a live monetary reconciliation report with an integrity block. Domain events through the outbox; rule publication and reversal are high-risk, idempotency-keyed and audited.",
  dependencies: [
    "tenant_admin",
    "identity_access",
    "module_management",
    // The outbox producer. `tax` appends `awcms.tax.*` events inside its own
    // transactions; the arrow points one way — the runtime knows nothing of tax
    // beyond the type registry entries.
    "domain_event_runtime",
    // The projection descriptor below is read by the reporting engine, which
    // owns the projection tables.
    "reporting",
    // Audit rows (`recordAuditEvent`).
    "logging"
  ],
  type: "domain",
  api: {
    openApiPath: "openapi/modules/tax.openapi.yaml",
    basePath: "/api/v1/tax"
  },
  events: {
    asyncApiPath: "asyncapi/awcms-domain-events.asyncapi.yaml",
    publishes: [
      TAX_RULE_VERSION_PUBLISHED_EVENT_TYPE,
      TAX_SNAPSHOT_FINALISED_EVENT_TYPE,
      TAX_SNAPSHOT_REVERSED_EVENT_TYPE
    ]
  },
  navigation: [
    {
      labelKey: "admin.layout.nav_tax",
      path: "/admin/tax",
      order: 20,
      requiredPermission: "tax.rules.read"
    }
  ],
  permissions: [
    {
      activityCode: "rules",
      action: "read",
      description:
        "Read this tenant's tax rule versions and their rule definitions"
    },
    {
      activityCode: "rules",
      action: "configure",
      description:
        "Author a draft tax rule version (rates, categories, rounding, effective date)"
    },
    {
      activityCode: "rules",
      action: "publish",
      description:
        "Publish a draft tax rule version — changes what every sale on or after its effective date is taxed at"
    },
    {
      activityCode: "calculations",
      action: "analyze",
      description: "Compute a stateless tax quote; nothing is recorded"
    },
    {
      activityCode: "snapshots",
      action: "read",
      description: "Read finalised tax snapshots"
    },
    {
      activityCode: "snapshots",
      action: "create",
      description: "Finalise a document's tax into an immutable snapshot"
    },
    {
      activityCode: "snapshots",
      action: "reverse",
      description:
        "Reverse (refund / return) a finalised document's tax from its original snapshot — high-risk, audited"
    },
    {
      activityCode: "snapshots",
      action: "backdate",
      description:
        "Finalise or reverse with a tax date outside the server-date window — posts into a period that may already be reported; high-risk, audited"
    },
    {
      activityCode: "reports",
      action: "read",
      description: "Read the tax reconciliation report"
    }
  ],
  dataLifecycle: [
    {
      key: TAX_SNAPSHOTS_LIFECYCLE_KEY,
      tableName: "awcms_tax_snapshots",
      ownerModuleKey: TAX_MODULE_KEY,
      scope: "tenant",
      cursorColumn: "created_at",
      retentionClass: "financial_tax",
      // 1826 days is also the floor `sql/172`'s immutability trigger enforces: a
      // row younger than that cannot be deleted by anyone. The two numbers are
      // the same on purpose, so editing one without the other is visible.
      retentionMinDays: 1826,
      retentionMaxDays: 3650,
      defaultRetentionDays: 2555,
      partition: {
        eligible: true,
        granularity: "monthly",
        rationale:
          "One row per finalised document and per reversal, so it grows with sales and is read by `created_at` and `tax_date` ranges. Monthly partitions on `created_at` would let a future operator detach an aged-out month instead of deleting row by row; not automated here (partitioning is runbook guidance only, per the registry contract)."
      },
      archive: {
        archivable: true,
        format: "jsonl",
        port: "local_offline",
        rationale:
          "A tax snapshot is a financial record. The retention floor is statutory-scale, so by the time a row is eligible for purge it should already sit in an archive a tenant controls; the lines and the copy of the rule definition travel in the row, so the archive is self-describing."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "Only after the retention floor, and only because `sql/172`'s trigger refuses to delete anything younger than 1826 days regardless of the policy. Rows are never edited — a correction is a reversal — so there is no anonymise path: the row names no person, only an opaque document reference."
      },
      legalHold: { applicable: true, precedence: "overrides_retention" },
      requiredIndexes: [
        {
          columns: ["tenant_id", "created_at"],
          purpose:
            "awcms_tax_snapshots_retention_idx (sql/172) — the (tenant, cursor) composite the generic purge engine filters and orders by."
        }
      ],
      batchLimit: 500,
      backupRestoreNotes:
        "A restore that omits this table loses the tenant's tax ledger and every reversal's evidence. Back it up with the database, and verify with GET /api/v1/tax/reports/reconciliation (integrity block) after a restore.",
      executionMode: "generic"
    }
  ],
  subjectData: [
    {
      key: "tax.snapshots",
      tableName: "awcms_tax_snapshots",
      ownerModuleKey: TAX_MODULE_KEY,
      subjectColumns: [{ column: "created_by", references: "tenant_user" }],
      exportable: false,
      erasure: "retain_under_obligation",
      rationale:
        "A tax record kept under a statutory retention obligation. It names no customer — only an opaque document reference and the staff user who finalised it — and the immutability trigger refuses any edit, so erasure here would be both unlawful and impossible."
    },
    {
      key: "tax.rule_versions",
      tableName: "awcms_tax_rule_versions",
      ownerModuleKey: TAX_MODULE_KEY,
      subjectColumns: [
        { column: "created_by", references: "tenant_user" },
        { column: "published_by", references: "tenant_user" }
      ],
      exportable: false,
      erasure: "severed_with_subject_row",
      rationale:
        "Tenant configuration. A person is linked only as the author/publisher stamp, which resolves to nobody once the identity is anonymised; a published version is immutable, so the stamp is not rewritten."
    }
  ],
  // The counting projection on the `reporting` engine. The engine's
  // `cursor_table` strategy can only COUNT rows, so this answers "how many
  // documents and reversals, and is the pipeline fresh"; the monetary totals are
  // the live `GET /api/v1/tax/reports/reconciliation`, which is its drill-down.
  // `awcms_tax_snapshots` is append-only, the one source for which an
  // increment-only cursor is exactly correct.
  //
  // RETENTION COUPLING (same note as `reporting.access_audit_summary`): the
  // retention purge removes snapshots older than the policy window. The counters
  // accumulate forward and are unaffected, but a REBUILD reconstructs from the
  // rows that survive, so after the first purge a rebuilt count is "since the
  // retention horizon".
  reportingProjections: [
    {
      key: TAX_SNAPSHOT_ACTIVITY_PROJECTION_KEY,
      version: 1,
      ownerModuleKey: TAX_MODULE_KEY,
      scope: "tenant",
      description:
        "How many documents this tenant has finalised and how many reversals it has recorded, incrementally derived from awcms_tax_snapshots (append-only, so an increment-only cursor is exactly correct). Freshness-tracked and rebuildable like every reporting projection; reconciled against a fresh COUNT of the source by the engine. The monetary reconciliation (net/tax/gross by version, component and treatment, with an integrity check of every snapshot against its own lines) is the drill-down.",
      source: {
        strategy: "cursor_table",
        streams: [
          {
            streamKey: "tax_snapshots",
            tableName: "awcms_tax_snapshots",
            cursorColumn: "created_at",
            metrics: [
              { metricKey: "snapshots_total", effect: "increment" },
              {
                metricKey: "sales_finalised",
                effect: "increment",
                matchColumn: "kind",
                matchValue: "sale"
              },
              {
                metricKey: "reversals_recorded",
                effect: "increment",
                matchColumn: "kind",
                matchValue: "reversal"
              }
            ]
          }
        ]
      },
      rebuildSource: {
        streams: [
          {
            streamKey: "tax_snapshots",
            tableName: "awcms_tax_snapshots",
            cursorColumn: "created_at",
            metrics: [
              { metricKey: "snapshots_total", effect: "increment" },
              {
                metricKey: "sales_finalised",
                effect: "increment",
                matchColumn: "kind",
                matchValue: "sale"
              },
              {
                metricKey: "reversals_recorded",
                effect: "increment",
                matchColumn: "kind",
                matchValue: "reversal"
              }
            ]
          }
        ]
      },
      metricLabels: {
        snapshots_total: "Tax snapshots (all)",
        sales_finalised: "Documents finalised",
        reversals_recorded: "Reversals recorded"
      },
      requiredPermission: TAX_PERMISSIONS.reportsRead,
      freshness: {
        targetSeconds: 300,
        staleAfterSeconds: 1800,
        errorAfterConsecutiveFailures: 3
      },
      drillDownPath: "/api/v1/tax/reports/reconciliation",
      retentionClass:
        "Not separately registered with data_lifecycle — its tables are the reporting engine's small per-tenant counters; the SOURCE table is registered above as tax.snapshots.",
      batchLimit: 2000
    }
  ]
});
