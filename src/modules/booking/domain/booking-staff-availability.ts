/**
 * The staff-availability CONSUMER seam of `booking` (Issue #938; wired by
 * ahliweb/awcms#949 against the `hr_workforce` capability port).
 *
 * Booking never reads staff, rosters or leave: a service that needs a person
 * asks a capability port who is free (booking.md section 4, `staff_ref` is
 * opaque and "resolved only by the workforce port"). That port is being defined
 * in `hr_workforce` in a parallel change; this file deliberately does NOT import
 * it. It declares the narrow shape booking needs and ships the NO-OP
 * implementation, so the availability read path already has its call site and
 * #949 swaps one binding.
 *
 * The no-op answers "no constraint" (`null`), which is not the same as "nobody
 * is available": until the port is wired, a service offering without staff
 * requirements is unaffected, and nothing here can make availability LARGER than
 * the resource schedule and allocations already allow -- a staff filter only
 * ever narrows.
 */
export type StaffAvailabilityRequest = {
  tenantId: string;
  /** The opaque role code a service requires (`service_requirements.staff_role`), when any. */
  staffRole: string | null;
  fromMs: number;
  toMs: number;
};

/**
 * A narrowing predicate over a slot's service interval, built from data the
 * port has already fetched (so it can be passed into the PURE availability
 * function), or `null` for "no constraint".
 */
export type StaffAllowsPredicate =
  ((startMs: number, endMs: number) => boolean) | null;

export interface StaffAvailabilityConsumer {
  /** Fetches whatever the port needs for `[fromMs, toMs)` and returns the predicate. */
  resolve(request: StaffAvailabilityRequest): Promise<StaffAllowsPredicate>;
}

/** The binding used until #949 wires the real port: no staff constraint at all. */
export const NO_OP_STAFF_AVAILABILITY: StaffAvailabilityConsumer = {
  resolve: async () => null
};
