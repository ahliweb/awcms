/**
 * `booking` audit event types (Issue #937, ADR-0131; booking.md section 3).
 *
 * The `action` string written to the audit log by the handlers that arrive from
 * Issue #938. Severity follows the transition table: creating, confirming,
 * checking in and completing are `info`; cancelling, rescheduling and marking a
 * no-show are `warning`; an override is `critical`. Declared in `domain/` with no
 * imports so the producer and its test reference the same literals.
 *
 * Audit rows record WHICH reservation and which transition, never a customer
 * note, a reference to a person, or any reason text (ADR-0094).
 */
export type BookingAuditSeverity = "info" | "warning" | "critical";

export const BOOKING_AUDIT_EVENTS = {
  resourceCreated: { action: "booking.resource.created", severity: "info" },
  resourceUpdated: { action: "booking.resource.updated", severity: "info" },
  resourceDeleted: { action: "booking.resource.deleted", severity: "warning" },
  resourceRestored: {
    action: "booking.resource.restored",
    severity: "info"
  },
  offeringCreated: { action: "booking.offering.created", severity: "info" },
  offeringUpdated: { action: "booking.offering.updated", severity: "info" },
  offeringDeleted: { action: "booking.offering.deleted", severity: "warning" },
  offeringRestored: {
    action: "booking.offering.restored",
    severity: "info"
  },
  // Resource pools (Issue #1030): gated by the `resources.*` permissions.
  poolCreated: { action: "booking.pool.created", severity: "info" },
  poolUpdated: { action: "booking.pool.updated", severity: "info" },
  poolDeleted: { action: "booking.pool.deleted", severity: "warning" },
  poolRestored: { action: "booking.pool.restored", severity: "info" },
  scheduleChanged: { action: "booking.schedule.changed", severity: "info" },
  // Blocked nights take sellable inventory out of sale (booking.md section 9):
  // placing one is `warning`, returning the nights to sale is `info`.
  blockCreated: { action: "booking.block.created", severity: "warning" },
  blockReleased: { action: "booking.block.released", severity: "info" },
  // The policy bounds how much inventory one actor can hold and how far ahead
  // anyone can book (Issue #1030): a high-risk change, hence `critical`.
  policyConfigured: {
    action: "booking.policy.configured",
    severity: "critical"
  },
  reservationCreated: {
    action: "booking.reservation.created",
    severity: "info"
  },
  reservationConfirmed: {
    action: "booking.reservation.confirmed",
    severity: "info"
  },
  reservationExpired: {
    action: "booking.reservation.expired",
    severity: "info"
  },
  reservationCancelled: {
    action: "booking.reservation.cancelled",
    severity: "warning"
  },
  reservationRescheduled: {
    action: "booking.reservation.rescheduled",
    severity: "warning"
  },
  reservationCheckedIn: {
    action: "booking.reservation.checked_in",
    severity: "info"
  },
  reservationCompleted: {
    action: "booking.reservation.completed",
    severity: "info"
  },
  reservationNoShow: {
    action: "booking.reservation.no_show",
    severity: "warning"
  },
  reservationOverridden: {
    action: "booking.reservation.overridden",
    severity: "critical"
  },
  reservationNoteRead: {
    action: "booking.reservation.note_read",
    severity: "info"
  }
} as const satisfies Record<
  string,
  { action: string; severity: BookingAuditSeverity }
>;
