/**
 * `inventory` — a generic, auditable multi-location STOCK LEDGER (Issue #887,
 * ADR-0126).
 *
 * The inventory AUTHORITY for any domain module (commerce, POS, storefront)
 * that today keeps its own single stock counter on a product or variant row.
 * An append-only movement ledger is the truth; a balance per (location, item)
 * is a read model that is always the sum of it; reconciliation proves that and
 * rebuild repairs a drifted row FROM the ledger. A client can never assert a
 * balance — no endpoint accepts one.
 *
 * ## What it deliberately does NOT own
 *
 * The catalogue. Items are an opaque `(item_type, item_ref)` handed in by the
 * consumer; there is no foreign key to any product table (ADR-0126 §3). The
 * consumer adapter contract — `_shared/ports/inventory-ledger-port.ts` — and
 * the expand -> backfill -> reconcile -> contract path for a consumer migrating
 * off its own counter are documented in `docs/awcms/inventory-ledger.md`.
 *
 * ## Dependencies
 *
 * `tenant_admin` for the tenant row and the optional business-location link
 * (`awcms_offices`), `identity_access` for the guard chain, `logging` for the
 * audit trail, `domain_event_runtime` because movements and low-stock crossings
 * are published through its outbox in the SAME transaction as the change, and
 * `reporting` because the low-stock projection is registered on its engine.
 *
 * ## Surfaces
 *
 * The HTTP contract and the in-process port are the machine surfaces; the
 * operator surface is `/admin/inventory` (Issue #894, ADR-0126 §9) — balances
 * with low-stock signals, the movement history, adjustments with reversal,
 * transfers, locations and the negative-stock policy. It never asserts a
 * balance: every change is a movement.
 */
import {
  defineModule,
  type HighVolumeTableDescriptor
} from "../_shared/module-contract";
import {
  INVENTORY_MOVEMENT_POSTED_EVENT_TYPE,
  INVENTORY_STOCK_LOW_EVENT_TYPE
} from "./domain/inventory-events";
import { INVENTORY_MODULE_KEY } from "./domain/inventory-permissions";

/** data_lifecycle registry keys for the two append-only ledgers. */
export const INVENTORY_MOVEMENTS_LIFECYCLE_KEY = "inventory.movements";
export const INVENTORY_LOW_STOCK_SIGNALS_LIFECYCLE_KEY =
  "inventory.low_stock_signals";

/** The low-stock reporting projection's registry key and its metrics. */
export const INVENTORY_LOW_STOCK_PROJECTION_KEY = "inventory.low_stock";
export const INVENTORY_LOW_STOCK_METRIC_KEYS = {
  belowSignals: "below_signals",
  recoveredSignals: "recovered_signals"
} as const;

// Two MONOTONIC counters rather than one gauge. A gauge ("balances currently
// low") would need +1 on crossing below and -1 on recovery under ONE metric
// key, which the engine's stream validation forbids within a stream and which
// across two streams is unsafe: the engine clamps a decrement at 0, so a
// recovery applied before its own crossing (a batch boundary between the two
// scans) would be silently lost. Two counters cannot lose anything — their
// difference is the gauge, and the live list is the authoritative detail.
const LOW_STOCK_STREAM = {
  streamKey: "low_stock_signals",
  tableName: "awcms_inventory_low_stock_signals",
  cursorColumn: "created_at",
  metrics: [
    {
      metricKey: INVENTORY_LOW_STOCK_METRIC_KEYS.belowSignals,
      effect: "increment",
      matchColumn: "signal_kind",
      matchValue: "below"
    },
    {
      metricKey: INVENTORY_LOW_STOCK_METRIC_KEYS.recoveredSignals,
      effect: "increment",
      matchColumn: "signal_kind",
      matchValue: "recovered"
    }
  ]
} as const;

/**
 * A `delegated` descriptor for a table that nothing purges. See the comment on
 * its first use in `dataLifecycle` below for why these are descriptors and not
 * `BOUNDED_BY_DESIGN` entries.
 */
function retainedWithTenant(input: {
  key: string;
  tableName: string;
  retentionClass: "system_event" | "financial_tax";
  why: string;
  deletionWhy: string;
}): HighVolumeTableDescriptor {
  return {
    key: input.key,
    tableName: input.tableName,
    ownerModuleKey: INVENTORY_MODULE_KEY,
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
        "No archive step exists or is warranted: the table is current state, not history."
    },
    deletion: { mode: "hard_delete", rationale: input.deletionWhy },
    legalHold: { applicable: false, precedence: "not_applicable" },
    requiredIndexes: [
      {
        columns: ["tenant_id"],
        purpose:
          "Leading column of the table's primary key / unique keys (sql/169); nothing scans this table by age."
      }
    ],
    batchLimit: 5000,
    backupRestoreNotes:
      "Included in ordinary full-database backup/restore. After a restore, run GET /api/v1/inventory/balances/reconciliation.",
    executionMode: "delegated",
    existingAdopter: {
      purgeFunctionRef:
        "none — retained for the life of the tenant; see ADR-0126 §7",
      description:
        "There is deliberately no purge mechanism; this descriptor exists so the table answers the retention question on the record rather than by silence."
    }
  };
}

export const inventoryModule = defineModule({
  key: INVENTORY_MODULE_KEY,
  name: "Inventory",
  version: "0.1.0",
  // `active` since the first admin screen (`/admin/inventory`, Issue #894)
  // landed with its `navigation` entry: ADR-0021 criterion 1 requires every
  // ACTIVE module to declare a screen, and this one now does.
  status: "active",
  description:
    "A generic, auditable multi-location STOCK LEDGER (Issue #887, ADR-0126) for any domain module — commerce, POS, storefront — that today keeps its own single stock counter on a product or variant row. Stock locations (scoped to the tenant and, optionally, a business location); IMMUTABLE finalised movements (opening, receive, sale, sale_return, supplier_return, transfer_out/transfer_in, adjustment) that are append-only by trigger AND by privileges, corrected only by compensating movements; a per-(location,item) balance that is a read model always equal to the sum of its movements, with a reconciliation that proves it and a rebuild that repairs a drifted row FROM the ledger; a negative-stock policy per tenant and location; a low-stock threshold with a projection on the reporting engine. Item references are an OPAQUE (item_type, item_ref) supplied by the consumer — never a foreign key to any catalogue — and a consumer adopts the ledger through `_shared/ports/inventory-ledger-port.ts` instead of writing a counter. Every posting carries an idempotent source identity (source type, id, line, operation); replaying it returns the ORIGINAL movement. A transfer is always a balanced out/in pair posted in one transaction and enforced at COMMIT by a deferred constraint trigger. Two concurrent attempts on the last unit cannot both succeed: balance rows are locked before the check and the update itself is guarded. A client can NEVER assert a balance — no endpoint accepts one, and every body is validated strictly. Operator surface: /admin/inventory.",
  dependencies: [
    "tenant_admin",
    "identity_access",
    "logging",
    "domain_event_runtime",
    "reporting"
  ],
  type: "domain",
  api: {
    openApiPath: "openapi/modules/inventory.openapi.yaml",
    basePath: "/api/v1/inventory"
  },
  events: {
    asyncApiPath: "asyncapi/awcms-domain-events.asyncapi.yaml",
    publishes: [
      INVENTORY_MOVEMENT_POSTED_EVENT_TYPE,
      INVENTORY_STOCK_LOW_EVENT_TYPE
    ],
    subscribes: []
  },
  navigation: [
    {
      labelKey: "admin.layout.nav_inventory",
      path: "/admin/inventory",
      order: 10,
      requiredPermission: "inventory.balances.read"
    }
  ],
  permissions: [
    {
      activityCode: "locations",
      action: "read",
      description: "Read this tenant's stock locations"
    },
    {
      activityCode: "locations",
      action: "create",
      description: "Register a stock location"
    },
    {
      activityCode: "locations",
      action: "update",
      description:
        "Rename a stock location, attach it to a business location, or deactivate/reactivate it"
    },
    {
      activityCode: "policy",
      action: "read",
      description:
        "Read the tenant default and per-location negative-stock policy"
    },
    {
      activityCode: "policy",
      action: "configure",
      description:
        "Change the negative-stock policy and low-stock thresholds — decides whether stock may silently go below zero"
    },
    {
      activityCode: "balances",
      action: "read",
      description: "Read stock balances and the low-stock list"
    },
    {
      activityCode: "balances",
      action: "reconcile",
      description:
        "Run the read-only reconciliation that proves each balance equals the sum of its movements"
    },
    {
      activityCode: "balances",
      action: "rebuild",
      description:
        "Repair drifted balances from the movement ledger — writes balances, audited at critical severity"
    },
    {
      activityCode: "movements",
      action: "read",
      description: "Read the stock movement ledger"
    },
    {
      activityCode: "movements",
      action: "create",
      description:
        "Post caller-attested stock movements: receive, sale, sale return, supplier return — the ledger trusts the source identity supplied, so verifying the document is the consumer duty"
    },
    {
      activityCode: "movements",
      action: "adjust",
      description:
        "Post a stock adjustment or an opening balance, or reverse an adjustment — the only changes to stock without a business document behind them"
    },
    {
      activityCode: "movements",
      action: "transfer",
      description:
        "Transfer stock between two locations as a balanced out/in pair"
    }
  ],
  // The low-stock projection (Issue #887). `reporting`'s engine counts rows of
  // the append-only signals table by kind: crossings below the threshold and
  // recoveries back above it. Their difference is the number of balances
  // CURRENTLY low. The same stream is the rebuild source, so both figures are
  // reproducible from an authoritative table rather than only accumulated.
  reportingProjections: [
    {
      key: INVENTORY_LOW_STOCK_PROJECTION_KEY,
      version: 1,
      ownerModuleKey: INVENTORY_MODULE_KEY,
      scope: "tenant",
      description:
        "Low-stock transitions per tenant, counted from the append-only awcms_inventory_low_stock_signals log: how many times a (location, item) balance crossed to or below its threshold (below_signals) and how many times one recovered above it (recovered_signals). below_signals - recovered_signals is the number of balances currently low — two monotonic counters rather than one gauge because the engine clamps a decrement at zero, which would silently lose a recovery applied before its own crossing. The detailed list — which items, where, how far below — is the live, fully re-authorized GET /api/v1/inventory/balances?lowStockOnly=true; this projection is only the dashboard figure. RETENTION: the signals table is retained indefinitely (see ADR-0126 §7), so a rebuild reproduces the same figure.",
      source: {
        strategy: "cursor_table",
        streams: [LOW_STOCK_STREAM]
      },
      rebuildSource: { streams: [LOW_STOCK_STREAM] },
      metricLabels: {
        [INVENTORY_LOW_STOCK_METRIC_KEYS.belowSignals]:
          "Times a balance crossed to or below its low-stock threshold",
        [INVENTORY_LOW_STOCK_METRIC_KEYS.recoveredSignals]:
          "Times a balance recovered above its low-stock threshold"
      },
      requiredPermission: "inventory.balances.read",
      freshness: {
        targetSeconds: 300,
        staleAfterSeconds: 1800,
        errorAfterConsecutiveFailures: 3
      },
      drillDownPath: "/api/v1/inventory/balances?lowStockOnly=true",
      retentionClass:
        "Not separately registered with data_lifecycle — this projection's own tables (awcms_reporting_projection_*) are small per-tenant aggregate counters/cursors. Its SOURCE table, awcms_inventory_low_stock_signals, is registered (inventory.low_stock_signals).",
      batchLimit: 2000
    }
  ],
  dataLifecycle: [
    {
      key: INVENTORY_MOVEMENTS_LIFECYCLE_KEY,
      tableName: "awcms_inventory_movements",
      ownerModuleKey: INVENTORY_MODULE_KEY,
      scope: "tenant",
      cursorColumn: "created_at",
      retentionClass: "financial_tax",
      retentionMinDays: 2555,
      retentionMaxDays: 3650,
      defaultRetentionDays: 3650,
      partition: {
        eligible: true,
        granularity: "monthly",
        rationale:
          "Append-only and written on every sale, so it is the table in this module that grows with traffic and a natural monthly range-partition candidate. Not automated: partitioning an existing table is a destructive migration, tracked as follow-up guidance (ADR-0126 §7)."
      },
      archive: {
        archivable: false,
        rationale:
          "No archive step exists. An immutable stock ledger is the evidence a balance is correct; archiving it away would make reconciliation unprovable. Declaring archivable:true without a real step would be inaccurate, not aspirational."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "NOT performed by anything. The table is append-only — a trigger rejects UPDATE/DELETE and awcms_app holds no UPDATE/DELETE/TRUNCATE privilege — so no generic purge could run against it, and none is registered. Any future retention window needs its own ADR and a deliberately privileged archive-then-purge job; this field records the only deletion shape that could ever apply."
      },
      legalHold: { applicable: true, precedence: "overrides_retention" },
      requiredIndexes: [
        {
          columns: ["tenant_id", "created_at"],
          purpose:
            "awcms_inventory_movements_list_idx (sql/169) — the newest-first listing and any future bounded archive scan."
        }
      ],
      batchLimit: 5000,
      backupRestoreNotes:
        "Included in ordinary full-database backup/restore. After a restore, run GET /api/v1/inventory/balances/reconciliation: balances are derived from this table, and a restore that brought the two back from different points in time shows up there as drift that POST .../balances/rebuild repairs from the ledger.",
      executionMode: "delegated",
      existingAdopter: {
        purgeFunctionRef:
          "none — retained indefinitely; see ADR-0126 §7 (no purge function exists, and the append-only trigger would reject one)",
        description:
          "There is deliberately no purge mechanism. This descriptor exists so the table answers the retention question on the record rather than by silence; a future retention policy must be designed (ADR) before any job may delete from it."
      }
    },
    {
      key: INVENTORY_LOW_STOCK_SIGNALS_LIFECYCLE_KEY,
      tableName: "awcms_inventory_low_stock_signals",
      ownerModuleKey: INVENTORY_MODULE_KEY,
      scope: "tenant",
      cursorColumn: "created_at",
      retentionClass: "system_event",
      retentionMinDays: 2555,
      retentionMaxDays: 3650,
      defaultRetentionDays: 3650,
      partition: {
        eligible: false,
        rationale:
          "Written only when a balance crosses its threshold, so volume is a small fraction of the movement ledger's and bounded by threshold flapping, not by sales."
      },
      archive: {
        archivable: false,
        rationale:
          "It is the rebuild source of the inventory.low_stock projection; archiving rows away would change a rebuilt figure."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "NOT performed by anything: append-only by trigger and by privileges, so no purge can run. See the movements descriptor and ADR-0126 §7."
      },
      legalHold: { applicable: false, precedence: "not_applicable" },
      requiredIndexes: [
        {
          columns: ["tenant_id", "created_at"],
          purpose:
            "awcms_inventory_low_stock_signals_cursor_idx (sql/169) — the reporting projection's cursor scan."
        }
      ],
      batchLimit: 5000,
      backupRestoreNotes:
        "Included in ordinary backup/restore. A rebuild of the inventory.low_stock projection after a restore re-scans this table.",
      executionMode: "delegated",
      existingAdopter: {
        purgeFunctionRef:
          "none — retained indefinitely; see ADR-0126 §7 (append-only by trigger and privileges)",
        description:
          "There is deliberately no purge mechanism; see the movements descriptor."
      }
    },
    // The three NON-ledger tables. They are not high-volume and no age-based
    // purge would be correct for any of them — `executionMode: 'generic'` deletes
    // by age with no status predicate, so it would delete a LIVE location, a
    // live balance or the tenant's policy for being old. They are registered
    // here rather than argued into `BOUNDED_BY_DESIGN` because that list's bar
    // is "a net shrink, not an argument"; what they need is the same honest
    // statement the ledgers make — nothing purges them (ADR-0126 §7).
    retainedWithTenant({
      key: "inventory.locations",
      tableName: "awcms_inventory_locations",
      retentionClass: "system_event",
      why: "Authored by an administrator naming a place stock is held, never by traffic, so its ceiling is the number of places a tenant bothers to name. A location is never deleted at all — movements reference it by composite foreign key — it is only deactivated, so a purge could neither run nor be correct.",
      deletionWhy:
        "Not performed. Rows are referenced by the movement ledger (composite FK) and are deactivated, never removed."
    }),
    retainedWithTenant({
      key: "inventory.settings",
      tableName: "awcms_inventory_settings",
      retentionClass: "system_event",
      why: "One row per tenant, upserted, never appended — the ceiling is the tenant count. An age-based purge would silently revert a tenant's negative-stock policy to the default for being old, which is the one direction in which this table must never change on its own.",
      deletionWhy:
        "Not performed. The row is the tenant's policy; deleting it would silently change what stock postings are allowed."
    }),
    retainedWithTenant({
      key: "inventory.balances",
      tableName: "awcms_inventory_balances",
      retentionClass: "financial_tax",
      why: "A derived read model with one row per (location, item): it grows with the number of items a tenant stocks, not with traffic — a sale UPDATEs a row, it never adds one. awcms_app holds no DELETE on it, because the row is the lock target that makes the last unit safe and deleting it under a waiting poster would let two rows for one key exist. A purge by age would erase live stock.",
      deletionWhy:
        "Not performed and not permitted: awcms_app is denied DELETE. A balance is repaired from the ledger by rebuild, never removed."
    })
  ],
  subjectData: [
    {
      key: "inventory.movements",
      tableName: "awcms_inventory_movements",
      ownerModuleKey: INVENTORY_MODULE_KEY,
      subjectColumns: [
        { column: "actor_tenant_user_id", references: "tenant_user" }
      ],
      exportable: false,
      erasure: "severed_with_subject_row",
      rationale:
        "A stock ledger records what happened to goods, not facts about a person. A person appears only as the tenant user who posted the movement; anonymising the identity makes the stamp resolve to nobody, which is exactly what must NOT be done by rewriting an immutable ledger row (the table rejects UPDATE by trigger). `note` is bounded free text intended for operational remarks; ADR-0126 §8 records that it must not carry personal data."
    },
    {
      key: "inventory.locations",
      tableName: "awcms_inventory_locations",
      ownerModuleKey: INVENTORY_MODULE_KEY,
      subjectColumns: [
        { column: "created_by", references: "tenant_user" },
        { column: "updated_by", references: "tenant_user" }
      ],
      exportable: false,
      erasure: "severed_with_subject_row",
      rationale:
        "A named place stock is held. A person appears only as the administrator who created or last changed it."
    },
    {
      key: "inventory.settings",
      tableName: "awcms_inventory_settings",
      ownerModuleKey: INVENTORY_MODULE_KEY,
      subjectColumns: [{ column: "updated_by", references: "tenant_user" }],
      exportable: false,
      erasure: "severed_with_subject_row",
      rationale:
        "One row per tenant holding the default negative-stock policy. A person appears only as the administrator who last changed it."
    }
  ]
});
