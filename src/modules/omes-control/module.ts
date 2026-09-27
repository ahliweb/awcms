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
export const OMES_WORKER_NONCES_LIFECYCLE_KEY = "omes_control.worker_nonces";
export const OMES_WORKER_RESULTS_LIFECYCLE_KEY = "omes_control.worker_results";
export const OMES_AI_PRIVACY_POSTURE_LIFECYCLE_KEY =
  "omes_control.ai_privacy_posture";
export const OMES_AI_EGRESS_APPROVALS_LIFECYCLE_KEY =
  "omes_control.ai_egress_approvals";
export const OMES_HERMES_ORCHESTRATION_TREES_LIFECYCLE_KEY =
  "omes_control.hermes_orchestration_trees";
export const OMES_HERMES_ORCHESTRATION_EVENTS_LIFECYCLE_KEY =
  "omes_control.hermes_orchestration_events";
export const OMES_REPOSITORY_PROGRESS_CONFIG_LIFECYCLE_KEY =
  "omes_control.repository_progress_config";
export const OMES_REPOSITORY_PROGRESS_LIFECYCLE_KEY =
  "omes_control.repository_progress";

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
   * Status is `active` as of Issue ahliweb/omes#201 (parent #195): all eight
   * planned `/admin/omes/*` screens now exist (overview, servers,
   * deployments, operations, jobs — #200 — plus health, backups, audit —
   * #201). ADR-0021 criterion 1 for promotion is "an active module needs a
   * navigation entry with `navigation.length > 0`"; the `push_delivery`
   * precedent was promoted with a SINGLE screen, so nothing in the enforced
   * gate required waiting for all eight rather than #200's five — this
   * promotion happens now because the module's planned screen surface is
   * actually complete, not because the gate demanded it sooner.
   */
  status: "active",
  description:
    "OMES Control Center domain module for host fleet lifecycle, worker enrollments, desired vs observed deployments, operation requests, worker job dispatch queue, health snapshots, backup verification, and host execution audit projections (ADR-0122).",
  // NOT "workflow", even though destructive operation submission
  // (application/operation-submission.ts, application/backup-restore.ts)
  // calls its startWorkflowInstance directly — a hard `dependencies` edge
  // would make `workflow` un-disablable for any tenant that has ever
  // enabled omes_control (tenant-module-lifecycle's
  // MODULE_DEPENDENCY_DISABLED), which is the exact blog_content ->
  // seo_distribution precedent tests/module-boundary.test.ts's
  // DOCUMENTED_EXCEPTIONS already records: a plain application function
  // call, not a swappable port, so it is not `capabilities.consumes`
  // either. The call sites check `resolveModuleEnabled(tx, tenantId,
  // "workflow")` themselves before calling in, and degrade to the same
  // `APPROVAL_WORKFLOW_NOT_CONFIGURED` refusal a tenant with no published
  // definition already gets — see tests/module-boundary.test.ts's
  // DOCUMENTED_EXCEPTIONS entry for "omes_control -> workflow".
  dependencies: ["tenant_admin", "identity_access"],
  type: "domain",
  api: {
    openApiPath: "openapi/modules/omes-control.openapi.yaml",
    basePath: "/api/v1/omes",
    routes: ["/api/v1/omes"]
  },
  // Issue ahliweb/omes#200 landed the first five entries (overview, servers,
  // deployments, operations, jobs). Issue ahliweb/omes#201 (parent #195)
  // added health, backups, audit in the SAME change as the three pages under
  // `src/pages/admin/omes/*` they name, per
  // `tests/admin-navigation-registry.test.ts`'s two-directional check.
  // Issue ahliweb/omes#233 adds the ninth and final entry, `enrollments`.
  //
  // Every `requiredPermission` below is one of the 13 `omes_control`
  // permissions `sql/155_awcms_omes_control_permissions.sql` already seeds —
  // no new permission migration for this issue either. Health reuses
  // `servers.read` (its own endpoint, `GET /api/v1/omes/health`, is guarded
  // by exactly that permission — see that route's own comment for why there
  // is no separate `health.read`).
  //
  // `enrollments.manage` was DELIBERATELY left without a navigation entry by
  // #201 — servers.astro (#200) already rendered each server's
  // enrollment/trust EVIDENCE (read-only), and issuing/revoking enrollment
  // tokens was a distinct write-capability reachable only via
  // `POST /api/v1/omes/servers/{id}/enrollment-challenges` and its
  // `/revoke` sibling (both `ahliweb/omes#198`). Issue ahliweb/omes#233
  // closes that gap with `enrollments.astro`, which calls those SAME two
  // endpoints — unmodified by this issue — and adds no new write path.
  //
  // None of these nine screens' actions cross a tenant boundary — every
  // `omes_control` table carries `tenant_id` with FORCE ROW LEVEL SECURITY
  // (sql/154) and every application-layer query in this module scopes on the
  // caller's own `tenantId` (`server-directory.ts`, `deployment-directory.ts`,
  // `job-directory.ts`, `operation-directory.ts`, `health-directory.ts`,
  // `backup-directory.ts`, `audit-directory.ts`, `backup-restore.ts`,
  // `enrollment-directory.ts`, `enrollment-management.ts`). Per ADR-0051
  // §Keputusan butir 1–3, a platform-scoped gate is required only for an
  // action whose EFFECT reaches another tenant's data — this extends to
  // `backups.restore`/`backups.rollback`
  // (`application/backup-restore.ts`'s `submitBackupRestore` resolves the
  // target `serverId` from a `SELECT ... WHERE tenant_id = ${tenantId} AND
  // id = ${backupId}` lookup, so a foreign `backupId` resolves to
  // `RESOURCE_NOT_FOUND` rather than a foreign server) and to
  // `enrollments.manage` (`issueEnrollmentChallengeForServer`/
  // `revokeEnrollment` resolve their target server the same way, by
  // `tenant_id = ${tenantId} AND id = ${serverRowId}`, so a foreign
  // `serverRowId` resolves to `server_not_found`/`not_found`, never a
  // foreign server) — none of these reach another tenant's data, so the
  // ordinary tenant-seeded `omes_control` permissions remain sufficient and
  // no platform-only permission is added.
  navigation: [
    {
      labelKey: "admin.layout.nav_omes_overview",
      path: "/admin/omes",
      order: 90,
      requiredPermission: "omes_control.servers.read"
    },
    {
      labelKey: "admin.layout.nav_omes_servers",
      path: "/admin/omes/servers",
      order: 91,
      requiredPermission: "omes_control.servers.read"
    },
    {
      labelKey: "admin.layout.nav_omes_deployments",
      path: "/admin/omes/deployments",
      order: 92,
      requiredPermission: "omes_control.deployments.read"
    },
    {
      labelKey: "admin.layout.nav_omes_operations",
      path: "/admin/omes/operations",
      order: 93,
      requiredPermission: "omes_control.deployments.read"
    },
    {
      labelKey: "admin.layout.nav_omes_jobs",
      path: "/admin/omes/jobs",
      order: 94,
      requiredPermission: "omes_control.jobs.read"
    },
    {
      labelKey: "admin.layout.nav_omes_health",
      path: "/admin/omes/health",
      order: 95,
      requiredPermission: "omes_control.servers.read"
    },
    {
      labelKey: "admin.layout.nav_omes_backups",
      path: "/admin/omes/backups",
      order: 96,
      requiredPermission: "omes_control.backups.read"
    },
    {
      labelKey: "admin.layout.nav_omes_audit",
      path: "/admin/omes/audit",
      order: 97,
      requiredPermission: "omes_control.audit.read"
    },
    {
      labelKey: "admin.layout.nav_omes_enrollments",
      path: "/admin/omes/enrollments",
      order: 98,
      requiredPermission: "omes_control.enrollments.manage"
    },
    {
      labelKey: "admin.layout.nav_omes_ai_privacy",
      path: "/admin/omes/ai-privacy",
      order: 99,
      requiredPermission: "omes_control.ai_privacy.read"
    },
    // Issue ahliweb/omes#246 (part 2; OMES issue #183, ADR-0028) adds the
    // final three redesign-parity screens. All three share the single
    // `hermes_orchestration.read` permission (the same "one read
    // permission for a family of related read-only projections" precedent
    // `health` already sets against `servers.read` above) for VIEWING.
    // Issue ahliweb/omes#249 (ADR-0030) later adds a real projection plus a
    // configure form to `/admin/omes/progres-hermes` specifically — that
    // form is gated by its OWN permission, `repository_progress.configure`
    // (checked server-side in
    // `src/pages/api/v1/omes/repository-progress/config.ts`, not by this nav
    // entry), so a viewer with read-only access sees the projection but not
    // the form.
    {
      labelKey: "admin.layout.nav_omes_orkestrasi_langsung",
      path: "/admin/omes/orkestrasi-langsung",
      order: 100,
      requiredPermission: "omes_control.hermes_orchestration.read"
    },
    {
      labelKey: "admin.layout.nav_omes_hermes",
      path: "/admin/omes/hermes",
      order: 101,
      requiredPermission: "omes_control.hermes_orchestration.read"
    },
    {
      labelKey: "admin.layout.nav_omes_progres_hermes",
      path: "/admin/omes/progres-hermes",
      order: 102,
      requiredPermission: "omes_control.hermes_orchestration.read"
    },
    // Issue ahliweb/omes#246 part 3: the read-only Architecture Control
    // Center screen, projected from the vendored
    // `architecture-capabilities-view` v1 contract. This is a DIFFERENT
    // audience/concern from `hermes_orchestration.read` above — it is not a
    // Hermes delegated-task projection, it is the ADR-0017 layered
    // reference-architecture registry (planes/capabilities across OMES,
    // Hermes, Omarchy, AWCMS, and providers) — so it gets its own permission,
    // `architecture.read`, rather than reusing `hermes_orchestration.read`.
    {
      labelKey: "admin.layout.nav_omes_arsitektur",
      path: "/admin/omes/arsitektur",
      order: 103,
      requiredPermission: "omes_control.architecture.read"
    }
  ],
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
    },
    {
      activityCode: "ai_privacy",
      action: "read",
      description:
        "Read AI privacy posture evidence and egress-approval requests"
    },
    {
      activityCode: "ai_privacy",
      action: "approve",
      description: "Approve or deny an AI egress owner-approval request"
    },
    {
      activityCode: "hermes_orchestration",
      action: "read",
      description:
        "Read Hermes delegated-task/subagent orchestration projections"
    },
    {
      activityCode: "architecture",
      action: "read",
      description:
        "Read the pinned OMES layered reference-architecture capability snapshot"
    },
    // Issue ahliweb/omes#249 (ADR-0030) — the only NEW permission this issue
    // adds. Reading the projection reuses `hermes_orchestration.read` (see
    // sql/167's header for why); configuring WHICH repository a tenant
    // observes is a distinct write capability with no existing precedent.
    {
      activityCode: "repository_progress",
      action: "configure",
      description:
        "Set or clear the GitHub repository a tenant observes for the Progres Hermes view"
    }
  ],
  // Issue ahliweb/omes#249 (ADR-0030) — the AWCMS-side scheduled poller. The
  // ONLY `omes_control` job that makes a real outbound network call to a
  // third-party provider (GitHub), so `safeInOfflineLan: false` — every other
  // job/screen in this module is pure host/database projection.
  jobs: [
    {
      command: "bun run omes:repository-progress:poll",
      schedule: {
        mode: "cron",
        expression: "*/15 * * * *",
        backlog: "bounded"
      },
      purpose:
        "Poll the GitHub REST API for every tenant's configured repository (milestones + issues, ADR-0030) and upsert the repository-progress projection for /admin/omes/progres-hermes. No-op for a tenant with no repository configured.",
      recommendedSchedule:
        "Every 15 minutes (ADR-0030's default) — comfortably inside GitHub's unauthenticated 60 requests/hour rate limit for one repository, with conditional requests (ETag) keeping an unchanged repository's poll free.",
      environmentNotes:
        "Requires outbound HTTPS egress to api.github.com. Reads OMES_REPOSITORY_PROGRESS_GITHUB_TOKEN only when a tenant has opted into token-authenticated polling (application/repository-progress-config.ts) — unset by default, and never required for a public repository.",
      safeInOfflineLan: false
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
    },
    {
      key: OMES_WORKER_NONCES_LIFECYCLE_KEY,
      tableName: "awcms_omes_worker_nonces",
      ownerModuleKey: "omes_control",
      scope: "tenant",
      cursorColumn: "expires_at",
      retentionClass: "operational_queue",
      retentionMinDays: 1,
      retentionMaxDays: 30,
      defaultRetentionDays: 1,
      partition: {
        eligible: false,
        rationale:
          "Nonce rows are consumed once and expire within the replay window (15 minutes); volume is bounded by worker poll/result/heartbeat frequency."
      },
      archive: {
        archivable: false,
        rationale:
          "A consumed or expired nonce carries no ongoing evidential value beyond the replay window."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "Expired nonce rows are purged; awcms_worker holds SELECT+DELETE only (sql/159)."
      },
      legalHold: {
        applicable: false,
        precedence: "not_applicable"
      },
      requiredIndexes: [
        {
          columns: ["tenant_id", "expires_at"],
          purpose: "Cursor scan index for retention purging of expired nonces."
        }
      ],
      batchLimit: 1000,
      backupRestoreNotes:
        "Ephemeral replay-protection state; excluded from disaster-recovery significance.",
      executionMode: "generic"
    },
    {
      key: OMES_WORKER_RESULTS_LIFECYCLE_KEY,
      tableName: "awcms_omes_worker_results",
      ownerModuleKey: "omes_control",
      scope: "tenant",
      cursorColumn: "created_at",
      retentionClass: "audit_security",
      retentionMinDays: 90,
      retentionMaxDays: 1825,
      defaultRetentionDays: 730,
      partition: {
        eligible: false,
        rationale:
          "Worker-reported result rows are indexed by (tenant_id, server_id, idempotency_key); volume is bounded by job throughput."
      },
      archive: {
        archivable: false,
        rationale:
          "This is itself the durable, source-labeled record of worker-reported evidence — see application/worker-result-ingestion.ts's header on why reconciled defaults false."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "Result rows older than the retention window are purged; awcms_worker holds SELECT+DELETE only (sql/159)."
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
        "Worker-reported job evidence preserved during backups for audit continuity.",
      executionMode: "generic"
    },
    {
      key: OMES_AI_PRIVACY_POSTURE_LIFECYCLE_KEY,
      tableName: "awcms_omes_ai_privacy_posture",
      ownerModuleKey: "omes_control",
      scope: "tenant",
      cursorColumn: "received_at",
      retentionClass: "audit_security",
      retentionMinDays: 90,
      retentionMaxDays: 1825,
      defaultRetentionDays: 730,
      partition: {
        eligible: false,
        rationale:
          "One current row per (tenant, server, deployment) target — bounded by fleet size, not append-only history."
      },
      archive: {
        archivable: false,
        rationale:
          "Bounded metadata evidence only (issue #217/ADR-0029); no raw prompt/transcript content ever reaches this table, so it carries no separate archival value beyond the two-year audit retention."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "Posture rows for a decommissioned/removed server past retention window are purged."
      },
      legalHold: {
        applicable: true,
        precedence: "overrides_retention"
      },
      requiredIndexes: [
        {
          columns: ["tenant_id", "received_at"],
          purpose: "Cursor scan index for retention purging."
        }
      ],
      batchLimit: 500,
      backupRestoreNotes:
        "AI privacy posture evidence preserved during backups for governance continuity.",
      executionMode: "generic"
    },
    {
      key: OMES_AI_EGRESS_APPROVALS_LIFECYCLE_KEY,
      tableName: "awcms_omes_ai_egress_approvals",
      ownerModuleKey: "omes_control",
      scope: "tenant",
      cursorColumn: "created_at",
      retentionClass: "audit_security",
      retentionMinDays: 365,
      retentionMaxDays: 1825,
      defaultRetentionDays: 730,
      partition: {
        eligible: false,
        rationale:
          "AI egress owner-approval requests are indexed by (tenant_id, idempotency_key); volume is bounded by administrative activity."
      },
      archive: {
        archivable: false,
        rationale:
          "The approval decision/reason is itself the durable governance evidence for a Confidential/Restricted egress decision; excluded from separate archival, kept in the primary table for its full retention window."
      },
      deletion: {
        mode: "hard_delete",
        rationale: "Approval request rows past the retention window are purged."
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
        "AI egress owner-approval decisions preserved during backups for governance continuity.",
      executionMode: "generic"
    },
    {
      key: OMES_HERMES_ORCHESTRATION_TREES_LIFECYCLE_KEY,
      tableName: "awcms_omes_hermes_orchestration_trees",
      ownerModuleKey: "omes_control",
      scope: "tenant",
      cursorColumn: "received_at",
      retentionClass: "operational_queue",
      retentionMinDays: 7,
      retentionMaxDays: 180,
      defaultRetentionDays: 30,
      partition: {
        eligible: false,
        rationale:
          "One current row per (tenant, server, session) target — bounded by concurrently active Hermes sessions, not append-only history."
      },
      archive: {
        archivable: false,
        rationale:
          "Live orchestration snapshots are ephemeral operational telemetry (issue #183); the durable activity record is the events table below."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "Snapshot rows for a session no longer being observed are purged after the retention window."
      },
      legalHold: {
        applicable: false,
        precedence: "not_applicable"
      },
      requiredIndexes: [
        {
          columns: ["tenant_id", "received_at"],
          purpose: "Cursor scan index for retention purging."
        }
      ],
      batchLimit: 500,
      backupRestoreNotes:
        "Ephemeral live-orchestration telemetry; excluded from disaster-recovery significance.",
      executionMode: "generic"
    },
    {
      key: OMES_HERMES_ORCHESTRATION_EVENTS_LIFECYCLE_KEY,
      tableName: "awcms_omes_hermes_orchestration_events",
      ownerModuleKey: "omes_control",
      scope: "tenant",
      cursorColumn: "received_at",
      retentionClass: "audit_security",
      retentionMinDays: 30,
      retentionMaxDays: 365,
      defaultRetentionDays: 90,
      partition: {
        eligible: false,
        rationale:
          "Append-only activity log indexed by (tenant_id, session_id, event_timestamp); volume is bounded by delegated-task throughput."
      },
      archive: {
        archivable: false,
        rationale:
          "Bounded metadata evidence only (issue #183); no raw prompt/transcript/tool-argument content ever reaches this table."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "Activity-stream rows past the retention window are purged; awcms_worker holds SELECT+DELETE only."
      },
      legalHold: {
        applicable: false,
        precedence: "not_applicable"
      },
      requiredIndexes: [
        {
          columns: ["tenant_id", "received_at"],
          purpose: "Cursor scan index for retention purging."
        }
      ],
      batchLimit: 500,
      backupRestoreNotes:
        "Recent orchestration activity preserved during backups for operational continuity; not a compliance record.",
      executionMode: "generic"
    },
    {
      key: OMES_REPOSITORY_PROGRESS_CONFIG_LIFECYCLE_KEY,
      tableName: "awcms_omes_repository_progress_config",
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
          "At most one configuration row per tenant (unique on tenant_id); volume is bounded by tenant count, never grows on its own."
      },
      archive: {
        archivable: false,
        rationale:
          "Admin-set configuration, not history — superseded by an update rather than archived."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "Deleted when an operator clears the configuration (application/repository-progress-config.ts's clearRepositoryProgressConfig), or cascades with the tenant."
      },
      legalHold: {
        applicable: false,
        precedence: "not_applicable"
      },
      requiredIndexes: [
        {
          columns: ["tenant_id"],
          purpose: "Unique per-tenant configuration lookup (sql/166)."
        },
        {
          columns: ["tenant_id", "created_at"],
          purpose: "Cursor scan index for retention purging (sql/166)."
        }
      ],
      batchLimit: 500,
      backupRestoreNotes:
        "Included in ordinary database backups; small, operator-set configuration.",
      executionMode: "generic"
    },
    {
      key: OMES_REPOSITORY_PROGRESS_LIFECYCLE_KEY,
      tableName: "awcms_omes_repository_progress",
      ownerModuleKey: "omes_control",
      scope: "tenant",
      cursorColumn: "updated_at",
      retentionClass: "operational_queue",
      retentionMinDays: 7,
      retentionMaxDays: 180,
      defaultRetentionDays: 30,
      partition: {
        eligible: false,
        rationale:
          "One current row per tenant (unique on tenant_id, upserted by every poll) — a live projection, not append-only history (issue ahliweb/omes#249, ADR-0030)."
      },
      archive: {
        archivable: false,
        rationale:
          "GitHub remains the authority for the underlying data; this is a disposable, re-fetchable observation, never a compliance record."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "Deleted when the tenant's repository configuration is cleared or changed, or cascades with the tenant."
      },
      legalHold: {
        applicable: false,
        precedence: "not_applicable"
      },
      requiredIndexes: [
        {
          columns: ["tenant_id"],
          purpose: "Unique per-tenant projection lookup (sql/166)."
        },
        {
          columns: ["tenant_id", "updated_at"],
          purpose: "Cursor scan index for retention purging (sql/166)."
        }
      ],
      batchLimit: 500,
      backupRestoreNotes:
        "Disposable, re-fetchable GitHub observation; excluded from disaster-recovery significance.",
      executionMode: "generic"
    }
  ]
});
