/**
 * Business policy for a reservation claim (Issue #941, ADR-0131; docs/awcms/
 * booking.md sections 3 and 13): opening hours, lead time and the booking
 * horizon, evaluated against the SAME engine the availability search uses
 * (`expandOpenWindows`, `evaluateStay`) and the database clock.
 *
 * This is what `reservations.override` can lift. `placeHold` is the CLAIM and
 * does not know who the caller is, so it cannot decide whether a refusal here
 * may be waived; the create and reschedule handlers do, and they call this
 * before the claim. Nothing here can lift a double-booking: that is the
 * allocator's, under the exclusion constraints, and no permission reaches it.
 *
 * ## Fail open to the claim, never to the policy
 *
 * When this cannot load what it needs (the offering or the resource is unknown,
 * inactive or in another mode) it answers "no policy reason" and lets
 * `placeHold` produce the precise refusal (`OFFERING_NOT_FOUND`,
 * `BOOKING_MODE_MISMATCH`, ...). That is safe because every one of those is a
 * refusal there too: skipping the policy cannot let a claim through that the
 * claim itself would not also have to accept.
 *
 * ## A pool is as strict as its strictest member
 *
 * A pool is a set of INTERCHANGEABLE resources, and the allocator picks the first
 * free unit in preference order, so the booking may land on any of them. The
 * policy therefore has to hold for every resource the claim can land on: a start
 * outside one member's hours is refused, because it could be allocated there.
 */
import {
  AVAILABILITY_LIMITS,
  evaluateStay
} from "../domain/booking-availability";
import {
  evaluateSlotPolicy,
  stayPolicyReasons,
  type PolicyReason
} from "../domain/booking-policy";
import { closedDates, expandOpenWindows } from "../domain/booking-schedule";
import { addDays, localDateOf, parseLocalTime } from "../domain/booking-time";
import {
  loadExceptions,
  loadSchedules
} from "./booking-availability-directory";

type Sql = Bun.SQL;

export type PolicyClaim = {
  offeringId: string;
  resourceId?: string;
  poolId?: string;
  startsAtMs?: number;
  stay?: { checkInDate: string; checkOutDate: string };
};

type OfferingFacts = {
  granularity: "time" | "stay";
  duration_seconds: number | null;
  slot_step_seconds: number | null;
  min_nights: number | null;
  max_nights: number | null;
  min_lead_seconds: number | null;
  max_horizon_days: number | null;
};

type ResourceFacts = {
  id: string;
  timezone: string;
  booking_mode: "slot" | "stay";
  stay_check_in_time: string | null;
  stay_check_out_time: string | null;
};

function dedupe(reasons: PolicyReason[]): PolicyReason[] {
  const seen = new Set<string>();

  return reasons.filter((reason) => {
    const key = `${reason.code}:${reason.detail}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

/** The policy reasons `claim` trips right now, in a stable order. Empty = the claim is within policy. */
export async function evaluateClaimPolicy(
  tx: Sql,
  tenantId: string,
  claim: PolicyClaim
): Promise<PolicyReason[]> {
  const offerings = (await tx`
    SELECT granularity, duration_seconds, slot_step_seconds, min_nights,
           max_nights, min_lead_seconds, max_horizon_days
    FROM awcms_booking_service_offerings
    WHERE tenant_id = ${tenantId} AND id = ${claim.offeringId}
      AND deleted_at IS NULL AND status = 'active'
  `) as OfferingFacts[];
  const offering = offerings[0];

  if (!offering) {
    return [];
  }

  const resources =
    claim.resourceId !== undefined
      ? ((await tx`
          SELECT id, timezone, booking_mode,
                 to_char(stay_check_in_time, 'HH24:MI:SS') AS stay_check_in_time,
                 to_char(stay_check_out_time, 'HH24:MI:SS') AS stay_check_out_time
          FROM awcms_booking_resources
          WHERE tenant_id = ${tenantId} AND id = ${claim.resourceId}
            AND deleted_at IS NULL AND status = 'active'
        `) as ResourceFacts[])
      : ((await tx`
          SELECT r.id, r.timezone, r.booking_mode,
                 to_char(r.stay_check_in_time, 'HH24:MI:SS') AS stay_check_in_time,
                 to_char(r.stay_check_out_time, 'HH24:MI:SS') AS stay_check_out_time
          FROM awcms_booking_resources r
          JOIN awcms_booking_resource_pools p
            ON p.tenant_id = r.tenant_id AND p.id = r.pool_id
          WHERE r.tenant_id = ${tenantId} AND p.id = ${claim.poolId!}
            AND p.deleted_at IS NULL
            AND r.deleted_at IS NULL AND r.status = 'active'
          ORDER BY r.sort_order, r.id
        `) as ResourceFacts[]);

  const isStay = claim.stay !== undefined;

  if (
    resources.length === 0 ||
    offering.granularity !== (isStay ? "stay" : "time") ||
    resources.some(
      (resource) => resource.booking_mode !== (isStay ? "stay" : "slot")
    )
  ) {
    return [];
  }

  const clock = (await tx`
    SELECT (extract(epoch FROM clock_timestamp()) * 1000)::float8 AS now_ms
  `) as { now_ms: number }[];
  const nowMs = Math.floor(Number(clock[0]!.now_ms));
  const settings = (await tx`
    SELECT min_lead_seconds, max_horizon_days
    FROM awcms_booking_settings WHERE tenant_id = ${tenantId}
  `) as { min_lead_seconds: number | null; max_horizon_days: number | null }[];
  // Offering override, then the tenant policy, then the module default -- the
  // order the availability search uses, so a start it offered is one this accepts.
  const minLeadSeconds =
    offering.min_lead_seconds ??
    settings[0]?.min_lead_seconds ??
    AVAILABILITY_LIMITS.defaultMinLeadSeconds;
  const maxHorizonDays =
    offering.max_horizon_days ??
    settings[0]?.max_horizon_days ??
    AVAILABILITY_LIMITS.defaultMaxHorizonDays;
  const reasons: PolicyReason[] = [];

  for (const resource of resources) {
    if (claim.stay) {
      const checkIn = claim.stay.checkInDate;
      const checkOut = claim.stay.checkOutDate;
      const rangeValid =
        checkIn < checkOut && checkOut <= addDays(checkIn, 366);
      const queryFrom = checkIn;
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
      // One synthetic free unit with nothing booked and nothing blocked: this asks
      // only the policy questions (lead time, horizon, a soft closure); whether a
      // real unit is free is the claim's.
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
        quantity: 1,
        units: [{ unitId: "policy", occupied: [], stays: [] }],
        blocks: [],
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

      reasons.push(...stayPolicyReasons(evaluation.reasons));
      continue;
    }

    const startMs = claim.startsAtMs!;
    const endMs = startMs + offering.duration_seconds! * 1000;
    const fromDate = addDays(localDateOf(resource.timezone, startMs), -2);
    const toDate = addDays(localDateOf(resource.timezone, endMs), 3);
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

    reasons.push(
      ...evaluateSlotPolicy({
        startMs,
        endMs,
        nowMs,
        minLeadSeconds,
        maxHorizonDays,
        stepSeconds: offering.slot_step_seconds ?? 0,
        openWindows: expandOpenWindows({
          resourceId: resource.id,
          timezone: resource.timezone,
          schedules,
          exceptions,
          fromMs: startMs,
          toMs: endMs
        })
      })
    );
  }

  return dedupe(reasons);
}
