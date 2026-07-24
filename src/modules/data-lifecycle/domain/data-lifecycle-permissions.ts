/**
 * Permission KEY CONSTANTS for `data_lifecycle` (ported from awcms-micro Issue
 * #745, ADR-0037). Mirrors the convention this base's other modules established:
 * a typed constants object, reused verbatim by `module.ts`'s `permissions`
 * array, the permission-seed migration (sql/056), and every route handler's
 * `authorizeInTransaction` guard — never re-typed as a string literal at more
 * than one call site.
 *
 * `legal_hold.create` and `legal_hold.release` are DELIBERATELY separate
 * permission codes (not one `legal_hold.manage`) — the "default-deny release"
 * requirement means a role holding `create` must NOT automatically be able to
 * `release` a hold; an operator grants them independently (e.g. a broad
 * "records" role gets `create`, a narrower "compliance officer" role
 * additionally gets `release`). The `data_lifecycle.legal_hold_maker_checker`
 * SoD rule (`module.ts`) enforces this as a genuine maker/checker conflict.
 */
export const DATA_LIFECYCLE_MODULE_KEY = "data_lifecycle";

export const DATA_LIFECYCLE_PERMISSIONS = {
  /** Read the code-declared high-volume table registry (metadata only — never row contents). */
  registryRead: "data_lifecycle.registry.read",
  /** Read legal hold records for the caller's tenant. */
  legalHoldRead: "data_lifecycle.legal_hold.read",
  /** Create a legal hold — does NOT itself grant the ability to release one. */
  legalHoldCreate: "data_lifecycle.legal_hold.create",
  /** Release (end) an active legal hold — distinct, default-deny separate from create. */
  legalHoldRelease: "data_lifecycle.legal_hold.release",
  /** Trigger an on-demand, read-only dry-run lifecycle plan for a descriptor. Action is `analyze` (existing `AccessAction`, `access-control.ts`) — a dry-run is exactly a read-only analysis, not a new verb. */
  planDryRun: "data_lifecycle.plan.analyze",
  /** Read lifecycle run history (dry-run/archive/purge outcomes — aggregated counts only). */
  runsRead: "data_lifecycle.runs.read"
} as const;

export type DataLifecyclePermissionKey =
  keyof typeof DATA_LIFECYCLE_PERMISSIONS;
export type DataLifecyclePermissionValue =
  (typeof DATA_LIFECYCLE_PERMISSIONS)[DataLifecyclePermissionKey];
