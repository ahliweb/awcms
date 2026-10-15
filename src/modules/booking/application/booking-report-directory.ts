/**
 * The ONLY place `booking` reports read rows (Issue #944, ADR-0131; docs/awcms/
 * booking.md section 7.2). It runs inside the caller's tenant transaction, asks
 * the database for small AGGREGATES (never a reservation row), and hands them to
 * the pure shaping functions of `domain/booking-report.ts`. Nothing here writes.
 *
 * ## What these reports are, next to the projections
 *
 * The `booking.*` projections on the `reporting` engine are ALL-TIME counters
 * (the dashboard figure). These routes are the LIVE, re-authorized detail the
 * projections point at (`drillDownPath`): per Asia/Jakarta day, per resource,
 * for a window. The two agree where they overlap -- `net booked` seconds and
 * nights of the projections equal the sums reported here when the window spans
 * every reservation -- which is what the integration tests pin.
 *
 * ## No person, no money
 *
 * Every query selects counts and sums. No customer reference, note, reason,
 * actor or amount is read; there is no price to read.
 *
 * ## Tenant-scoped twice
 *
 * Every query names `tenant_id` AND runs under RLS FORCE, so another tenant's
 * resource id is simply absent from the answer.
 */
import {
  availableSeconds,
  NET_BOOKED_STATUSES,
  OCCUPYING_STATUSES,
  REPORT_LIMITS,
  REPORT_TIMEZONE,
  reportDayWindows,
  reportRangeInstants,
  shapeLeadTimeGroups,
  shapeOccupancyDay,
  shapeOutcomes,
  shapePipeline,
  shapeUtilizationDay,
  type LeadTimeGroup,
  type LeadTimeReport,
  type OccupancyDay,
  type OutcomeReport,
  type PipelineReport,
  type ReportRange,
  type UtilizationDay
} from "../domain/booking-report";
import { expandOpenWindows } from "../domain/booking-schedule";
import {
  loadExceptions,
  loadSchedules
} from "./booking-availability-directory";
import { addDays } from "../domain/booking-time";

type Sql = Bun.SQL;

type ResourceRow = {
  id: string;
  code: string;
  name: string;
  timezone: string;
  units: number;
};

async function loadResources(
  tx: Sql,
  tenantId: string,
  mode: "slot" | "stay",
  resourceId: string | null
): Promise<{ resources: ResourceRow[]; truncated: boolean }> {
  const rows = (await tx`
    SELECT r.id, r.code, r.name, r.timezone,
           (SELECT count(*)::int FROM awcms_booking_resource_units u
             WHERE u.tenant_id = r.tenant_id AND u.resource_id = r.id
               AND u.status = 'active') AS units
    FROM awcms_booking_resources r
    WHERE r.tenant_id = ${tenantId}
      AND r.booking_mode = ${mode}
      AND r.deleted_at IS NULL
      AND (${resourceId}::uuid IS NULL OR r.id = ${resourceId}::uuid)
    ORDER BY r.sort_order, r.code, r.id
    LIMIT ${REPORT_LIMITS.maxResources + 1}
  `) as ResourceRow[];

  return {
    resources: rows.slice(0, REPORT_LIMITS.maxResources),
    truncated: rows.length > REPORT_LIMITS.maxResources
  };
}

/** uuids as one comma-joined text: Bun.SQL does not bind a JS array as a Postgres array (see the availability directory). */
function idList(resources: readonly ResourceRow[]): string {
  return resources.map((resource) => resource.id).join(",");
}

// -- Occupancy ------------------------------------------------------------------------

export type OccupancyResource = {
  resourceId: string;
  code: string;
  name: string;
  units: number;
  days: OccupancyDay[];
  totals: {
    unitNights: number;
    occupiedUnitNights: number;
    heldUnitNights: number;
    blockedUnitNights: number;
    occupancyRate: number | null;
  };
};

export type OccupancyReport = {
  timezone: typeof REPORT_TIMEZONE;
  from: string;
  to: string;
  resources: OccupancyResource[];
  truncated: boolean;
};

/**
 * Occupancy of STAY resources per local night, per unit-night (O8: holds
 * excluded, reported beside as `heldUnitNights`). The night expansion is done by
 * the database (`generate_series` over the window) so a 92-day report over many
 * stays returns one row per resource and night, not one per reservation.
 *
 * Units are the units active NOW: a unit retired last month is not in the
 * denominator of last month's report (the unit history is not kept, booking.md
 * section 4), which is stated in the OpenAPI description.
 */
export async function occupancyReport(
  tx: Sql,
  tenantId: string,
  range: ReportRange
): Promise<OccupancyReport> {
  const { resources, truncated } = await loadResources(
    tx,
    tenantId,
    "stay",
    range.resourceId
  );
  const nights = windowDates(range);

  if (resources.length === 0) {
    return {
      timezone: REPORT_TIMEZONE,
      from: range.from,
      to: range.to,
      resources: [],
      truncated
    };
  }

  const occupying = OCCUPYING_STATUSES.join(",");
  const rows = (await tx`
    SELECT a.resource_id,
           to_char(${range.from}::date + g.n, 'YYYY-MM-DD') AS night,
           count(*) FILTER (
             WHERE a.block_id IS NULL
               AND r.status = ANY(string_to_array(${occupying}::text, ','))
           )::int AS occupied,
           count(*) FILTER (
             WHERE a.block_id IS NULL AND r.status = 'held'
               AND r.hold_expires_at > clock_timestamp()
           )::int AS held,
           count(*) FILTER (WHERE a.block_id IS NOT NULL)::int AS blocked
    FROM generate_series(0, ${nights.length - 1}) AS g(n)
    JOIN awcms_booking_resource_allocations a
      ON a.tenant_id = ${tenantId}
     AND a.granularity = 'stay'
     AND a.released_at IS NULL
     AND a.resource_id = ANY(string_to_array(${idList(resources)}::text, ',')::uuid[])
     AND a.stay_from <= (${range.from}::date + g.n)
     AND (${range.from}::date + g.n) < a.stay_to
    LEFT JOIN awcms_booking_reservation_items i
      ON i.tenant_id = a.tenant_id AND i.id = a.item_id
    LEFT JOIN awcms_booking_reservations r
      ON r.tenant_id = i.tenant_id AND r.id = i.reservation_id
    GROUP BY a.resource_id, g.n
  `) as {
    resource_id: string;
    night: string;
    occupied: number;
    held: number;
    blocked: number;
  }[];
  const byKey = new Map(
    rows.map((row) => [`${row.resource_id}|${row.night}`, row])
  );

  return {
    timezone: REPORT_TIMEZONE,
    from: range.from,
    to: range.to,
    truncated,
    resources: resources.map((resource) => {
      const days = nights.map((night) => {
        const row = byKey.get(`${resource.id}|${night}`);

        return shapeOccupancyDay({
          date: night,
          units: resource.units,
          occupiedUnitNights: row?.occupied ?? 0,
          heldUnitNights: row?.held ?? 0,
          blockedUnitNights: row?.blocked ?? 0
        });
      });
      const unitNights = days.reduce((sum, day) => sum + day.units, 0);
      const occupied = days.reduce(
        (sum, day) => sum + day.occupiedUnitNights,
        0
      );
      const total = shapeOccupancyDay({
        date: range.from,
        units: unitNights,
        occupiedUnitNights: occupied,
        heldUnitNights: days.reduce((sum, day) => sum + day.heldUnitNights, 0),
        blockedUnitNights: days.reduce(
          (sum, day) => sum + day.blockedUnitNights,
          0
        )
      });

      return {
        resourceId: resource.id,
        code: resource.code,
        name: resource.name,
        units: resource.units,
        days,
        totals: {
          unitNights,
          occupiedUnitNights: occupied,
          heldUnitNights: total.heldUnitNights,
          blockedUnitNights: total.blockedUnitNights,
          occupancyRate: total.occupancyRate
        }
      };
    })
  };
}

function windowDates(range: ReportRange): string[] {
  return reportDayWindows(range.from, range.to).map((window) => window.date);
}

// -- Utilization ----------------------------------------------------------------------

export type UtilizationResource = {
  resourceId: string;
  code: string;
  name: string;
  units: number;
  days: UtilizationDay[];
  totals: {
    bookedSeconds: number;
    availableSeconds: number;
    utilization: number | null;
  };
};

export type UtilizationReport = {
  timezone: typeof REPORT_TIMEZONE;
  from: string;
  to: string;
  resources: UtilizationResource[];
  truncated: boolean;
};

/**
 * Utilization of SLOT resources per Asia/Jakarta day: net-booked service seconds
 * (buffers excluded, holds excluded) over the seconds the schedule leaves open,
 * times the active units. Booked seconds are clipped to each day window by the
 * database; available seconds are the pure schedule expansion
 * (`expandOpenWindows`, the same function availability uses) clipped the same
 * way, so the numerator and denominator can never disagree about a day edge.
 *
 * Whether the denominator should also exclude maintenance closures and whether
 * booked should be actual (`checked_in` -> `completed`) time are still open
 * under O8; this report uses the schedule as written and booked as booked.
 */
export async function utilizationReport(
  tx: Sql,
  tenantId: string,
  range: ReportRange
): Promise<UtilizationReport> {
  const { resources, truncated } = await loadResources(
    tx,
    tenantId,
    "slot",
    range.resourceId
  );
  const windows = reportDayWindows(range.from, range.to);

  if (resources.length === 0) {
    return {
      timezone: REPORT_TIMEZONE,
      from: range.from,
      to: range.to,
      resources: [],
      truncated
    };
  }

  const net = NET_BOOKED_STATUSES.join(",");
  const starts = windows
    .map((window) => new Date(window.startMs).toISOString())
    .join(",");
  const ends = windows
    .map((window) => new Date(window.endMs).toISOString())
    .join(",");
  const rows = (await tx`
    SELECT a.resource_id, days.ord::int AS ord,
           sum(floor(extract(epoch FROM
             least(a.ends_at, days.de) - greatest(a.starts_at, days.ds))))::bigint
             AS seconds
    FROM (
      SELECT t.ds_text::timestamptz AS ds, t.de_text::timestamptz AS de, t.ord
      FROM unnest(
             string_to_array(${starts}::text, ','),
             string_to_array(${ends}::text, ',')
           ) WITH ORDINALITY AS t(ds_text, de_text, ord)
    ) days
    JOIN awcms_booking_resource_allocations a
      ON a.tenant_id = ${tenantId}
     AND a.granularity = 'time'
     AND a.released_at IS NULL
     AND a.resource_id = ANY(string_to_array(${idList(resources)}::text, ',')::uuid[])
     AND a.starts_at < days.de
     AND a.ends_at > days.ds
    JOIN awcms_booking_reservation_items i
      ON i.tenant_id = a.tenant_id AND i.id = a.item_id
    JOIN awcms_booking_reservations r
      ON r.tenant_id = i.tenant_id AND r.id = i.reservation_id
     AND r.status = ANY(string_to_array(${net}::text, ','))
    GROUP BY a.resource_id, days.ord
  `) as { resource_id: string; ord: number; seconds: string | number }[];
  const booked = new Map(
    rows.map((row) => [`${row.resource_id}|${row.ord}`, Number(row.seconds)])
  );
  const span = reportRangeInstants(range.from, range.to);
  const out: UtilizationResource[] = [];

  for (const resource of resources) {
    const fromDate = addDays(range.from, -1);
    const toDate = addDays(range.to, 1);
    const schedules = await loadSchedules(
      tx,
      tenantId,
      resource.id,
      fromDate,
      toDate
    );
    const exceptions = await loadExceptions(
      tx,
      tenantId,
      resource.id,
      schedules.map((schedule) => schedule.id),
      fromDate,
      toDate
    );
    const open = expandOpenWindows({
      resourceId: resource.id,
      timezone: resource.timezone,
      schedules,
      exceptions,
      fromMs: span.startMs,
      toMs: span.endMs
    });
    const days = windows.map((window, index) =>
      shapeUtilizationDay(
        window.date,
        booked.get(`${resource.id}|${index + 1}`) ?? 0,
        availableSeconds(open, window, resource.units)
      )
    );
    const bookedTotal = days.reduce((sum, day) => sum + day.bookedSeconds, 0);
    const availableTotal = days.reduce(
      (sum, day) => sum + day.availableSeconds,
      0
    );

    out.push({
      resourceId: resource.id,
      code: resource.code,
      name: resource.name,
      units: resource.units,
      days,
      totals: {
        bookedSeconds: bookedTotal,
        availableSeconds: availableTotal,
        utilization: shapeUtilizationDay(
          range.from,
          bookedTotal,
          availableTotal
        ).utilization
      }
    });
  }

  return {
    timezone: REPORT_TIMEZONE,
    from: range.from,
    to: range.to,
    resources: out,
    truncated
  };
}

// -- Pipeline, lead time, cancellation and no-show -----------------------------------

export type ReservationsReport = {
  timezone: typeof REPORT_TIMEZONE;
  from: string;
  to: string;
  /** The window as instants, so a consumer can see exactly what was measured. */
  windowStartsAt: string;
  windowEndsAt: string;
  pipeline: PipelineReport;
  leadTime: LeadTimeReport;
  outcomes: OutcomeReport;
};

/**
 * The reservation-flow figures of a window of Asia/Jakarta days:
 *
 * - the HOLD PIPELINE (holds placed in the window, how they ended, and the holds
 *   open right now) -- reported separately from occupancy and never added to it;
 * - LEAD TIME of the reservations confirmed in the window (`starts_at` minus the
 *   confirmation instant);
 * - CANCELLATION and NO-SHOW outcomes of the same confirmation cohort. A
 *   reservation that was later rescheduled is left out of the cohort: it was
 *   superseded by a replacement that has its own confirmation and outcome, so
 *   counting both would count one booking twice.
 *
 * Event instants are the database clock (`occurred_at`). Every ratio is withheld
 * when its group is under the minimum size.
 */
export async function reservationsReport(
  tx: Sql,
  tenantId: string,
  range: ReportRange
): Promise<ReservationsReport> {
  const span = reportRangeInstants(range.from, range.to);
  const startsIso = new Date(span.startMs).toISOString();
  const endsIso = new Date(span.endMs).toISOString();
  const resourceId = range.resourceId;

  const pipelineRows = (await tx`
    SELECT count(*)::int AS placed,
           count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM awcms_booking_reservation_events x
             WHERE x.tenant_id = h.tenant_id AND x.reservation_id = h.reservation_id
               AND x.kind = 'confirmed'))::int AS converted,
           count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM awcms_booking_reservation_events x
             WHERE x.tenant_id = h.tenant_id AND x.reservation_id = h.reservation_id
               AND x.kind = 'expired'))::int AS expired,
           count(*) FILTER (WHERE r.status = 'cancelled' AND NOT EXISTS (
             SELECT 1 FROM awcms_booking_reservation_events x
             WHERE x.tenant_id = h.tenant_id AND x.reservation_id = h.reservation_id
               AND x.kind = 'confirmed'))::int AS cancelled_held
    FROM awcms_booking_reservation_events h
    JOIN awcms_booking_reservations r
      ON r.tenant_id = h.tenant_id AND r.id = h.reservation_id
    WHERE h.tenant_id = ${tenantId}
      AND h.kind = 'held'
      AND h.occurred_at >= ${startsIso}::timestamptz
      AND h.occurred_at < ${endsIso}::timestamptz
      AND (${resourceId}::uuid IS NULL OR EXISTS (
        SELECT 1 FROM awcms_booking_reservation_items i
        JOIN awcms_booking_resource_allocations a
          ON a.tenant_id = i.tenant_id AND a.item_id = i.id
        WHERE i.tenant_id = r.tenant_id AND i.reservation_id = r.id
          AND a.resource_id = ${resourceId}::uuid))
  `) as {
    placed: number;
    converted: number;
    expired: number;
    cancelled_held: number;
  }[];

  const openRows = (await tx`
    SELECT count(DISTINCT r.id)::int AS holds, count(a.id)::int AS units
    FROM awcms_booking_reservations r
    JOIN awcms_booking_reservation_items i
      ON i.tenant_id = r.tenant_id AND i.reservation_id = r.id
    JOIN awcms_booking_resource_allocations a
      ON a.tenant_id = i.tenant_id AND a.item_id = i.id AND a.released_at IS NULL
    WHERE r.tenant_id = ${tenantId}
      AND r.status = 'held'
      AND r.hold_expires_at > clock_timestamp()
      AND (${resourceId}::uuid IS NULL OR a.resource_id = ${resourceId}::uuid)
  `) as { holds: number; units: number }[];

  // The confirmation cohort. `lead_hour` groups by the hour so a window of
  // thousands of reservations comes back as at most a few hundred rows.
  const cohort = `
    FROM awcms_booking_reservation_events c
    JOIN awcms_booking_reservations r
      ON r.tenant_id = c.tenant_id AND r.id = c.reservation_id
    WHERE c.tenant_id = $1
      AND c.kind = 'confirmed'
      AND c.occurred_at >= $2::timestamptz
      AND c.occurred_at < $3::timestamptz
      AND r.status <> 'rescheduled'
      AND ($4::uuid IS NULL OR EXISTS (
        SELECT 1 FROM awcms_booking_reservation_items i
        JOIN awcms_booking_resource_allocations a
          ON a.tenant_id = i.tenant_id AND a.item_id = i.id
        WHERE i.tenant_id = r.tenant_id AND i.reservation_id = r.id
          AND a.resource_id = $4::uuid))`;
  const params = [tenantId, startsIso, endsIso, resourceId];
  const leadRows = (await tx.unsafe(
    `SELECT floor(greatest(0, extract(epoch FROM (r.starts_at - c.occurred_at))) / 3600)::bigint AS lead_hour,
            count(*)::int AS n,
            sum(floor(greatest(0, extract(epoch FROM (r.starts_at - c.occurred_at)))))::bigint AS lead_sum
     ${cohort}
     GROUP BY 1`,
    params
  )) as { lead_hour: string | number; n: number; lead_sum: string | number }[];
  const outcomeRows = (await tx.unsafe(
    `SELECT count(*)::int AS confirmed,
            count(*) FILTER (WHERE r.status = 'cancelled')::int AS cancelled,
            count(*) FILTER (WHERE r.status = 'cancelled' AND r.late_cancellation)::int AS late_cancelled,
            count(*) FILTER (WHERE r.status = 'no_show')::int AS no_show,
            count(*) FILTER (WHERE r.status IN ('checked_in', 'completed'))::int AS arrived
     ${cohort}`,
    params
  )) as {
    confirmed: number;
    cancelled: number;
    late_cancelled: number;
    no_show: number;
    arrived: number;
  }[];

  const pipeline = pipelineRows[0]!;
  const open = openRows[0] ?? { holds: 0, units: 0 };
  const outcomes = outcomeRows[0]!;
  const groups: LeadTimeGroup[] = leadRows.map((row) => ({
    leadSeconds: Number(row.lead_hour) * 3600,
    count: row.n,
    sumSeconds: Number(row.lead_sum)
  }));

  return {
    timezone: REPORT_TIMEZONE,
    from: range.from,
    to: range.to,
    windowStartsAt: startsIso,
    windowEndsAt: endsIso,
    pipeline: shapePipeline(
      {
        placed: pipeline.placed,
        converted: pipeline.converted,
        expired: pipeline.expired,
        cancelledHeld: pipeline.cancelled_held
      },
      open
    ),
    leadTime: shapeLeadTimeGroups(groups),
    outcomes: shapeOutcomes({
      confirmed: outcomes.confirmed,
      cancelled: outcomes.cancelled,
      lateCancelled: outcomes.late_cancelled,
      noShow: outcomes.no_show,
      arrived: outcomes.arrived
    })
  };
}
