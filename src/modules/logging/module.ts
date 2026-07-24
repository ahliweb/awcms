import { defineModule } from "../_shared/module-contract";

/**
 * Single source of truth for this module's `dataLifecycle` descriptor key,
 * shared with `application/audit-purge.ts` (ADR-0037) so the actual purge
 * function and the registry entry a legal hold is created against can never
 * drift apart: a hold created against this key must be checked by
 * `purgeExpiredAuditEvents` using this SAME literal.
 */
export const LOGGING_AUDIT_EVENTS_LIFECYCLE_KEY = "logging.audit_events";

export const loggingModule = defineModule({
  key: "logging",
  name: "Logging & Audit Trail",
  version: "1.0.0",
  status: "active",
  description:
    "Cross-module audit trail (awcms_audit_events) and correlation ID propagation. Complements, not replaces, domain events and structured logs.",
  dependencies: ["tenant_admin"],
  api: {
    openApiPath: "openapi/modules/logging.openapi.yaml",
    basePath: "/api/v1/logs"
  },
  permissions: [
    {
      activityCode: "audit_trail",
      action: "read",
      description: "Read audit trail events"
    }
  ],
  jobs: [
    {
      command: "bun run logs:audit:purge",
      purpose:
        "Delete awcms_audit_events rows past retention (AUDIT_LOG_RETENTION_DAYS, default 730 days) for every active tenant, in bounded batches, recording each purge as its own audit event.",
      recommendedSchedule:
        "Daily, off-peak (e.g. 03:00) via cron/systemd timer. Run with --dry-run first on a database that has never been purged — the first real run's backlog is every event ever written past the cutoff.",
      environmentNotes:
        "Pure PostgreSQL operation — no external network egress. Safe in offline/LAN deployments. Without this job scheduled, AUDIT_LOG_RETENTION_DAYS has no effect at all (Issue #146).",
      safeInOfflineLan: true
    }
  ],
  // ADR-0037 (data_lifecycle) — registered as a "delegated" adopter:
  // data_lifecycle's dry-run planner may READ awcms_audit_events for backlog
  // visibility, but real purge stays owned by `purgeExpiredAuditEvents`
  // (`bun run logs:audit:purge`), which now consults a LegalHoldGuardPort
  // before its bounded DELETE.
  dataLifecycle: [
    {
      key: LOGGING_AUDIT_EVENTS_LIFECYCLE_KEY,
      tableName: "awcms_audit_events",
      ownerModuleKey: "logging",
      scope: "tenant",
      cursorColumn: "created_at",
      retentionClass: "audit_security",
      retentionMinDays: 365,
      retentionMaxDays: 1825,
      defaultRetentionDays: 730,
      partition: {
        eligible: true,
        granularity: "monthly",
        rationale:
          "High insert volume, append-only, age-based purge only (no updates) — a textbook monthly range-partition candidate. Not automated by this port (destructive migration of an existing table is out of scope) — tracked as partitioning runbook guidance for a future issue."
      },
      archive: {
        archivable: false,
        rationale:
          "Current reality: purgeExpiredAuditEvents performs a straight age-based DELETE with no archive step. Adding one is a natural follow-up (audit trail is a strong archive candidate for ISO 27001/22301 evidence) but is not implemented — declaring archivable:true here without a real archive step would be inaccurate, not aspirational."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "Matches purgeExpiredAuditEvents' existing behavior exactly — age-only cutoff, no cascading FK children (migration 007)."
      },
      legalHold: {
        applicable: true,
        precedence: "overrides_retention"
      },
      requiredIndexes: [
        {
          columns: ["tenant_id", "created_at"],
          purpose:
            "awcms_audit_events_tenant_created_idx (migration 007) — the same index purgeExpiredAuditEvents' own age-based DELETE already relies on."
        }
      ],
      batchLimit: 5000,
      backupRestoreNotes:
        "Included in ordinary full-database backup/restore; no standalone archive artifact exists yet (archive.archivable is false above).",
      executionMode: "delegated",
      existingAdopter: {
        jobCommand: "bun run logs:audit:purge",
        purgeFunctionRef:
          "src/modules/logging/application/audit-purge.ts#purgeExpiredAuditEvents",
        description:
          "Deletes rows past AUDIT_LOG_RETENTION_DAYS (default 730d) in bounded batches of AUDIT_EVENT_PURGE_BATCH_LIMIT (5000), auditing the purge itself as a new audit event. The bounded DELETE is gated by a LegalHoldGuardPort (ADR-0037) — a REQUIRED param so no call site can silently skip the check."
      }
    }
  ]
});
