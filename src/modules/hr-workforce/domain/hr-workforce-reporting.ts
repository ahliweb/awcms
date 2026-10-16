/**
 * `hr_workforce` reporting projection (Issue #953;
 * `docs/awcms/workforce-metrics.md` section 5): the descriptor the module hands
 * to the existing `reporting` engine. There is no second analytics engine.
 *
 * ## What is a projection here and what is not
 *
 * The engine keeps TENANT-WIDE counters: one number per metric key per tenant,
 * readable by whoever holds the descriptor's `requiredPermission`. That shape
 * cannot say "this figure is for the employee only" or "withhold this when fewer
 * than five people contributed", so the engine is given exactly the figures for
 * which it is safe: how many clock-in, clock-out, break-start and break-end
 * events were recorded, all-time. Event VOLUME is the input of a headcount-times-
 * days sanity check; it is not a statement about any person's behaviour.
 *
 * Every figure that IS about behaviour (late arrivals, missed shifts, worked
 * time, coverage) is computed live by `GET /api/v1/hr-workforce/workforce-metrics/*`
 * from the effective record, where the viewer's relationship to the employee is
 * checked per request and small groups are suppressed. That is the
 * `drillDownPath` below.
 *
 * The projection's `requiredPermission` is the HR power
 * (`workforce_metrics.read`), because in a tenant of one employee even a volume
 * counter is that person's record.
 *
 * ## The source
 *
 * `awcms_hr_attendance_events`, append-only (privilege and trigger). The cursor
 * is `recorded_at`, the DATABASE's insert-time clock -- `occurred_at` is a
 * claimed instant that an offline replay writes in the past. A SUPERSEDED event
 * still counts: a counter only increases, so the figure is "events recorded",
 * not "effective events" (the live endpoints use the effective record).
 * No column is read other than `kind`: no person, no office, no time of day.
 */
import type {
  ProjectionCursorStream,
  ProjectionDescriptor
} from "../../_shared/module-contract";

export const WORKFORCE_METRICS_READ_PERMISSION =
  "hr_workforce.workforce_metrics.read";

export const WORKFORCE_EVENTS_TABLE = "awcms_hr_attendance_events";

export const WORKFORCE_EVENTS_PROJECTION_KEY = "hr_workforce.attendance_events";

export const WORKFORCE_EVENT_METRIC_KEYS = {
  clockIn: "clock_in_events",
  clockOut: "clock_out_events",
  breakStart: "break_start_events",
  breakEnd: "break_end_events"
} as const;

const FRESHNESS = {
  targetSeconds: 300,
  staleAfterSeconds: 1800,
  errorAfterConsecutiveFailures: 3
} as const;

const KIND_METRICS = [
  ["clock_in", WORKFORCE_EVENT_METRIC_KEYS.clockIn],
  ["clock_out", WORKFORCE_EVENT_METRIC_KEYS.clockOut],
  ["break_start", WORKFORCE_EVENT_METRIC_KEYS.breakStart],
  ["break_end", WORKFORCE_EVENT_METRIC_KEYS.breakEnd]
] as const;

function eventsStream(): ProjectionCursorStream {
  return {
    streamKey: "attendance_events",
    tableName: WORKFORCE_EVENTS_TABLE,
    cursorColumn: "recorded_at",
    metrics: KIND_METRICS.map(([kind, metricKey]) => ({
      metricKey,
      effect: "increment" as const,
      matchColumn: "kind",
      matchValue: kind
    }))
  };
}

export const HR_WORKFORCE_REPORTING_PROJECTIONS: ProjectionDescriptor[] = [
  {
    key: WORKFORCE_EVENTS_PROJECTION_KEY,
    version: 1,
    ownerModuleKey: "hr_workforce",
    scope: "tenant",
    description:
      "All-time counts of attendance events recorded per kind (clock-in, clock-out, break start, break end), incrementally derived from the append-only attendance history. Volume only: no person, office or time of day is read. A superseded event still counts (a counter only increases); the per-employee facts of the contract (late arrivals, missed shifts, worked time, coverage) are computed live from the effective record by the workforce-metrics endpoints, where visibility is checked per viewer and small groups are suppressed.",
    source: { strategy: "cursor_table", streams: [eventsStream()] },
    rebuildSource: { streams: [eventsStream()] },
    metricLabels: {
      [WORKFORCE_EVENT_METRIC_KEYS.clockIn]: "Clock-in events recorded",
      [WORKFORCE_EVENT_METRIC_KEYS.clockOut]: "Clock-out events recorded",
      [WORKFORCE_EVENT_METRIC_KEYS.breakStart]: "Break-start events recorded",
      [WORKFORCE_EVENT_METRIC_KEYS.breakEnd]: "Break-end events recorded"
    },
    requiredPermission: WORKFORCE_METRICS_READ_PERMISSION,
    freshness: FRESHNESS,
    drillDownPath: "/api/v1/hr-workforce/workforce-metrics/employees",
    retentionClass:
      "The source is awcms_hr_attendance_events, registered with data_lifecycle as retained and never purged today (hr_workforce.attendance_events), so a rebuild reproduces the all-time figure. The projection's own rows are small per-tenant counters.",
    batchLimit: 2000
  }
];
