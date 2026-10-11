/**
 * `StaffAvailabilityPort` — when can this person be booked? (Issue #946,
 * ADR-0132, ADR-0011; contract: `docs/awcms/cross-domain-contracts.md` section 4
 * and `docs/awcms/hr-payroll.md` section 5.)
 *
 * A scheduling consumer (Booking, a rota screen, a POS shift check) depends on
 * THIS type, never on `hr_workforce`'s `application/` or `domain/` code or its
 * tables. It lives in neutral ground (`_shared`, importing nothing from any
 * module) for the reason every sibling port documents: a consumer that imported
 * the HR code would depend on its internals and, the day HR needs something from
 * the consumer, complete a cycle the boundary gate forbids.
 *
 * ## What crosses the port, and what structurally cannot
 *
 * Three fields per person: an OPAQUE `staffRef` (the consumer's own token for the
 * person; today the adapter reads it as an employment id), a `status`, and the
 * working `intervals`. No name, no office, no template code, no kind label, no
 * time-off reason, no grade or rate. The result type is an allow-list: a field
 * that is not declared here cannot be returned. Display names come from the
 * consumer's own resource or `profile_identity`, never from this port.
 *
 * ## Time
 *
 * Every instant is UTC, an ISO 8601 string ending in `Z`. Every interval is
 * half-open `[startUtc, endUtc)`; adjacent intervals are merged; the window is
 * half-open the same way and the answer is clipped to it. NO local date or zone
 * crosses the port (the consumer converts a business-local day to UTC itself, so
 * the two sides cannot disagree about daylight saving).
 *
 * ## Fail closed
 *
 * `unknown` means "this adapter cannot vouch for the person": not found, another
 * tenant, soft-deleted, not active anywhere in the window. They are
 * INDISTINGUISHABLE on purpose (no existence oracle). A consumer must treat
 * `unknown` as UNBOOKABLE. `resolved` with no intervals means "scheduled for
 * nothing". Do not infer an absence reason from a gap.
 *
 * ## The caller authorizes; the port does not
 *
 * The call performs NO access check and writes NO audit row and NO event: it is
 * a read in the CALLER's tenant transaction (`tx`, so FORCE RLS applies), behind
 * a typed seam, and a typed seam is not a chokepoint. The consumer's composition
 * root MUST authorize the actor against ITS OWN permission before calling. The
 * answer is a READ, not a reservation: re-check at commit, and use `asOf` to
 * judge how old the answer is. Do not log the full result at `info`.
 *
 * ## Bounds
 *
 * At most 200 distinct staff references and a window of at most 35 days; larger
 * asks are a caller error (`RangeError`), to be split by the caller.
 */

export type StaffAvailabilityQuery = {
  /** Opaque staff references, 1..200; duplicates collapse. */
  staffRefs: readonly string[];
  /** Window start, INCLUSIVE. ISO 8601 UTC instant ending in `Z`. */
  fromUtc: string;
  /** Window end, EXCLUSIVE. After `fromUtc`; the span is at most 35 days. */
  toUtc: string;
  /** Optional: only working time assigned to this office. */
  officeId?: string;
};

export type AvailabilityInterval = {
  /** Inclusive. */
  startUtc: string;
  /** Exclusive. */
  endUtc: string;
};

export type StaffAvailability = {
  staffRef: string;
  status: "resolved" | "unknown";
  /** Working time: sorted, disjoint, merged, clipped to the window. Empty when `unknown`. */
  intervals: readonly AvailabilityInterval[];
};

export type StaffAvailabilityResult = {
  /** The server instant the answer was computed. */
  asOf: string;
  /** One entry per distinct `staffRef` asked for, in first-asked order. */
  staff: readonly StaffAvailability[];
};

export interface StaffAvailabilityPort {
  getAvailability(
    tx: Bun.SQL,
    query: StaffAvailabilityQuery
  ): Promise<StaffAvailabilityResult>;
}
