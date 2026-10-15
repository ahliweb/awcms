import type { WhatsappRecipient } from "./whatsapp-delivery-port";

/**
 * `BookingReminderRecipientPort` -- who a booking reminder is addressed to
 * (Issue #943, ADR-0131 O12, ADR-0133 section 8, ADR-0011).
 *
 * `booking` knows its customer only as the OPAQUE `external_customer_ref` of a
 * reservation: commerce (or whatever adapter created the reservation) is the
 * customer authority, and booking holds no name, phone number or e-mail
 * address. A reminder needs a contact, so the deployment supplies this port; it
 * is the single place a booking reference is turned into a contact, and the
 * contact is used for the one `WhatsappDeliveryPort.enqueue` call and then
 * forgotten -- booking never stores it, logs it or puts it in an event.
 *
 * ## Rules an implementation must honour
 *
 * - `resolve` runs inside the dispatch job's tenant transaction (a database
 *   read at most). It must make NO network call: the transaction is open.
 * - It returns `null` when it cannot (or must not) address the customer: the
 *   reference is unknown, the customer was erased, or the authority holds no
 *   WhatsApp-capable number. `null` settles the intent `skipped`; it is not an
 *   error and nothing is retried.
 * - It never returns a recipient for a different tenant than `tenantId`.
 * - Whether the customer MAY be messaged (consent, opt-out) is not its
 *   question. That is the delivery module's, which decides on the recipient it
 *   is handed.
 *
 * No implementation ships in this repository (the customer authority is
 * downstream). With none registered the dispatch job is inert: it creates no
 * intent and sends nothing.
 */
export interface BookingReminderRecipientPort {
  resolve(
    tx: Bun.TransactionSQL,
    input: { tenantId: string; customerRef: string; reservationId: string }
  ): Promise<WhatsappRecipient | null>;
}
