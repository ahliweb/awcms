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
  scheduleChanged: { action: "booking.schedule.changed", severity: "info" },
  policyConfigured: {
    action: "booking.policy.configured",
    severity: "warning"
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
