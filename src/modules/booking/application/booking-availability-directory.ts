/**
 * The ONLY place `booking` availability reads rows (Issue #938). It loads the
 * facts inside the caller's tenant transaction, hands them to the pure functions
 * of `domain/booking-availability.ts`, and shapes the answer. Nothing in the
 * calculation touches the database; nothing here writes.
 *
 * ## The clock is the database's
 *
 * `now` comes from `clock_timestamp()` in the same transaction as the reads, not
 * from the application host: lead time, horizon and the stay's "today" are
 * therefore judged against the clock that also stamps holds and allocations
 * (booking.md section 5), so a skewed app server cannot offer a slot the
 * database would then refuse.
 *
 * ## Reads are tenant-scoped twice
 *
 * Every query names `tenant_id` explicitly AND runs under RLS FORCE. A resource
 * id from another tenant is simply "not found" (404), never a 403 that would
 * confirm it exists.
 */
import {
  AVAILABILITY_LIMITS,
  computeSlotAvailability,
  evaluateStay,
  type OccupiedRange,
  type OccupiedStay,
  type StayBlock,
  type UnitFacts
} from "../domain/booking-availability";
import type { AvailabilityRequest } from "../domain/booking-validation";
import {
  closedDates,
  expandOpenWindows,
  type ExceptionRecord,
  type ScheduleRecord
} from "../domain/booking-schedule";
import {
  NO_OP_STAFF_AVAILABILITY,
  type StaffAvailabilityConsumer
} from "../domain/booking-staff-availability";
import { addDays, localDateOf, parseLocalTime } from "../domain/booking-time";

type Sql = Bun.SQL;

type ResourceRow = {
  id: string;
  timezone: string;
  booking_mode: "slot" | "stay";
  status: string;
  stay_check_in_time: string | null;
  stay_check_out_time: string | null;
};

type OfferingRow = {
  id: string;
  granularity: "time" | "stay";
  duration_seconds: number | null;
  setup_seconds: number | null;
  cleanup_seconds: number | null;
  slot_step_seconds: number | null;
  min_nights: number | null;
  max_nights: number | null;
  min_lead_seconds: number | null;
  max_horizon_days: number | null;
};

export type SlotAnswer = {
  mode: "slot";
  resourceId: string;
  offeringId: string;
  timezone: string;
  from: string;
  to: string;
  slots: { startsAt: string; endsAt: string; freeUnits: number }[];
  truncated: boolean;
};

export type StayAnswer = {
  mode: "stay";
  resourceId: string;
  offeringId: string;
  timezone: string;
  checkInDate: string;
  checkOutDate: string;
  available: boolean;
  nights: number | null;
  arrivalAt: string | null;
  departureAt: string | null;
  freeUnits: number | null;
  reasons: { code: string; overridable: boolean; detail?: string }[];
};

export type AvailabilityOutcome =
  | { outcome: "ok"; answer: SlotAnswer | StayAnswer }
  | { outcome: "not_found"; what: "resource" | "offering" }
  | { outcome: "mode_mismatch"; message: string }
  | { outcome: "too_many_units"; units: number };

async function loadSchedules(
  tx: Sql,
  tenantId: string,
  resourceId: string,
  fromDate: string,
  toDate: string
): Promise<ScheduleRecord[]> {
  const rows = (await tx`
    SELECT id, resource_id, timezone,
           to_char(effective_from, 'YYYY-MM-DD') AS effective_from,
           to_char(effective_to, 'YYYY-MM-DD') AS effective_to,
           rules, status
    FROM awcms_booking_schedules
    WHERE tenant_id = ${tenantId}
      AND status = 'active'
      AND (resource_id = ${resourceId} OR resource_id IS NULL)
      AND effective_from < ${toDate}::date
      AND (effective_to IS NULL OR effective_to > ${fromDate}::date)
    ORDER BY effective_from, id
  `) as {
    id: string;
    resource_id: string | null;
    timezone: string;
    effective_from: string;
    effective_to: string | null;
    rules: unknown;
    status: "active";
  }[];

  return rows.map((row) => ({
    id: row.id,
    resourceId: row.resource_id,
    timezone: row.timezone,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    rules: row.rules,
    status: row.status
  }));
}

async function loadExceptions(
  tx: Sql,
  tenantId: string,
  resourceId: string,
  scheduleIds: readonly string[],
  fromDate: string,
  toDate: string
): Promise<ExceptionRecord[]> {
  // Bun.SQL does not bind a JS array as a Postgres array (22P02), and a
  // stringified `::jsonb` is stored as a JSON string: send the uuids as one
  // comma-joined text and unpack it in SQL (uuids contain no comma).
  const ids = scheduleIds.join(",");
  const rows = (await tx`
    SELECT id, schedule_id, resource_id,
           to_char(local_from, 'YYYY-MM-DD') AS local_from,
           to_char(local_to, 'YYYY-MM-DD') AS local_to,
           kind, windows
    FROM awcms_booking_schedule_exceptions
    WHERE tenant_id = ${tenantId}
      AND local_from < ${toDate}::date
      AND local_to > ${fromDate}::date
      AND (resource_id = ${resourceId}
           OR schedule_id = ANY(string_to_array(${ids}::text, ',')::uuid[]))
    ORDER BY local_from, id
  `) as {
    id: string;
    schedule_id: string | null;
    resource_id: string | null;
    local_from: string;
    local_to: string;
    kind: "closed" | "override_hours";
    windows: unknown;
  }[];

  return rows.map((row) => ({
    id: row.id,
    scheduleId: row.schedule_id,
    resourceId: row.resource_id,
    localFrom: row.local_from,
    localTo: row.local_to,
    kind: row.kind,
    windows: row.windows
  }));
}

async function loadUnits(
  tx: Sql,
  tenantId: string,
  resourceId: string
): Promise<{ id: string }[]> {
  return (await tx`
    SELECT id FROM awcms_booking_resource_units
    WHERE tenant_id = ${tenantId} AND resource_id = ${resourceId}
      AND status = 'active'
    ORDER BY ordinal
  `) as { id: string }[];
}

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * Answers one availability question. Read-only: persists nothing, claims
 * nothing, and the answer may be stale by the time it is read.
 */
export async function answerAvailability(
  tx: Sql,
  tenantId: string,
  request: AvailabilityRequest,
  staff: StaffAvailabilityConsumer = NO_OP_STAFF_AVAILABILITY
): Promise<AvailabilityOutcome> {
  const clock = (await tx`
    SELECT (extract(epoch FROM clock_timestamp()) * 1000)::float8 AS now_ms
  `) as { now_ms: number }[];
  const nowMs = Math.floor(Number(clock[0]!.now_ms));

  const resources = (await tx`
    SELECT id, timezone, booking_mode, status,
           to_char(stay_check_in_time, 'HH24:MI:SS') AS stay_check_in_time,
           to_char(stay_check_out_time, 'HH24:MI:SS') AS stay_check_out_time
    FROM awcms_booking_resources
    WHERE tenant_id = ${tenantId} AND id = ${request.resourceId}
      AND deleted_at IS NULL AND status = 'active'
  `) as ResourceRow[];
  const resource = resources[0];

  if (!resource) {
    return { outcome: "not_found", what: "resource" };
  }

  const offerings = (await tx`
    SELECT id, granularity, duration_seconds, setup_seconds, cleanup_seconds,
           slot_step_seconds, min_nights, max_nights, min_lead_seconds,
           max_horizon_days
    FROM awcms_booking_service_offerings
    WHERE tenant_id = ${tenantId} AND id = ${request.offeringId}
      AND deleted_at IS NULL AND status = 'active'
  `) as OfferingRow[];
  const offering = offerings[0];

  if (!offering) {
    return { outcome: "not_found", what: "offering" };
  }

  const wantsStay = request.mode === "stay";

  if (
    (resource.booking_mode === "stay") !== wantsStay ||
    (offering.granularity === "stay") !== wantsStay
  ) {
    return {
      outcome: "mode_mismatch",
      message:
        resource.booking_mode === "stay"
          ? "This resource is booked by dates: send checkInDate and checkOutDate with a stay offering."
          : "This resource is booked by time: send from and to with a time offering."
    };
  }

  const settings = (await tx`
    SELECT min_lead_seconds, max_horizon_days
    FROM awcms_booking_settings WHERE tenant_id = ${tenantId}
  `) as { min_lead_seconds: number | null; max_horizon_days: number | null }[];
  // Offering override, then the tenant policy, then the module default.
  const minLeadSeconds =
    offering.min_lead_seconds ??
    settings[0]?.min_lead_seconds ??
    AVAILABILITY_LIMITS.defaultMinLeadSeconds;
  const maxHorizonDays =
    offering.max_horizon_days ??
    settings[0]?.max_horizon_days ??
    AVAILABILITY_LIMITS.defaultMaxHorizonDays;
  const units = await loadUnits(tx, tenantId, resource.id);

  if (units.length < request.quantity) {
    return { outcome: "too_many_units", units: units.length };
  }

  if (request.mode === "slot") {
    const setupSeconds = offering.setup_seconds ?? 0;
    const cleanupSeconds = offering.cleanup_seconds ?? 0;
    const padFrom = request.fromMs - setupSeconds * 1000;
    const padTo = request.toMs + cleanupSeconds * 1000;
    const fromDate = addDays(
      localDateOf(resource.timezone, request.fromMs),
      -2
    );
    const toDate = addDays(localDateOf(resource.timezone, request.toMs), 3);
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
    const occupiedRows = (await tx`
      SELECT resource_unit_id,
             (extract(epoch FROM occupied_from) * 1000)::float8 AS from_ms,
             (extract(epoch FROM occupied_to) * 1000)::float8 AS to_ms
      FROM awcms_booking_resource_allocations
      WHERE tenant_id = ${tenantId} AND resource_id = ${resource.id}
        AND released_at IS NULL AND granularity = 'time'
        AND occupied_from < to_timestamp(${padTo}::float8 / 1000.0)
        AND occupied_to > to_timestamp(${padFrom}::float8 / 1000.0)
    `) as { resource_unit_id: string; from_ms: number; to_ms: number }[];
    const occupiedByUnit = new Map<string, OccupiedRange[]>();

    for (const row of occupiedRows) {
      const list = occupiedByUnit.get(row.resource_unit_id) ?? [];

      list.push({ fromMs: Number(row.from_ms), toMs: Number(row.to_ms) });
      occupiedByUnit.set(row.resource_unit_id, list);
    }

    const unitFacts: UnitFacts[] = units.map((unit) => ({
      unitId: unit.id,
      occupied: occupiedByUnit.get(unit.id) ?? [],
      stays: []
    }));
    const staffAllows = await staff.resolve({
      tenantId,
      staffRole: null,
      fromMs: request.fromMs,
      toMs: request.toMs
    });
    const result = computeSlotAvailability({
      fromMs: request.fromMs,
      toMs: request.toMs,
      nowMs,
      durationSeconds: offering.duration_seconds!,
      setupSeconds,
      cleanupSeconds,
      stepSeconds: offering.slot_step_seconds!,
      quantity: request.quantity,
      minLeadSeconds,
      maxHorizonDays,
      openWindows: expandOpenWindows({
        resourceId: resource.id,
        timezone: resource.timezone,
        schedules,
        exceptions,
        fromMs: request.fromMs,
        toMs: request.toMs
      }),
      units: unitFacts,
      limit: request.limit,
      staffAllows
    });

    return {
      outcome: "ok",
      answer: {
        mode: "slot",
        resourceId: resource.id,
        offeringId: offering.id,
        timezone: resource.timezone,
        from: toIso(request.fromMs),
        to: toIso(request.toMs),
        slots: result.slots.map((slot) => ({
          startsAt: toIso(slot.startMs),
          endsAt: toIso(slot.endMs),
          freeUnits: slot.freeUnits
        })),
        truncated: result.truncated
      }
    };
  }

  // Stay. Dates the evaluator will refuse as STAY_DATES_INVALID still reach it:
  // it owns the ordering, existence-in-zone and "today" checks.
  const checkIn = request.checkInDate;
  const checkOut = request.checkOutDate;
  const rangeValid = checkIn < checkOut && checkOut <= addDays(checkIn, 366);
  const queryFrom = rangeValid ? checkIn : addDays(checkIn, 0);
  const queryTo = rangeValid ? checkOut : addDays(checkIn, 1);
  const schedules = await loadSchedules(
    tx,
    tenantId,
    resource.id,
    queryFrom,
    queryTo
  );
  const exceptions = await loadExceptions(
    tx,
    tenantId,
    resource.id,
    schedules.map((schedule) => schedule.id),
    queryFrom,
    queryTo
  );
  const stayRows = (await tx`
    SELECT resource_unit_id,
           to_char(stay_from, 'YYYY-MM-DD') AS stay_from,
           to_char(stay_to, 'YYYY-MM-DD') AS stay_to
    FROM awcms_booking_resource_allocations
    WHERE tenant_id = ${tenantId} AND resource_id = ${resource.id}
      AND released_at IS NULL AND granularity = 'stay'
      AND stay_from < ${queryTo}::date AND stay_to > ${queryFrom}::date
  `) as { resource_unit_id: string; stay_from: string; stay_to: string }[];
  const staysByUnit = new Map<string, OccupiedStay[]>();

  for (const row of stayRows) {
    const list = staysByUnit.get(row.resource_unit_id) ?? [];

    list.push({ from: row.stay_from, to: row.stay_to });
    staysByUnit.set(row.resource_unit_id, list);
  }

  const blockRows = (await tx`
    SELECT resource_unit_id,
           to_char(block_from, 'YYYY-MM-DD') AS block_from,
           to_char(block_to, 'YYYY-MM-DD') AS block_to
    FROM awcms_booking_resource_blocks
    WHERE tenant_id = ${tenantId} AND resource_id = ${resource.id}
      AND status = 'active'
      AND block_from < ${queryTo}::date AND block_to > ${queryFrom}::date
  `) as {
    resource_unit_id: string | null;
    block_from: string;
    block_to: string;
  }[];
  const blocks: StayBlock[] = blockRows.map((row) => ({
    unitId: row.resource_unit_id,
    from: row.block_from,
    to: row.block_to
  }));
  const evaluation = evaluateStay({
    checkInDate: checkIn,
    checkOutDate: checkOut,
    timezone: resource.timezone,
    checkInSeconds: parseLocalTime(resource.stay_check_in_time) ?? 0,
    checkOutSeconds: parseLocalTime(resource.stay_check_out_time) ?? 0,
    nowMs,
    minLeadSeconds,
    maxHorizonDays,
    minNights: offering.min_nights ?? 1,
    maxNights: offering.max_nights ?? AVAILABILITY_LIMITS.maxNights,
    quantity: request.quantity,
    units: units.map((unit) => ({
      unitId: unit.id,
      occupied: [],
      stays: staysByUnit.get(unit.id) ?? []
    })),
    blocks,
    closedDates: rangeValid
      ? closedDates({
          resourceId: resource.id,
          timezone: resource.timezone,
          schedules,
          exceptions,
          fromDate: queryFrom,
          toDate: queryTo
        })
      : []
  });

  return {
    outcome: "ok",
    answer: {
      mode: "stay",
      resourceId: resource.id,
      offeringId: offering.id,
      timezone: resource.timezone,
      checkInDate: checkIn,
      checkOutDate: checkOut,
      available: evaluation.available,
      nights: evaluation.nights,
      arrivalAt:
        evaluation.arrivalMs === null ? null : toIso(evaluation.arrivalMs),
      departureAt:
        evaluation.departureMs === null ? null : toIso(evaluation.departureMs),
      freeUnits: evaluation.freeUnits,
      reasons: evaluation.reasons.map((reason) => ({
        code: reason.code,
        overridable: reason.overridable,
        ...(reason.detail === undefined ? {} : { detail: reason.detail })
      }))
    }
  };
}
