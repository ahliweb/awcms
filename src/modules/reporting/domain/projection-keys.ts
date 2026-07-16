/**
 * Stable string constants for `reporting`'s three registered projections
 * (Issue #753) — single source of truth reused by `module.ts` (the actual
 * `ProjectionDescriptor` objects), `application/event-activity-
 * projection.ts` (the domain-event consumer handler), and every test —
 * never re-typed as a string literal at more than one call site (same
 * discipline `data-lifecycle-permissions.ts` established for permission
 * keys).
 */
export const ACCESS_AUDIT_SUMMARY_PROJECTION_KEY =
  "reporting.access_audit_summary";
export const MODULE_ACTIVITY_SUMMARY_PROJECTION_KEY =
  "reporting.module_activity_summary";
export const EVENT_ACTIVITY_SUMMARY_PROJECTION_KEY =
  "reporting.event_activity_summary";

export const EVENT_ACTIVITY_PROJECTOR_CONSUMER_NAME =
  "reporting.event_activity_projector";

/**
 * `rebuildSource.streams[0].streamKey` for `event_activity_summary`
 * (`module.ts`) — also read directly by `application/event-activity-
 * projection.ts` to compare a live event's `occurredAt` against how far a
 * (possibly since-completed or since-cancelled) rebuild's own re-scan of
 * `awcms_domain_events` actually reached, so a deferred live delivery
 * retried after mutual exclusion lifts can tell "already counted by the
 * rebuild" apart from "never counted by anything" (security-auditor
 * finding, PR #781 — see that file's own header comment for the full
 * double-counting-vs-permanent-loss analysis this constant exists to
 * resolve).
 */
export const EVENT_ACTIVITY_REBUILD_STREAM_KEY =
  "domain_events_sample_recorded";

/** Metric keys — see each projection's own descriptor in `module.ts` for the exact source contract these are computed from. */
export const ACCESS_AUDIT_METRIC_KEYS = {
  allowCount: "allow_count",
  denyCount: "deny_count",
  totalCount: "total_count"
} as const;

export const MODULE_ACTIVITY_METRIC_KEYS = {
  identitiesCount: "identities_count",
  syncNodesCount: "sync_nodes_count"
} as const;

export const EVENT_ACTIVITY_METRIC_KEYS = {
  sampleRecordedCount: "sample_recorded_count"
} as const;
