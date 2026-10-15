/**
 * The recipient resolver booking's reminder job uses (Issue #943; the port is
 * `_shared/ports/booking-reminder-recipient-port.ts`).
 *
 * Booking cannot resolve a contact itself (it holds only the opaque
 * `external_customer_ref`; commerce is the customer authority, ADR-0131 O12), so
 * a deployment registers the adapter that can, from the entry point that runs
 * the job. With none registered the job is inert. A process-local setter, like
 * the WhatsApp template registry: the ONE writer is the composition root
 * (`scripts/booking-reminders-dispatch.ts`).
 */
import type { BookingReminderRecipientPort } from "../../_shared/ports/booking-reminder-recipient-port";

let resolver: BookingReminderRecipientPort | null = null;

export function registerBookingReminderRecipients(
  next: BookingReminderRecipientPort | null
): void {
  resolver = next;
}

export function getBookingReminderRecipients(): BookingReminderRecipientPort | null {
  return resolver;
}
