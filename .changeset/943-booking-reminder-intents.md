---
"awcms": minor
---

feat(booking): confirmation and reminder intents routed through the WhatsApp delivery port (#943, epic item 17, ADR-0133 sections 3 and 8).

- Migrations 284 and 285: `awcms_booking_reminder_intents` (one row per reservation, kind and occurrence; RLS FORCE; never deleted; holds no contact, body or credential) and three narrow `SECURITY DEFINER` reads for the worker (the `awcms_worker` role still holds no privilege on the reservation tables).
- New scheduled job `booking:reminders:dispatch` (every minute, database-only): creates the intents for confirmed reservations, hands each to `whatsapp_delivery` through `WhatsappDeliveryPort.enqueue` (idempotent per reservation, kind and occurrence), cancels the queued message of a reservation that was cancelled, expired, rescheduled or marked no-show. Nothing on the reservation transaction path changes.
- New port `BookingReminderRecipientPort`: booking holds only the opaque customer reference, so a deployment registers the adapter that turns it into a recipient (`registerBookingReminderRecipients`). With none registered the job is inert. No implementation ships here.
- Templates `booking.confirmation` and `booking.reminder` (transactional, English wording, reservation number and local start only); `whatsapp:dispatch` registers them in its own process.

**Upgrade note.** Run `bun run db:migrate` (284, 285) and add `booking:reminders:dispatch` to the scheduler (`ops/awcms-jobs.crontab` is regenerated). Nothing is sent until a recipient resolver is registered and `WHATSAPP_ENABLED=true`. Open policy questions are recorded as O13 in `docs/awcms/booking.md`.
- Hardening: a queued message is reconciled only once terminal (a leased `sending` message that falls to `retry_wait` is still cancelled), every message carries an expiry, a mass cancellation drains in one run, the dispatch holds at most 25 reservation locks under lock/statement timeouts, the worker's UPDATE is column-scoped, and dispatch failures are logged by intent id and error class.
