/**
 * The booking side of the `StaffAvailabilityPort` (Issue #949, ADR-0011,
 * ADR-0132; booking.md section 10.3).
 *
 * This file knows the PORT TYPE (neutral ground, `_shared/ports`) and booking's
 * own tables. It does not import `hr_workforce`: the adapter that answers the
 * port is handed in by the composition root (`module.ts`, the one lazy import),
 * and only when `hr_workforce` is on for the tenant.
 *
 * ## Soft edge
 *
 * `resolveStaffAvailability` is the single decision "is the staff constraint
 * on?": `hr_workforce` enabled for the tenant AND the adapter loadable. Anything
 * else is `NO_OP_STAFF_AVAILABILITY` -- no staff constraint at all, booking as it
 * was before this capability. A throwing loader degrades to the same no-op (an
 * absent provider is not an outage of booking).
 *
 * ## Fail closed once the constraint IS on
 *
 * A resource with candidates and a port that cannot vouch for any of them
 * (`unknown`) is unbookable; a port that throws is NOT swallowed, so a claim
 * errors (a 500 the caller retries) rather than silently proceeding without the
 * constraint it was asked to honour.
 *
 * The port read is advisory (point in time, unlocked): the authoritative
 * guarantee against a double-booked person is the exclusion constraint of
 * `sql/305`, taken in the claim's savepoint.
 */
import type { StaffAvailabilityPort } from "../../_shared/ports/staff-availability-port";
import { resolveModuleEnabled } from "../../identity-access/application/auth-context";
import {
  NO_OP_STAFF_AVAILABILITY,
  buildStaffAllows,
  eligibleFor,
  toWorkingIntervals,
  type EligibleStaff,
  type MsInterval,
  type StaffAvailabilityConsumer,
  type StaffAvailabilityRequest,
  type StaffCandidate
} from "../domain/booking-staff-availability";

type Sql = Bun.SQL;

/** The `hr_workforce` module key (the module that provides the port). */
export const STAFF_AVAILABILITY_PROVIDER_MODULE = "hr_workforce";

/** At most this many candidates per resource (the table CHECK states the same cap). */
export const MAX_STAFF_CANDIDATES = 50;

async function loadCandidateRefs(
  tx: Sql,
  tenantId: string,
  resourceId: string
): Promise<string[]> {
  const rows = (await tx`
    SELECT required_staff_refs
    FROM awcms_booking_resources
    WHERE tenant_id = ${tenantId} AND id = ${resourceId}
      AND deleted_at IS NULL
  `) as { required_staff_refs: string[] | null }[];

  return [...new Set(rows[0]?.required_staff_refs ?? [])].slice(
    0,
    MAX_STAFF_CANDIDATES
  );
}

async function loadBusy(
  tx: Sql,
  tenantId: string,
  staffRefs: readonly string[],
  fromMs: number,
  toMs: number
): Promise<Map<string, MsInterval[]>> {
  const rows = (await tx`
    SELECT s.staff_ref,
           (extract(epoch FROM s.occupied_from) * 1000)::float8 AS from_ms,
           (extract(epoch FROM s.occupied_to) * 1000)::float8 AS to_ms
    FROM awcms_booking_staff_assignments s
    JOIN awcms_booking_reservation_items i
      ON i.tenant_id = s.tenant_id AND i.id = s.item_id
    JOIN awcms_booking_reservations r
      ON r.tenant_id = i.tenant_id AND r.id = i.reservation_id
    WHERE s.tenant_id = ${tenantId}
      AND s.staff_ref = ANY(${tx.array([...staffRefs], "text")}::text[])
      AND s.released_at IS NULL
      -- An elapsed hold is not occupancy, whether or not the reaper has run.
      AND NOT (r.status = 'held' AND r.hold_expires_at <= clock_timestamp())
      AND s.occupied_from < to_timestamp(${toMs}::float8 / 1000.0)
      AND s.occupied_to > to_timestamp(${fromMs}::float8 / 1000.0)
  `) as { staff_ref: string; from_ms: number; to_ms: number }[];
  const byStaff = new Map<string, MsInterval[]>();

  for (const row of rows) {
    const list = byStaff.get(row.staff_ref) ?? [];

    list.push({ fromMs: Number(row.from_ms), toMs: Number(row.to_ms) });
    byStaff.set(row.staff_ref, list);
  }

  return byStaff;
}

/** A consumer backed by a real port. Stateless; the transaction comes with each call. */
export function createPortStaffAvailabilityConsumer(
  port: StaffAvailabilityPort
): StaffAvailabilityConsumer {
  async function candidatesFor(
    tx: Sql,
    request: StaffAvailabilityRequest,
    withBusy: boolean
  ): Promise<StaffCandidate[] | null> {
    const refs = await loadCandidateRefs(
      tx,
      request.tenantId,
      request.resourceId
    );

    if (refs.length === 0) {
      return null;
    }

    const answer = await port.getAvailability(tx, {
      staffRefs: refs,
      fromUtc: new Date(request.fromMs).toISOString(),
      toUtc: new Date(request.toMs).toISOString()
    });
    const byRef = new Map(answer.staff.map((entry) => [entry.staffRef, entry]));
    const busy = withBusy
      ? await loadBusy(tx, request.tenantId, refs, request.fromMs, request.toMs)
      : new Map<string, MsInterval[]>();

    return refs.map((staffRef) => ({
      staffRef,
      working: toWorkingIntervals(byRef.get(staffRef)),
      busy: busy.get(staffRef) ?? []
    }));
  }

  return {
    async resolve(tx, request) {
      const candidates = await candidatesFor(tx, request, true);

      return candidates === null ? null : buildStaffAllows(candidates);
    },

    async eligibleStaff(tx, request): Promise<EligibleStaff> {
      const candidates = await candidatesFor(tx, request, false);

      if (candidates === null) {
        return { required: false };
      }

      return {
        required: true,
        staffRefs: eligibleFor(candidates, request.fromMs, request.toMs)
      };
    }
  };
}

/**
 * The composition root's one call: the consumer for THIS tenant. `loadPort`
 * returns the provider's adapter (a lazy import in `module.ts`) or `null`.
 */
export async function resolveStaffAvailability(
  tx: Sql,
  tenantId: string,
  loadPort: () => Promise<StaffAvailabilityPort | null>
): Promise<StaffAvailabilityConsumer> {
  if (
    !(await resolveModuleEnabled(
      tx,
      tenantId,
      STAFF_AVAILABILITY_PROVIDER_MODULE
    ))
  ) {
    return NO_OP_STAFF_AVAILABILITY;
  }

  let port: StaffAvailabilityPort | null = null;

  try {
    port = await loadPort();
  } catch {
    port = null;
  }

  return port
    ? createPortStaffAvailabilityConsumer(port)
    : NO_OP_STAFF_AVAILABILITY;
}
