import type { SQL } from "bun";

import type { StaffAvailability } from "../../_shared/ports/staff-availability-port";

/**
 * The staff-availability CONSUMER seam of `booking` (Issue #938; wired by
 * ahliweb/awcms#949 against the `hr_workforce` capability port,
 * `_shared/ports/staff-availability-port.ts`).
 *
 * Booking never reads staff, rosters or leave: a resource that needs a person
 * names the OPAQUE references of the people who can serve it
 * (`awcms_booking_resources.required_staff_refs`) and asks a capability port who
 * is working (booking.md section 10.3). The port is OPTIONAL (ADR-0011): the
 * composition root passes a real consumer only when `hr_workforce` is on for the
 * tenant, and `NO_OP_STAFF_AVAILABILITY` otherwise.
 *
 * ## Two questions, one rule
 *
 *   * the READ path (`resolve`) narrows availability: a slot is offered only if
 *     some candidate is working for the WHOLE service interval and not already
 *     serving a live claim;
 *   * the CLAIM path (`eligibleStaff`) lists the candidates that may serve an
 *     interval, in claim order; the hold service then wins one of them under the
 *     staff exclusion constraint (`sql/305`), inside the same savepoint as the
 *     units, so a conflict rolls the whole claim back.
 *
 * The no-op answers "no constraint" (`null` / `required: false`), which is not
 * "nobody is available": nothing here can make availability LARGER than the
 * resource schedule and allocations already allow -- a staff filter only ever
 * narrows. A resource with candidates and a port that answers `unknown` for all
 * of them is UNBOOKABLE (fail closed, the port's own rule).
 */

/** A narrowing predicate over a slot's service interval, or `null` for "no constraint". */
export type StaffAllowsPredicate =
  ((startMs: number, endMs: number) => boolean) | null;

export type StaffAvailabilityRequest = {
  tenantId: string;
  resourceId: string;
  /** Window of the read, `[fromMs, toMs)`. */
  fromMs: number;
  toMs: number;
};

/** Candidates that may serve one interval, in claim order. */
export type EligibleStaff =
  { required: false } | { required: true; staffRefs: readonly string[] };

export interface StaffAvailabilityConsumer {
  /** Fetches whatever the port needs for `[fromMs, toMs)` and returns the predicate. */
  resolve(
    tx: SQL,
    request: StaffAvailabilityRequest
  ): Promise<StaffAllowsPredicate>;
  /** The people who may serve the service interval `[fromMs, toMs)` of a resource. */
  eligibleStaff(
    tx: SQL,
    request: StaffAvailabilityRequest
  ): Promise<EligibleStaff>;
}

/** The binding used when `hr_workforce` is off or absent: no staff constraint at all. */
export const NO_OP_STAFF_AVAILABILITY: StaffAvailabilityConsumer = {
  resolve: async () => null,
  eligibleStaff: async () => ({ required: false })
};

export type MsInterval = { fromMs: number; toMs: number };

/** A `resolved` person's working intervals as epoch milliseconds, sorted by start. */
export function toWorkingIntervals(
  entry: StaffAvailability | undefined
): MsInterval[] | null {
  if (!entry || entry.status !== "resolved") {
    return null;
  }

  return entry.intervals
    .map((interval) => ({
      fromMs: Date.parse(interval.startUtc),
      toMs: Date.parse(interval.endUtc)
    }))
    .sort((a, b) => a.fromMs - b.fromMs);
}

/**
 * Is `[startMs, endMs)` inside ONE working interval? The port merges adjacent
 * intervals, so a service that spans two unmerged ones would span a gap.
 */
export function coversInterval(
  working: readonly MsInterval[],
  startMs: number,
  endMs: number
): boolean {
  return working.some(
    (interval) => interval.fromMs <= startMs && endMs <= interval.toMs
  );
}

/** Half-open overlap. */
export function overlapsAny(
  busy: readonly MsInterval[],
  startMs: number,
  endMs: number
): boolean {
  return busy.some(
    (interval) => interval.fromMs < endMs && startMs < interval.toMs
  );
}

export type StaffCandidate = {
  staffRef: string;
  /** `null` = the port could not vouch for the person (`unknown`): unbookable. */
  working: readonly MsInterval[] | null;
  /** The person's LIVE claims. */
  busy: readonly MsInterval[];
};

/** Candidates able to serve `[startMs, endMs)`, in the order given. Pure. */
export function eligibleFor(
  candidates: readonly StaffCandidate[],
  startMs: number,
  endMs: number
): string[] {
  return candidates
    .filter(
      (candidate) =>
        candidate.working !== null &&
        coversInterval(candidate.working, startMs, endMs) &&
        !overlapsAny(candidate.busy, startMs, endMs)
    )
    .map((candidate) => candidate.staffRef);
}

/** The pure predicate the availability function evaluates for each slot. */
export function buildStaffAllows(
  candidates: readonly StaffCandidate[]
): (startMs: number, endMs: number) => boolean {
  return (startMs, endMs) => eligibleFor(candidates, startMs, endMs).length > 0;
}
