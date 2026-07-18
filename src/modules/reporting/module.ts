import { defineModule } from "../_shared/module-contract";
import {
  ACCESS_AUDIT_METRIC_KEYS,
  ACCESS_AUDIT_SUMMARY_PROJECTION_KEY,
  EVENT_ACTIVITY_METRIC_KEYS,
  EVENT_ACTIVITY_PROJECTOR_CONSUMER_NAME,
  EVENT_ACTIVITY_REBUILD_STREAM_KEY,
  EVENT_ACTIVITY_SUMMARY_PROJECTION_KEY,
  MODULE_ACTIVITY_METRIC_KEYS,
  MODULE_ACTIVITY_SUMMARY_PROJECTION_KEY
} from "./domain/projection-keys";
import { REPORTING_PROJECTION_PERMISSIONS } from "./domain/projection-permissions";

/**
 * Freshness policy shared by the two `cursor_table`-strategy projections
 * below: both poll a small, cheap-to-scan append-only table on the
 * `bun run reporting:projections:refresh` schedule (recommended every 2
 * minutes) — 5 minutes "current", 30 minutes "stale", 3 consecutive
 * failures "failed".
 */
const CURSOR_TABLE_FRESHNESS = {
  targetSeconds: 300,
  staleAfterSeconds: 1800,
  errorAfterConsecutiveFailures: 3
} as const;

/**
 * The event-driven projection updates on every dispatcher tick
 * (`domain-events:dispatch`, recommended every 30-60s) rather than its own
 * poll schedule, so its target freshness is tighter.
 */
const EVENT_DRIVEN_FRESHNESS = {
  targetSeconds: 120,
  staleAfterSeconds: 900,
  errorAfterConsecutiveFailures: 5
} as const;

export const reportingModule = defineModule({
  key: "reporting",
  name: "Management Reporting",
  version: "1.2.0",
  status: "active",
  description:
    "Generic management reporting views (tenant activity, access/audit summary, sync health, module usage, email queue health — Issue #499) built as live read-aggregations over tenant_admin, identity_access, sync_storage, and email tables, PLUS (Issue #753, epic #738 platform-evolution Wave 3) a module-contributed read-model PROJECTION mechanism: incremental cursor-based and domain-event-driven updates, idempotent rebuild, freshness/staleness signals, source reconciliation, and scheduled exports — wrapping two of the five live views above (access/audit summary, module activity) plus one new event-driven demonstration projection, without forcing every report onto a projection. Derived applications add their own domain-specific reporting views (and may contribute their own projection descriptors via `reportingProjections`) on top of this base.",
  dependencies: [
    "tenant_admin",
    "identity_access",
    "sync_storage",
    "email",
    // Issue #753 — the event-driven projection's rebuild path reads
    // `awcms_domain_events` directly (read-only, same posture
    // `data_lifecycle`'s "delegated" descriptors already established for
    // reading another module's table for dry-run/reconciliation
    // purposes) and its steady-state updates are driven by
    // `domain_event_runtime`'s dispatcher — a genuine lifecycle-ordering
    // dependency, not just a source-level import.
    "domain_event_runtime"
  ],
  api: {
    openApiPath: "openapi/modules/reporting.openapi.yaml",
    basePath: "/api/v1/reports"
  },
  permissions: [
    {
      activityCode: "dashboard",
      action: "read",
      description:
        "Read management reporting dashboard views (tenant activity, access/audit, sync health, module usage, email health)"
    },
    {
      activityCode: "projections",
      action: "read",
      description:
        "Read a projection's registry metadata, current snapshot value, and freshness status"
    },
    {
      activityCode: "projections",
      action: "rebuild",
      description: "Trigger or resume a full projection rebuild"
    },
    {
      activityCode: "projections",
      action: "analyze",
      description:
        "Trigger an on-demand reconciliation of a projection against its source control total"
    },
    {
      activityCode: "exports",
      action: "read",
      description:
        "Read scheduled export configs, export run history, and download a completed export"
    },
    {
      activityCode: "exports",
      action: "configure",
      description: "Create or disable a scheduled export config"
    },
    {
      activityCode: "exports",
      action: "export",
      description: "Manually trigger an export run for a projection"
    }
  ],
  jobs: [
    {
      command: "bun run reporting:projections:refresh",
      purpose:
        "Incrementally update every `cursor_table`-strategy projection for every active tenant (bounded cursor re-scan of each projection's declared source streams), and continue any in-progress rebuild's bounded passes.",
      recommendedSchedule: "Every 2 minutes via cron/systemd timer.",
      environmentNotes:
        "Pure PostgreSQL operation — no external network egress. Safe in offline/LAN deployments.",
      safeInOfflineLan: true
    },
    {
      command: "bun run reporting:exports:dispatch",
      purpose:
        "Generate a fresh export artifact for every enabled scheduled export config whose interval has elapsed, for every active tenant.",
      recommendedSchedule: "Every 15 minutes via cron/systemd timer.",
      environmentNotes:
        "Local filesystem write under REPORTING_EXPORT_ROOT_PATH — no external network egress. Safe in offline/LAN deployments.",
      safeInOfflineLan: true
    }
  ],
  // Issue #753 — module-contributed read-model projection descriptors
  // this module owns. `reporting`'s own five live views are the only
  // projections registered in THIS PR (two wrapped, one new event-driven
  // demonstration) — a derived/domain module contributes its OWN entries
  // to its OWN `reportingProjections` array the same way, never by
  // editing this file.
  reportingProjections: [
    {
      key: ACCESS_AUDIT_SUMMARY_PROJECTION_KEY,
      version: 1,
      ownerModuleKey: "reporting",
      scope: "tenant",
      description:
        "All-time allow/deny/total ABAC decision counts, incrementally derived from awcms_abac_decision_logs (append-only — every decision is logged once and never updated/deleted, the ideal cursor_table source). Wraps a subset of the existing live GET /api/v1/reports/access-audit view (that endpoint's separate 30-day WINDOWED counts are unaffected and remain live-aggregated — a sliding time window is not safely expressible as a monotonic increment-only cursor stream without day-bucketing, deliberately out of scope for this issue's demonstration).",
      source: {
        strategy: "cursor_table",
        streams: [
          {
            streamKey: "abac_decision_logs",
            tableName: "awcms_abac_decision_logs",
            cursorColumn: "created_at",
            metrics: [
              {
                metricKey: ACCESS_AUDIT_METRIC_KEYS.allowCount,
                effect: "increment",
                matchColumn: "decision",
                matchValue: "allow"
              },
              {
                metricKey: ACCESS_AUDIT_METRIC_KEYS.denyCount,
                effect: "increment",
                matchColumn: "decision",
                matchValue: "deny"
              },
              {
                metricKey: ACCESS_AUDIT_METRIC_KEYS.totalCount,
                effect: "increment"
              }
            ]
          }
        ]
      },
      rebuildSource: {
        streams: [
          {
            streamKey: "abac_decision_logs",
            tableName: "awcms_abac_decision_logs",
            cursorColumn: "created_at",
            metrics: [
              {
                metricKey: ACCESS_AUDIT_METRIC_KEYS.allowCount,
                effect: "increment",
                matchColumn: "decision",
                matchValue: "allow"
              },
              {
                metricKey: ACCESS_AUDIT_METRIC_KEYS.denyCount,
                effect: "increment",
                matchColumn: "decision",
                matchValue: "deny"
              },
              {
                metricKey: ACCESS_AUDIT_METRIC_KEYS.totalCount,
                effect: "increment"
              }
            ]
          }
        ]
      },
      metricLabels: {
        [ACCESS_AUDIT_METRIC_KEYS.allowCount]: "Allow decisions (all-time)",
        [ACCESS_AUDIT_METRIC_KEYS.denyCount]: "Deny decisions (all-time)",
        [ACCESS_AUDIT_METRIC_KEYS.totalCount]: "Total decisions (all-time)"
      },
      requiredPermission: REPORTING_PROJECTION_PERMISSIONS.projectionsRead,
      freshness: CURSOR_TABLE_FRESHNESS,
      drillDownPath: "/api/v1/reports/access-audit",
      retentionClass:
        "Not separately registered with data_lifecycle in this issue — this projection's own tables (awcms_reporting_projection_*) are small per-tenant aggregate counters/cursors, not a high-volume table in the sense that registry targets.",
      batchLimit: 2000
    },
    {
      key: MODULE_ACTIVITY_SUMMARY_PROJECTION_KEY,
      version: 1,
      ownerModuleKey: "reporting",
      scope: "tenant",
      description:
        "Cumulative (all-time-created) identity and sync-node counts, incrementally derived from awcms_identities and awcms_sync_nodes — both tables this base never deletes or soft-deletes rows from, so a monotonic increment-only cursor exactly matches the live COUNT(*). A deliberately narrower, append-only-safe SUBSET of the existing live GET /api/v1/reports/module-usage view, which also reports office/profile counts (soft-deletable, correctness-unsafe for a naive increment-only cursor — see reporting/README.md for why those two rows are not wrapped here) and a global permissions-catalog count (not tenant-scoped at all).",
      source: {
        strategy: "cursor_table",
        streams: [
          {
            streamKey: "identities",
            tableName: "awcms_identities",
            cursorColumn: "created_at",
            metrics: [
              {
                metricKey: MODULE_ACTIVITY_METRIC_KEYS.identitiesCount,
                effect: "increment"
              }
            ]
          },
          {
            streamKey: "sync_nodes",
            tableName: "awcms_sync_nodes",
            cursorColumn: "created_at",
            metrics: [
              {
                metricKey: MODULE_ACTIVITY_METRIC_KEYS.syncNodesCount,
                effect: "increment"
              }
            ]
          }
        ]
      },
      rebuildSource: {
        streams: [
          {
            streamKey: "identities",
            tableName: "awcms_identities",
            cursorColumn: "created_at",
            metrics: [
              {
                metricKey: MODULE_ACTIVITY_METRIC_KEYS.identitiesCount,
                effect: "increment"
              }
            ]
          },
          {
            streamKey: "sync_nodes",
            tableName: "awcms_sync_nodes",
            cursorColumn: "created_at",
            metrics: [
              {
                metricKey: MODULE_ACTIVITY_METRIC_KEYS.syncNodesCount,
                effect: "increment"
              }
            ]
          }
        ]
      },
      metricLabels: {
        [MODULE_ACTIVITY_METRIC_KEYS.identitiesCount]:
          "Identities (cumulative)",
        [MODULE_ACTIVITY_METRIC_KEYS.syncNodesCount]: "Sync nodes (cumulative)"
      },
      requiredPermission: REPORTING_PROJECTION_PERMISSIONS.projectionsRead,
      freshness: CURSOR_TABLE_FRESHNESS,
      drillDownPath: "/api/v1/reports/module-usage",
      retentionClass:
        "Not separately registered with data_lifecycle in this issue — see access_audit_summary's own retentionClass note above.",
      batchLimit: 2000
    },
    {
      key: EVENT_ACTIVITY_SUMMARY_PROJECTION_KEY,
      version: 1,
      ownerModuleKey: "reporting",
      scope: "tenant",
      description:
        "New (not a wrap of an existing report) event-driven demonstration projection: counts awcms.domain-event-runtime.sample.recorded domain events as they are delivered, via a registered domain_event_runtime consumer (Issue #742) rather than polling — proves the event-consumer incremental-update pathway end-to-end, reusing domain_event_runtime's own shared jobs/locks/batching/idempotency/retry/pause-resume machinery instead of building a second one. Rebuild recomputes directly from awcms_domain_events (the authoritative outbox table), never by re-triggering delivery — see application/projection-rebuild.ts's header comment.",
      source: {
        strategy: "domain_event",
        events: [
          // Matches domain-event-runtime/domain/event-type-registry.ts's
          // SAMPLE_RECORDED_EVENT_TYPE/VERSION exactly — deliberately a
          // literal here (not a cross-module import into module.ts) to
          // keep this module's dependency SURFACE limited to what
          // `dependencies`/the domain-event consumer registry already
          // declare; `domain-event-runtime.integration.test.ts`'s own
          // parity test independently guards that registry against
          // AsyncAPI, so a drift here would show up as this projection's
          // consumer simply never matching any real delivered event.
          {
            eventType: "awcms.domain-event-runtime.sample.recorded",
            eventVersion: "1.0"
          }
        ],
        consumerName: EVENT_ACTIVITY_PROJECTOR_CONSUMER_NAME
      },
      rebuildSource: {
        streams: [
          {
            streamKey: EVENT_ACTIVITY_REBUILD_STREAM_KEY,
            tableName: "awcms_domain_events",
            cursorColumn: "occurred_at",
            metrics: [
              {
                metricKey: EVENT_ACTIVITY_METRIC_KEYS.sampleRecordedCount,
                effect: "increment",
                matchColumn: "event_type",
                matchValue: "awcms.domain-event-runtime.sample.recorded"
              }
            ]
          }
        ]
      },
      metricLabels: {
        [EVENT_ACTIVITY_METRIC_KEYS.sampleRecordedCount]:
          "sample.recorded events processed"
      },
      requiredPermission: REPORTING_PROJECTION_PERMISSIONS.projectionsRead,
      freshness: EVENT_DRIVEN_FRESHNESS,
      drillDownPath: "/api/v1/domain-events/events",
      retentionClass:
        "Not separately registered with data_lifecycle in this issue — see access_audit_summary's own retentionClass note above.",
      batchLimit: 2000
    }
  ]
});
