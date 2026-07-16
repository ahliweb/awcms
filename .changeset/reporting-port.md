---
"awcms": minor
---

Add the reporting module: management reporting views plus a module-contributed
read-model projection mechanism, ported from awcms-mini.

- Five generic live read-aggregation views under `/api/v1/reports/*` (tenant
  activity, access/audit summary, sync health, module usage, email queue
  health), each gated by `reporting.dashboard.read`. The access/audit view
  counts this repo's real cross-module audit trail (`awcms_audit_events`)
  rather than the mini base's `profile_audit_logs` proxy.
- A module-contributed read-model projection extension: modules declare
  `reportingProjections` descriptors in their own `module.ts`, and reporting's
  engine maintains them via incremental cursor-table scans or a registered
  `domain_event_runtime` consumer, with idempotent crash-safe rebuild,
  live-computed freshness/staleness signals, on-demand source reconciliation,
  and scheduled CSV/JSON exports (manifest/checksum/expiry, secure
  tenant-scoped checksum-verified download). Three projections are registered
  (access-audit summary, module-activity summary, and an event-driven
  event-activity demonstration).
- New migration `015_awcms_reporting_projections_schema.sql`: seven
  tenant-scoped tables (projection state/cursors/metrics, rebuild runs,
  reconciliation runs, scheduled exports, export runs), all with FORCE row
  level security tenant-isolation policies, indexed foreign keys, a partial
  unique index guaranteeing at most one running rebuild per (tenant,
  projection), `timestamptz`, and `bigint` counters. Migration
  `016_awcms_reporting_permissions.sql` seeds the `reporting.dashboard.read`,
  `reporting.projections.{read,rebuild,analyze}`, and
  `reporting.exports.{read,configure,export}` permissions.
- New REST endpoints under `/api/v1/reports/projections` and
  `/api/v1/reports/exports` (list/detail/rebuild/cancel/reconcile, scheduled
  export create/disable/trigger, run history/download). Every mutation is
  ABAC-guarded, and rebuild/cancel/create/disable/trigger require an
  `Idempotency-Key` and write an audit event.
- New scheduled worker scripts `reporting:projections:refresh` and
  `reporting:exports:dispatch` (pure PostgreSQL / local filesystem, safe in
  offline/LAN deployments) plus the pure-code
  `reporting:projections:registry:check` gate.
- The `_shared/module-contract` gains the optional `reportingProjections`
  field and the `ProjectionDescriptor` type family (contract version bumped to
  `1.1.0`), the domain-event-runtime consumer registry gains the reporting
  event-activity projector consumer (the one deliberate
  `domain_event_runtime -> reporting` edge), and the identity-access
  `AccessAction` union gains `rebuild`/`analyze`/`export`.
