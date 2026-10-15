/**
 * `booking` reporting projections (Issue #944, ADR-0131; docs/awcms/booking.md
 * section 7.2): the descriptors the module hands to the existing `reporting`
 * engine. There is no second analytics engine -- these are three
 * `ProjectionDescriptor`s, read by the same incremental worker, rebuilt by the
 * same bounded passes and reconciled by the same control totals as every other
 * projection.
 *
 * ## Why the event TABLE and not the domain events (trade-off)
 *
 * `reporting` supports two steady-state strategies. The nine live
 * `awcms.booking.reservation.*` events could drive a `domain_event` projection;
 * the append-only `awcms_booking_reservation_events` table drives a
 * `cursor_table` one. The table is chosen because:
 *
 * - **A rebuild must read an authoritative table anyway.** Every projection,
 *   whatever its steady state, is rebuilt from a `cursor_table` re-scan of its
 *   source. With a table source the steady state and the rebuild are the SAME
 *   scan, so they cannot disagree; with an event consumer the two paths need a
 *   rebuild-deferral protocol (see `event-activity-projection.ts`) to avoid a
 *   lost or double count. The table is genuinely append-only (a trigger rejects
 *   UPDATE/DELETE), the one precondition `cursor_table` needs.
 * - **The facts are on the row.** The quantities a projection sums (unit-nights,
 *   seconds) are stamped on the history row in the transition's own transaction
 *   (`sql/244`); the event payload deliberately carries no such figure.
 * - **No outbox dependency.** An event consumer sees an event only after the
 *   outbox dispatcher published it, so a stopped dispatcher would stall the
 *   dashboard. The table is written in the transition's transaction.
 *
 * The cost is polling latency (the freshness policy below: current under five
 * minutes) instead of push, which a dashboard figure does not need.
 *
 * ## Everything is a counter that only increases
 *
 * The engine clamps a decrement at zero, so no metric here decrements. "Net" is
 * `booked - released`, computed at READ time from two monotonic counters
 * (booking.md section 7.2), which is also what makes a rebuild reproduce the
 * same figure.
 *
 * ## No person, no money
 *
 * The source columns are a status word and four integers. No customer
 * reference, note, reason text or amount is selected by any stream, and booking
 * holds none of the last (booking.md section 3).
 */
import type {
  ProjectionCursorStream,
  ProjectionDescriptor
} from "../../_shared/module-contract";

export const BOOKING_REPORTS_PERMISSION = "booking.reports.read";

export const BOOKING_EVENTS_TABLE = "awcms_booking_reservation_events";

export const BOOKING_RESERVATIONS_PROJECTION_KEY = "booking.reservations";
export const BOOKING_TIME_PROJECTION_KEY = "booking.time";
export const BOOKING_NIGHTS_PROJECTION_KEY = "booking.nights";

export const BOOKING_RESERVATION_METRIC_KEYS = {
  created: "created",
  held: "held",
  confirmed: "confirmed",
  cancelled: "cancelled",
  lateCancelled: "late_cancelled",
  rescheduled: "rescheduled",
  expired: "expired",
  checkedIn: "checked_in",
  completed: "completed",
  noShow: "no_show"
} as const;

export const BOOKING_TIME_METRIC_KEYS = {
  bookedSeconds: "booked_seconds",
  releasedSeconds: "released_seconds"
} as const;

export const BOOKING_NIGHTS_METRIC_KEYS = {
  bookedNights: "booked_nights",
  releasedNights: "released_nights"
} as const;

/**
 * A booking projection is a dashboard figure refreshed by the maintenance
 * worker: current for five minutes, stale after thirty (the same policy as the
 * other `cursor_table` projections).
 */
const FRESHNESS = {
  targetSeconds: 300,
  staleAfterSeconds: 1800,
  errorAfterConsecutiveFailures: 3
} as const;

const DRILL_DOWN = "/api/v1/booking/reports/reservations";

const RETENTION_CLASS =
  "The source is awcms_booking_reservation_events, registered with data_lifecycle as retained and never purged (booking.reservation_events), so a rebuild reproduces the all-time figure. The projection's own rows are small per-tenant counters.";

const BATCH_LIMIT = 2000;

/** The kinds counted from the plain `kind` column; `late_cancelled` is read from the generated `projection_kind` (sql/244). */
const KIND_METRICS = [
  ["created", BOOKING_RESERVATION_METRIC_KEYS.created],
  ["held", BOOKING_RESERVATION_METRIC_KEYS.held],
  ["confirmed", BOOKING_RESERVATION_METRIC_KEYS.confirmed],
  ["cancelled", BOOKING_RESERVATION_METRIC_KEYS.cancelled],
  ["rescheduled", BOOKING_RESERVATION_METRIC_KEYS.rescheduled],
  ["expired", BOOKING_RESERVATION_METRIC_KEYS.expired],
  ["checked_in", BOOKING_RESERVATION_METRIC_KEYS.checkedIn],
  ["completed", BOOKING_RESERVATION_METRIC_KEYS.completed],
  ["no_show", BOOKING_RESERVATION_METRIC_KEYS.noShow]
] as const;

function reservationsStream(): ProjectionCursorStream {
  return {
    streamKey: "reservation_events",
    tableName: BOOKING_EVENTS_TABLE,
    cursorColumn: "created_at",
    metrics: [
      ...KIND_METRICS.map(([kind, metricKey]) => ({
        metricKey,
        effect: "increment" as const,
        matchColumn: "kind",
        matchValue: kind
      })),
      {
        metricKey: BOOKING_RESERVATION_METRIC_KEYS.lateCancelled,
        effect: "increment" as const,
        matchColumn: "projection_kind",
        matchValue: "late_cancelled"
      }
    ]
  };
}

function timeStream(): ProjectionCursorStream {
  return {
    streamKey: "reservation_events",
    tableName: BOOKING_EVENTS_TABLE,
    cursorColumn: "created_at",
    metrics: [
      {
        metricKey: BOOKING_TIME_METRIC_KEYS.bookedSeconds,
        effect: "increment",
        sumColumn: "booked_seconds"
      },
      {
        metricKey: BOOKING_TIME_METRIC_KEYS.releasedSeconds,
        effect: "increment",
        sumColumn: "released_seconds"
      }
    ]
  };
}

function nightsStream(): ProjectionCursorStream {
  return {
    streamKey: "reservation_events",
    tableName: BOOKING_EVENTS_TABLE,
    cursorColumn: "created_at",
    metrics: [
      {
        metricKey: BOOKING_NIGHTS_METRIC_KEYS.bookedNights,
        effect: "increment",
        sumColumn: "booked_nights"
      },
      {
        metricKey: BOOKING_NIGHTS_METRIC_KEYS.releasedNights,
        effect: "increment",
        sumColumn: "released_nights"
      }
    ]
  };
}

export const BOOKING_REPORTING_PROJECTIONS: ProjectionDescriptor[] = [
  {
    key: BOOKING_RESERVATIONS_PROJECTION_KEY,
    version: 1,
    ownerModuleKey: "booking",
    scope: "tenant",
    description:
      "All-time reservation transition counts per kind (created, held, confirmed, cancelled, late_cancelled, rescheduled, expired, checked_in, completed, no_show), incrementally derived from the append-only booking history. The inputs of the hold pipeline, cancellation and no-show figures. A hold is counted under `held`, never added to any occupancy figure (O8).",
    source: { strategy: "cursor_table", streams: [reservationsStream()] },
    rebuildSource: { streams: [reservationsStream()] },
    metricLabels: {
      [BOOKING_RESERVATION_METRIC_KEYS.created]: "Reservations created",
      [BOOKING_RESERVATION_METRIC_KEYS.held]: "Holds placed",
      [BOOKING_RESERVATION_METRIC_KEYS.confirmed]: "Reservations confirmed",
      [BOOKING_RESERVATION_METRIC_KEYS.cancelled]: "Reservations cancelled",
      [BOOKING_RESERVATION_METRIC_KEYS.lateCancelled]:
        "Late cancellations (subset of cancelled)",
      [BOOKING_RESERVATION_METRIC_KEYS.rescheduled]: "Reservations rescheduled",
      [BOOKING_RESERVATION_METRIC_KEYS.expired]: "Holds expired",
      [BOOKING_RESERVATION_METRIC_KEYS.checkedIn]: "Checked in",
      [BOOKING_RESERVATION_METRIC_KEYS.completed]: "Completed",
      [BOOKING_RESERVATION_METRIC_KEYS.noShow]: "No-shows"
    },
    requiredPermission: BOOKING_REPORTS_PERMISSION,
    freshness: FRESHNESS,
    drillDownPath: DRILL_DOWN,
    retentionClass: RETENTION_CLASS,
    batchLimit: BATCH_LIMIT
  },
  {
    key: BOOKING_TIME_PROJECTION_KEY,
    version: 1,
    ownerModuleKey: "booking",
    scope: "tenant",
    description:
      "Booked and released service-interval seconds of time (slot) reservations, all-time. Net booked = booked - released, computed at read. The input of utilization; its denominator (available seconds) is a pure function of the schedule expansion and is computed live by GET /api/v1/booking/reports/utilization.",
    source: { strategy: "cursor_table", streams: [timeStream()] },
    rebuildSource: { streams: [timeStream()] },
    metricLabels: {
      [BOOKING_TIME_METRIC_KEYS.bookedSeconds]: "Booked seconds (all-time)",
      [BOOKING_TIME_METRIC_KEYS.releasedSeconds]: "Released seconds (all-time)"
    },
    requiredPermission: BOOKING_REPORTS_PERMISSION,
    freshness: FRESHNESS,
    drillDownPath: "/api/v1/booking/reports/utilization",
    retentionClass: RETENTION_CLASS,
    batchLimit: BATCH_LIMIT
  },
  {
    key: BOOKING_NIGHTS_PROJECTION_KEY,
    version: 1,
    ownerModuleKey: "booking",
    scope: "tenant",
    description:
      "Booked and released UNIT-NIGHTS of stay reservations, all-time: one per unit and night, so a two-night stay on one unit is two and on three units is six. Net booked nights = booked - released, computed at read. Holds are never booked.",
    source: { strategy: "cursor_table", streams: [nightsStream()] },
    rebuildSource: { streams: [nightsStream()] },
    metricLabels: {
      [BOOKING_NIGHTS_METRIC_KEYS.bookedNights]:
        "Booked unit-nights (all-time)",
      [BOOKING_NIGHTS_METRIC_KEYS.releasedNights]:
        "Released unit-nights (all-time)"
    },
    requiredPermission: BOOKING_REPORTS_PERMISSION,
    freshness: FRESHNESS,
    drillDownPath: "/api/v1/booking/reports/occupancy",
    retentionClass: RETENTION_CLASS,
    batchLimit: BATCH_LIMIT
  }
];

/** Net of a booked/released counter pair, never negative. Computed at read so a rebuild reproduces it. */
export function netOf(booked: number, released: number): number {
  return Math.max(0, booked - released);
}
