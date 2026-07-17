import { defineModule } from "../_shared/module-contract";

export const loggingModule = defineModule({
  key: "logging",
  name: "Logging & Audit Trail",
  version: "1.0.0",
  status: "active",
  description:
    "Cross-module audit trail (awcms_audit_events) and correlation ID propagation. Complements, not replaces, domain events and structured logs.",
  dependencies: ["tenant_admin"],
  api: {
    openApiPath: "openapi/awcms-public-api.openapi.yaml",
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
  ]
});
