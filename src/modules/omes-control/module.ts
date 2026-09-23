import { defineModule } from "../_shared/module-contract";

export const OMES_HEALTH_SNAPSHOTS_LIFECYCLE_KEY =
  "omes_control.health_snapshots";
export const OMES_JOBS_LIFECYCLE_KEY = "omes_control.jobs";
export const OMES_AUDIT_PROJECTIONS_LIFECYCLE_KEY =
  "omes_control.audit_projections";
export const OMES_SERVERS_LIFECYCLE_KEY = "omes_control.servers";
export const OMES_ENROLLMENTS_LIFECYCLE_KEY = "omes_control.enrollments";
export const OMES_DEPLOYMENTS_LIFECYCLE_KEY = "omes_control.deployments";
export const OMES_OPERATION_REQUESTS_LIFECYCLE_KEY =
  "omes_control.operation_requests";
export const OMES_BACKUP_SNAPSHOTS_LIFECYCLE_KEY =
  "omes_control.backup_snapshots";

/**
 * `omes_control` — OMES Control Center domain module (ADR-0122, Issue ahliweb/omes#196).
 *
 * Ships the multi-tenant host server fleet management, worker enrollments, desired vs
 * observed deployments, operation requests, job execution queues, health telemetry snapshots,
 * backup snapshots, and host execution audit projections.
 *
 * All tables enforce Row Level Security (`ENABLE` and `FORCE ROW LEVEL SECURITY`) with
 * strict tenant GUC isolation.
 */
export const omesControlModule = defineModule({
  key: "omes_control",
  name: "OMES Control Center",
  version: "0.1.0",
  /**
   * Status is `experimental` during schema, RLS, permission, and pull worker landing (Issue #196, ADR-0122).
   * Promoted to `active` once physical operator screens land under `src/pages/admin/omes/*` (ADR-0021 criterion 1),
   * following the exact precedent established by `push_delivery`.
   */
  status: "experimental",
  description:
    "OMES Control Center domain module for host fleet lifecycle, worker enrollments, desired vs observed deployments, operation requests, worker job dispatch queue, health snapshots, backup verification, and host execution audit projections (ADR-0122).",
  // "workflow" (Issue ahliweb/omes#198): destructive operation submission
  // and backup restore route through the canonical workflow-approval
  // engine (startWorkflowInstance) instead of a second approval authority —
  // see application/operation-submission.ts and application/backup-restore.ts.
  dependencies: ["tenant_admin", "identity_access", "workflow"],
  type: "domain",
  api: {
    openApiPath: "openapi/modules/omes-control.openapi.yaml",
    basePath: "/api/v1/omes",
    routes: ["/api/v1/omes"]
  },
  permissions: [
    {
      activityCode: "servers",
      action: "read",
      description: "Read enrolled servers, host specs, and telemetry"
    },
    {
      activityCode: "servers",
      action: "register",
      description: "Register or enroll a new OMES server"
    },
    {
      activityCode: "servers",
      action: "delete",
      description: "Remove or decommission an enrolled server"
    },
    {
      activityCode: "deployments",
      action: "read",
      description: "Read desired, observed, and reconciliation deployment state"
    },
    {
      activityCode: "deployments",
      action: "operate",
      description: "Apply, update, reconcile, or roll back server deployments"
    },
    {
      activityCode: "jobs",
      action: "read",
      description: "Read dispatched, queued, and completed OMES worker jobs"
    },
    {
      activityCode: "jobs",
      action: "approve",
      description: "Approve mutating or high-risk OMES jobs"
    },
    {
      activityCode: "jobs",
      action: "cancel",
      description: "Cancel queued or leased OMES jobs"
    },
    {
      activityCode: "backups",
      action: "read",
      description: "Read backup snapshots and verification checksums"
    },
    {
      activityCode: "backups",
      action: "restore",
      description: "Restore server or agent state from backup snapshot"
    },
    {
      activityCode: "backups",
      action: "rollback",
      description: "Trigger emergency rollback to prior known-good state"
    },
    {
      activityCode: "audit",
      action: "read",
      description: "Read OMES execution and reconciliation audit evidence"
    },
    {
      activityCode: "enrollments",
      action: "manage",
      description: "Manage worker enrollment tokens and public key credentials"
    }
  ],
  dataLifecycle: [
    {
      key: OMES_HEALTH_SNAPSHOTS_LIFECYCLE_KEY,
      tableName: "awcms_omes_health_snapshots",
      ownerModuleKey: "omes_control",
      scope: "tenant",
      cursorColumn: "captured_at",
      retentionClass: "analytics_telemetry",
      retentionMinDays: 7,
      retentionMaxDays: 90,
      defaultRetentionDays: 30,
      partition: {
        eligible: true,
        granularity: "daily",
        rationale:
          "High-frequency point-in-time health telemetry snapshots per server; natural candidate for time-range partitioning."
      },
      archive: {
        archivable: false,
        rationale:
          "Ephemeral operational telemetry; recent state is sufficient and ongoing heartbeat streams refresh it."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "Straight DELETE by age; point-in-time metrics have no status transition before removal."
      },
      legalHold: {
        applicable: false,
        precedence: "not_applicable"
      },
      requiredIndexes: [
        {
          columns: ["tenant_id", "captured_at"],
          purpose: "Time-series cursor scan index for retention purging."
        }
      ],
      batchLimit: 1000,
      backupRestoreNotes:
        "Included in ordinary database backups; historical telemetry is non-critical for disaster recovery.",
      executionMode: "generic"
    },
    {
      key: OMES_JOBS_LIFECYCLE_KEY,
      tableName: "awcms_omes_jobs",
      ownerModuleKey: "omes_control",
      scope: "tenant",
      cursorColumn: "created_at",
      retentionClass: "operational_queue",
      retentionMinDays: 14,
      retentionMaxDays: 180,
      defaultRetentionDays: 60,
      partition: {
        eligible: false,
        rationale:
          "Jobs have active leases and terminal states; indexed lookups are preferred over physical range partitioning."
      },
      archive: {
        archivable: false,
        rationale:
          "Job operational details are summarized in the audit trail; raw queue entries do not require offline archive."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "Terminal completed, failed, or cancelled jobs past the retention window are deleted."
      },
      legalHold: {
        applicable: true,
        precedence: "overrides_retention"
      },
      requiredIndexes: [
        {
          columns: ["tenant_id", "created_at"],
          purpose: "Time-series cursor scan index for retention purging."
        }
      ],
      batchLimit: 500,
      backupRestoreNotes:
        "Active queued and leased jobs are preserved during backups; expired jobs are purged.",
      executionMode: "generic"
    },
    {
      key: OMES_AUDIT_PROJECTIONS_LIFECYCLE_KEY,
      tableName: "awcms_omes_audit_projections",
      ownerModuleKey: "omes_control",
      scope: "tenant",
      cursorColumn: "recorded_at",
      retentionClass: "audit_security",
      retentionMinDays: 365,
      retentionMaxDays: 1825,
      defaultRetentionDays: 730,
      partition: {
        eligible: false,
        rationale:
          "Audit projections are indexed by (tenant_id, server_id, source_event_id); volume is bounded by server event count."
      },
      archive: {
        archivable: false,
        rationale:
          "Remote OMES nodes preserve their local journal logs; this projection mirrors the two-year canonical audit retention."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "Audit projection records older than two years (730 days) are purged."
      },
      legalHold: {
        applicable: true,
        precedence: "overrides_retention"
      },
      requiredIndexes: [
        {
          columns: ["tenant_id", "recorded_at"],
          purpose: "Cursor index for retention purge scans."
        }
      ],
      batchLimit: 500,
      backupRestoreNotes:
        "Included in ordinary tenant backups to retain host execution audit history.",
      executionMode: "generic"
    },
    {
      key: OMES_SERVERS_LIFECYCLE_KEY,
      tableName: "awcms_omes_servers",
      ownerModuleKey: "omes_control",
      scope: "tenant",
      cursorColumn: "created_at",
      retentionClass: "operational_queue",
      retentionMinDays: 30,
      retentionMaxDays: 1825,
      defaultRetentionDays: 365,
      partition: {
        eligible: false,
        rationale:
          "Server records represent active host machines; volume is bounded by server inventory."
      },
      archive: {
        archivable: false,
        rationale:
          "Decommissioned host metadata is recorded in audit projections."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "Decommissioned server records past retention window may be purged."
      },
      legalHold: {
        applicable: true,
        precedence: "overrides_retention"
      },
      requiredIndexes: [
        {
          columns: ["tenant_id", "created_at"],
          purpose: "Cursor scan index for retention purging."
        }
      ],
      batchLimit: 500,
      backupRestoreNotes:
        "Included in ordinary database backups; primary fleet state.",
      executionMode: "generic"
    },
    {
      key: OMES_ENROLLMENTS_LIFECYCLE_KEY,
      tableName: "awcms_omes_enrollments",
      ownerModuleKey: "omes_control",
      scope: "tenant",
      cursorColumn: "created_at",
      retentionClass: "operational_queue",
      retentionMinDays: 7,
      retentionMaxDays: 180,
      defaultRetentionDays: 30,
      partition: {
        eligible: false,
        rationale:
          "Enrollment records are transient credential exchange tokens."
      },
      archive: {
        archivable: false,
        rationale:
          "Expired or revoked enrollment records carry no ongoing evidential value."
      },
      deletion: {
        mode: "hard_delete",
        rationale: "Expired or revoked worker enrollment tokens are deleted."
      },
      legalHold: {
        applicable: true,
        precedence: "overrides_retention"
      },
      requiredIndexes: [
        {
          columns: ["tenant_id", "created_at"],
          purpose: "Cursor scan index for retention purging."
        }
      ],
      batchLimit: 500,
      backupRestoreNotes: "Active enrollment tokens preserved during backups.",
      executionMode: "generic"
    },
    {
      key: OMES_DEPLOYMENTS_LIFECYCLE_KEY,
      tableName: "awcms_omes_deployments",
      ownerModuleKey: "omes_control",
      scope: "tenant",
      cursorColumn: "updated_at",
      retentionClass: "operational_queue",
      retentionMinDays: 30,
      retentionMaxDays: 730,
      defaultRetentionDays: 180,
      partition: {
        eligible: false,
        rationale: "Deployment configurations are bounded per server."
      },
      archive: {
        archivable: false,
        rationale: "Historical drift state is projected to audit logs."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "Old deployment reconciliation state is purged after retention window."
      },
      legalHold: {
        applicable: true,
        precedence: "overrides_retention"
      },
      requiredIndexes: [
        {
          columns: ["tenant_id", "updated_at"],
          purpose: "Cursor scan index for retention purging."
        }
      ],
      batchLimit: 500,
      backupRestoreNotes:
        "Current desired state is preserved for disaster recovery.",
      executionMode: "generic"
    },
    {
      key: OMES_OPERATION_REQUESTS_LIFECYCLE_KEY,
      tableName: "awcms_omes_operation_requests",
      ownerModuleKey: "omes_control",
      scope: "tenant",
      cursorColumn: "created_at",
      retentionClass: "operational_queue",
      retentionMinDays: 14,
      retentionMaxDays: 365,
      defaultRetentionDays: 60,
      partition: {
        eligible: false,
        rationale:
          "Operation requests are workflow intents bounded by administrative activity."
      },
      archive: {
        archivable: false,
        rationale: "Completed requests are summarized in audit projections."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "Completed or failed requests are purged past the retention window."
      },
      legalHold: {
        applicable: true,
        precedence: "overrides_retention"
      },
      requiredIndexes: [
        {
          columns: ["tenant_id", "created_at"],
          purpose: "Cursor scan index for retention purging."
        }
      ],
      batchLimit: 500,
      backupRestoreNotes:
        "Active pending/approved requests preserved during backup.",
      executionMode: "generic"
    },
    {
      key: OMES_BACKUP_SNAPSHOTS_LIFECYCLE_KEY,
      tableName: "awcms_omes_backup_snapshots",
      ownerModuleKey: "omes_control",
      scope: "tenant",
      cursorColumn: "captured_at",
      retentionClass: "operational_queue",
      retentionMinDays: 30,
      retentionMaxDays: 730,
      defaultRetentionDays: 90,
      partition: {
        eligible: false,
        rationale:
          "Backup snapshots catalog verified backup checksums per server."
      },
      archive: {
        archivable: false,
        rationale:
          "Rotated backup metadata can be removed once underlying physical backups expire."
      },
      deletion: {
        mode: "hard_delete",
        rationale: "Expired backup catalog entries are deleted after rotation."
      },
      legalHold: {
        applicable: true,
        precedence: "overrides_retention"
      },
      requiredIndexes: [
        {
          columns: ["tenant_id", "captured_at"],
          purpose: "Cursor scan index for retention purging."
        }
      ],
      batchLimit: 500,
      backupRestoreNotes:
        "Backup catalog is vital metadata for DR verification.",
      executionMode: "generic"
    }
  ]
});
