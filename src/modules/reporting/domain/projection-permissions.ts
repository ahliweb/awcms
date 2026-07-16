/**
 * Permission KEY CONSTANTS for the reporting projection/export surface
 * (Issue #753). Same convention `data-lifecycle/domain/data-lifecycle-
 * permissions.ts` established: a typed constants object, reused verbatim
 * by `module.ts`'s `permissions` array, the permission-seed migration
 * (070), and every route handler's `authorizeInTransaction` guard —
 * never re-typed as a string literal at more than one call site.
 *
 * Additive to the existing single `reporting.dashboard.read` permission
 * (migration 010, Issue 9.1) — the five LIVE `/api/v1/reports/*`
 * aggregation views keep using that permission unchanged; these six are
 * new and gate ONLY the projection/rebuild/export surface this issue adds.
 */
export const REPORTING_MODULE_KEY = "reporting";

export const REPORTING_PROJECTION_PERMISSIONS = {
  /** Read a projection's registry metadata, current snapshot value, and freshness status. */
  projectionsRead: "reporting.projections.read",
  /** Trigger (or resume) a projection rebuild — high-risk (`AccessAction.rebuild`), reason-required, `Idempotency-Key`-required, audited. */
  projectionsRebuild: "reporting.projections.rebuild",
  /** Trigger an on-demand reconciliation of a projection against its source control total. Action is `analyze` (existing `AccessAction`) — same "a read-only analysis is not a new verb" precedent `data_lifecycle.plan.analyze` established. */
  projectionsAnalyze: "reporting.projections.analyze",
  /** Read scheduled export configs, export run history, and download a completed export. */
  exportsRead: "reporting.exports.read",
  /** Create/disable a scheduled export config — high-risk (`configure`), `Idempotency-Key`-required, audited. */
  exportsConfigure: "reporting.exports.configure",
  /** Manually trigger an export run for a projection — high-risk (`export`), `Idempotency-Key`-required, audited. */
  exportsTrigger: "reporting.exports.export"
} as const;

export type ReportingProjectionPermissionKey =
  keyof typeof REPORTING_PROJECTION_PERMISSIONS;
export type ReportingProjectionPermissionValue =
  (typeof REPORTING_PROJECTION_PERMISSIONS)[ReportingProjectionPermissionKey];
