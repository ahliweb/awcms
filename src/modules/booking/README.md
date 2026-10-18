🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](README.id.md)

# `booking`

Generic **resources, capacity units, schedules and reservations** for anything
that rents out time, space or capacity, including nightly stays (Issue #937,
[ADR-0131](../../../docs/adr/0131-generic-booking-module-admission.md), amended by
[ADR-0135](../../../docs/adr/0135-day-granularity-stays-admitted-into-booking-v1.md)).
The full design pack is [`docs/awcms/booking.md`](../../../docs/awcms/booking.md);
this file is the map of the code.

## Slices present

Foundation (Issue #937): the descriptor (`experimental` until Issue #942; now `active`), the schema (`sql/180`),
the permission catalogue (`sql/181`), the pure reservation state machine, the
guard literals and the audit event names.

Availability (Issue #938): schedules, closures and exceptions, blocked nights
(`sql/186`), the pure availability calculation, and the routes under
`/api/v1/booking/` (`availability`, `schedules`, `schedule-exceptions`).

Allocator (Issue #939, `sql/200`): the slot allocator, holds with expiry, the
claim service `placeHold` and the read-only reconciliation, plus the
`booking:holds:expire` job, which runs as `awcms_worker` through the narrow
SECURITY DEFINER sweep of `sql/200` (the worker holds no privilege on the
booking tables).

Stays and blocks (Issue #940, `sql/204`; block routes and follow-ups, Issue #1012, `sql/240`, `sql/241`): a stay is claimed through the same
allocator and `placeHold` (`stay: { checkInDate, checkOutDate }`, the second
exclusion constraint over dates), blocked nights are allocation rows owned by a
`resource_blocks` row (`createBlock` / `releaseBlock`, `BLOCK_CONFLICT`), and
the lazy reclaim and the reconciliation understand both.

Reservations (Issue #941, `sql/208`, `sql/209`): the routes `POST/GET
/reservations`, `GET /reservations/{id}` and the transitions `confirm`,
`cancel`, `reschedule`, `check-in`, `check-out` and `no-show`
(`application/booking-reservation-service.ts`), `Idempotency-Key` through the
shared component, the `BookingPort` (`application/booking-port-adapter.ts`), the
nine reservation events on the live AsyncAPI document, and a safe default for the
hold caps. The port grew in Issue #1108 (contract `booking` 1.1.0, additive):
`checkIn`, `checkOut` and `markNoShow`, and four reads that return no customer
data, `get`, `getOffering`, `listOfferings` and an actor-less `availability` for
a public booking page (booking.md section 10.1). The block routes (Issue #1012: `POST/GET /blocks`, `GET /blocks/{id}`,
`POST /blocks/{id}/release`) take `Idempotency-Key` with replay and publish no
event. **Not present yet:** the reconciliation
route.

Reminders (Issue #943, `sql/284`, `sql/285`): confirmation and reminder
**intents** (`awcms_booking_reminder_intents`, once per reservation, kind and
occurrence), created and handed to the one WhatsApp queue through the
`WhatsappDeliveryPort` by the job `booking:reminders:dispatch`
(`application/booking-reminder-dispatch.ts`, `booking-reminder-job.ts`). Nothing
on the reservation path changes; booking holds no contact, credential, queue or
provider call. The customer is resolved to a recipient by a
`BookingReminderRecipientPort` the deployment registers
(`registerBookingReminderRecipients`); with none, the job is inert. See
[`booking.md` §7.5](../../../docs/awcms/booking.md).

Admin screens (Issue #942, no migration, no API change; the module is `active`):
six screens -- `/admin/booking/reservations` (the list, the hold and its
expiry; `?id=` is one reservation with its history and the confirm / cancel /
check-in / complete / no-show actions), `/admin/booking/resources` (with units and pools), `/admin/booking/offerings`,
`/admin/booking/schedules` (opening hours and closures), `/admin/booking/blocks` and `/admin/booking/policy` --
each a `navigation` entry whose permission is seeded and enforced. They call only
the routes above, send every mutation through one shared sender
(`src/lib/ui/booking-admin-client.ts`) with an `Idempotency-Key`, show refusals
as translated sentences (`src/lib/booking-admin-messages.ts`, `locales/`), and use
no browser dialog. Creating, rescheduling and overriding a reservation are not on
any screen; see [`booking.md` §3.0.3](../../../docs/awcms/booking.md).
Admin configuration (Issue #1030, no migration; prerequisite of #942): resources
with their units and pool membership, resource pools, service offerings and the
tenant policy, under `/api/v1/booking/` (`resources`, `resource-pools`,
`offerings`, `policy`). Every write takes `Idempotency-Key` with replay and runs
under a savepoint, so a database guard (`BOOKING_MODE_IN_USE`, `TIMEZONE_IN_USE`,
`SCHEDULE_TIMEZONE_MISMATCH`, a duplicate code) is a named 409, not a 500. Delete
is soft and refused while the resource is in use; capacity only grows; `PUT
/policy` replaces the whole policy (`null` = the module default) and is audited
`critical`. Code: `application/booking-resource-admin.ts`,
`booking-offering-admin.ts`, `booking-policy-admin.ts`, `booking-admin-routes.ts`,
`booking-admin-support.ts`, `domain/booking-admin-validation.ts`; see
[`booking.md` §3.0.2](../../../docs/awcms/booking.md).

Reporting (Issue #944, `sql/244`): three projections on the existing `reporting`
engine and three live report routes; see "Reporting, in one place".

## The allocator, in one place

- **The guarantee is the exclusion constraint**, not this code. The allocator
  (`application/booking-allocator.ts`) claims a unit with `INSERT ... ON CONFLICT
DO NOTHING RETURNING id`: PostgreSQL waits for an in-doubt concurrent row and
  then either absorbs the conflict (the loser gets no row, the transaction stays
  usable) or lets the claim through when the other writer rolled back. It reads
  the free units first as a **hint** (committed rows only) in a deterministic
  order, claims the units chosen together in `(resource_id, ordinal)` order so
  two writers cannot wait on each other in a cycle, and is all-or-none for `k`
  units: `placeHold` runs the whole claim in a savepoint, so a refusal rolls back
  the reservation, the item and any unit already won.
- **Refusals are values** (`SLOT_UNAVAILABLE`, `HOLD_LIMIT_EXCEEDED`, ...), never
  an error, and a refusal writes nothing. A residual deadlock (`40P01`) is
  retried at most three times with jitter, then `CONTENTION_RETRY`.
- **Holds expire in two cooperating ways** (`application/booking-hold-expiry.ts`).
  **Lazy reclaim** expires, inside the claim's own transaction and under the
  reservation row lock, the elapsed holds standing on the units being claimed.
  The **reaper** (`bun run booking:holds:expire`, every minute) expires the rest.
  Correctness depends on the first only: with the reaper stopped a late claim
  still finds the unit free, and the reaper's lag is visible as
  `hold_overdue_unswept` in `runReconciliation`.
- **`placeHold` is the claim, not the create handler.** Opening hours, lead
  time, horizon and `reservations.override` are the create handler's
  (`createReservation`, Issue #941) and run before it. It never sees a customer
  name: the customer is the opaque `externalCustomerRef`, kept out of the audit
  row and the event.
- **The hold caps always apply.** `NULL` in the settings is the module default
  (5 live holds per customer, 500 per tenant, `domain/booking-policy.ts`), not
  unlimited. The count is taken under a per-tenant advisory lock, so the holds of
  one tenant are serialised for the length of the claim transaction.

## Stays and blocks, in one place

- **A stay is dates.** `placeHold` takes `stay: { checkInDate, checkOutDate }`
  (local `YYYY-MM-DD` in the resource's zone, half-open) instead of an instant.
  `deriveStay` (`domain/booking-stay.ts`) validates them with the checks of
  `evaluateStay`, counts the nights as date arithmetic, and derives the arrival
  and departure instants from the resource's check-in and check-out times; the
  dates, nights, zone, local times and instants are **snapshotted onto the item**
  and are facts afterwards. A stay takes one unit for all its nights; `quantity`
  is how many rooms.
- **The allocator is the same loop** (`UnitClaim` `kind: "stay"`): the free-unit
  hint probes `daterange` overlap, the insert is `ON CONFLICT DO NOTHING`, and
  the second exclusion constraint is the authority. A slot resource and a stay
  resource never contend (a trigger makes an allocation's granularity its
  resource's mode).
- **A block is allocation rows with no reservation** (`UnitClaim` `kind:
"block"`, `application/booking-block-service.ts`): one row per covered unit,
  inserted in `(resource_id, ordinal)` order inside a savepoint, all-or-none,
  under the SAME stay constraint, so a block and a booking racing for a night
  are decided by the database and no override lifts a block. Over a live stay a
  block is `BLOCK_CONFLICT` and cancels nothing. Releasing a block releases its
  rows in the same statement (a trigger), and a replay writes nothing.
- **Expiry needed no change.** A stay hold expires on the same column and
  releases through the same item join as a slot hold, so `sql/200` and the
  reaper are untouched; lazy reclaim probes `daterange` for stays and blocks.

## Reservations, in one place

- **A transition is one transaction** (`transitionReservation`): lock the
  reservation `FOR UPDATE`, read the DATABASE clock in the same statement, decide
  with the pure state machine, refuse as a value BEFORE writing anything
  (`withTenant` commits a returned 4xx), then write the reservation, release the
  allocations where the verb says so, append exactly ONE history row, one audit
  row and one outbox event. Asking for the state a reservation is already in is a
  replay (`replayed: true`) and writes nothing, with any `Idempotency-Key`.
- **The routes** authorize the verb's permission first (default deny), validate
  the body strictly (a payment field is `PAYMENT_FIELD_NOT_ACCEPTED` naming it, any
  other unknown key a `VALIDATION_ERROR`), then `runIdempotent` (the stored
  response of the same key, user and request is returned byte for byte; a reused
  key with another request is `IDEMPOTENCY_CONFLICT`). A refusal is never stored.
  Not-found is one neutral 404 for an unknown id and another tenant's.
- **`overridePolicy` is a second, independent check.** Lifting hours, lead time and
  horizon needs `reservations.override` in addition to the verb's own permission,
  checked first through `authorizeInTransaction` (it is a high-risk action, so
  action-time separation-of-duties applies) and audited `critical`. It never lifts
  an allocation conflict. The port has no override.
- **Reschedule** (`rescheduleReservation` + `placeHold` with `replaces`) is one
  savepoint: release the old allocations, mark the old reservation `rescheduled`,
  insert the replacement under the same lineage, claim the new interval. The old
  row is superseded BEFORE the replacement exists, which is why `sql/208` makes
  that one foreign key deferred; a refusal anywhere rolls the whole move back.
- **Events** come from one database function, `awcms_booking_reservation_event_facts`
  (`sql/209`): the allow-list of non-personal facts, so a request transition, lazy
  reclaim and the sweep (which returns the facts of what it expired, because the
  worker may not read the tables) carry the same fields. `expired` is published by
  both ways a hold expires.
- **Ownership grants: none.** `ownershipGrant` can only widen a read, and the
  customer is an opaque token at the commerce authority, not a tenant user; the
  creator of a reservation is not entitled to read it for having created it.

## Reporting, in one place

- **No second analytics engine.** `domain/booking-reporting.ts` declares three
  `ProjectionDescriptor`s (`booking.reservations`, `booking.time`,
  `booking.nights`) in `module.ts`'s `reportingProjections`; the `reporting`
  module's worker, rebuild and reconciliation run them. Read permission
  `booking.reports.read`.
- **The source is the append-only event table, not the live domain events.** A
  rebuild is always a table re-scan, so the steady state and the rebuild are the
  same scan (trade-off in the header of `domain/booking-reporting.ts`). `sql/244`
  puts the quantities on the row at write time: booked/released seconds (service
  interval, buffers excluded) and booked/released unit-nights (one per unit and
  night), plus the generated `projection_kind` (`late_cancelled` is a subset of
  `cancelled`). Every metric only increases; net is `booked - released`.
- **Reports are live and windowed:** `GET /booking/reports/occupancy`
  (stay, per unit-night), `/utilization` (slot, booked over open seconds) and
  `/reservations` (hold pipeline, lead time, cancellation, no-show), all with
  Asia/Jakarta day windows. Pure rules in `domain/booking-report.ts`, the only
  SQL in `application/booking-report-directory.ts`.
- **Owner decision O8:** occupancy excludes holds (a hold is `heldUnitNights` and
  the pipeline, beside the rate, never in it); utilization is a separate report.
- **No revenue, no person.** Booking holds no price; no projection or report reads
  a customer reference, note, reason or actor. A ratio over fewer than 5
  reservations is withheld (counts are not anonymised: the reader holds
  `booking.reports.read` on that tenant).

## Time semantics, in one place

- Every instant is UTC and every interval half-open `[start, end)`; a request
  instant without an offset is a 400.
- A schedule is local wall-clock time in an IANA zone. `resolveLocalInstant`
  (`domain/booking-time.ts`) is the ONE gap/fold function (RFC 5545 section
  3.3.5): a nonexistent local time takes the offset before the gap, an ambiguous
  one takes its first occurrence.
- A stay is a local date interval; nights are `check_out - check_in` in dates.
  Check-in and check-out times derive display instants and never enter an overlap
  test or a night count. Same-day turnover is allowed.
- A block is a hard exclusion (nothing overrides it); a `closed` exception is a
  soft closure (`OUTSIDE_SCHEDULE`, overridable). Availability claims nothing:
  the allocator's exclusion constraints, not the read, prevent double booking.

## The rules the database holds

- **Double-booking is unrepresentable.** Two partial GiST exclusion constraints on
  `awcms_booking_resource_allocations`, one over instants (slot mode) and one over
  dates (stay mode), both over live rows only. Needs the trusted `btree_gist`
  extension (booking.md section 8.2).
- **The state machine is a trigger.** `awcms_booking_reservations_update_guard`
  allows exactly the legal transitions and, per transition, only the columns it may
  change. `domain/booking-reservation-state.ts` is the same table as a pure
  function; an integration test asserts they agree for every pair of states.
- **History is append-only.** Reservation events and items reject UPDATE and
  DELETE by trigger and by revoked privileges; nothing is ever deleted.
- **No money, no product id, no customer name** in any table (booking.md section
  10.2); a test reads `information_schema` to keep it so.
- **RLS `ENABLE` + `FORCE`** and composite `(tenant_id, id)` foreign keys on every
  table.

## Layout

| Path                                                 | What it is                                                                                      |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `module.ts`                                          | Descriptor: 32 permissions, `dataLifecycle` and `subjectData` for the tables                    |
| `domain/booking-reservation-state.ts`                | The reservation state machine as a pure function (no I/O, the caller passes the database clock) |
| `domain/booking-permissions.ts`                      | Literal guard objects for `authorizeInTransaction` (used from Issue #938)                       |
| `domain/booking-audit.ts`                            | Audit event names and severities                                                                |
| `domain/booking-time.ts`                             | Pure zone, date arithmetic and RFC 5545 gap/fold resolution                                     |
| `domain/booking-schedule.ts`                         | Pure closed rules schema, schedule selection, expansion to UTC windows, closures                |
| `domain/booking-availability.ts`                     | Pure slot availability and stay evaluation (no I/O, no clock)                                   |
| `domain/booking-validation.ts`                       | Strict request validation (RFC 3339 with offset, IANA zones)                                    |
| `domain/booking-staff-availability.ts`               | The StaffAvailabilityConsumer seam, its no-op, and the pure staff rules (Issue #949)            |
| `application/booking-staff-availability-consumer.ts` | The consumer over the hr_workforce port, and the one on/off decision                            |
| `application/booking-staff-claim.ts`                 | The staff half of a slot claim: a person won under the staff exclusion constraint               |
| `application/*-directory.ts`                         | The only code that reads or writes rows (database clock, tenant-scoped, savepoints)             |
| `domain/booking-allocation.ts`                       | Pure hold lifetime, slot window, unit ordering, SQLSTATE classification, retry backoff          |
| `application/booking-allocator.ts`                   | `claimUnits`: the units of one item, all-or-none, under the exclusion constraint                |
| `application/booking-hold-expiry.ts`                 | Lazy reclaim and the reaper pass: one statement per expiry (reservation, units, history)        |
| `application/booking-hold-service.ts`                | `placeHold`: reservation, item snapshot, allocations, history, audit, in one savepoint          |
| `application/booking-hold-expiry-job.ts`             | The per-tenant sweep behind `scripts/booking-holds-expire.ts`                                   |
| `application/booking-reconciliation.ts`              | Read-only proof that reservations, allocations and blocks agree; the reaper lag                 |
| `domain/booking-stay.ts`                             | Pure stay dates, night limits, pool terms and block validation (no I/O, no clock)               |
| `application/booking-block-service.ts`               | `createBlock` / `releaseBlock`: blocked nights as allocation rows, `BLOCK_CONFLICT`, audit      |
| `domain/booking-policy.ts`                           | Pure policy: slot hours/lead/horizon, late cancellation, no-show grace, the default hold caps   |
| `domain/booking-reservation-events.ts`               | The nine event types and the closed payload builder (no person, no reason, no amount)           |
| `domain/booking-reservation-validation.ts`           | Strict reservation bodies; payment fields refused by name                                       |
| `application/booking-reservation-service.ts`         | `createReservation`, `transitionReservation`, `rescheduleReservation`                           |
| `application/booking-reservation-policy.ts`          | Hours, lead time and horizon for a claim, from the same engine availability uses                |
| `application/booking-reservation-directory.ts`       | Reservation list, detail and history (the note is never read)                                   |
| `application/booking-event-emit.ts`                  | Outbox events from the one facts function, in the transition's transaction                      |
| `application/booking-port-adapter.ts`                | The `BookingPort` (`_shared/ports/booking-port.ts`, contract 1.1.0): the verbs and the reads    |
| `application/booking-port-reads.ts`                  | The port's `get` / offering reads: an explicit column allow-list, never a customer reference    |
| `application/booking-transition-route.ts`            | The handler body shared by the five in-place transition routes                                  |
| `application/booking-block-routes.ts`                | The handler bodies of block create / release: `runIdempotent`, then the block service           |
| `application/booking-block-directory.ts`             | Block reads for the routes: detail and keyset list                                              |
| `domain/booking-reporting.ts`                        | The three reporting projection descriptors and why the event table is their source              |
| `domain/booking-report.ts`                           | Pure report rules: Jakarta day windows, clipping, O8 statuses, small-group suppression          |
| `application/booking-report-directory.ts`            | The only SQL of the report routes: aggregates only, tenant-scoped, no person                    |

Not in the schema yet and recorded as follow-ups: `service_requirements`
(booking.md section 4). `staff_assignments` arrived with Issue #949 (`sql/305`,
booking.md section 10.3). `resource_blocks` arrived with
Issue #938 and its allocation rows and writer with Issue #940 (`sql/204`); the
HTTP routes for blocks (`blocks.read` / `.create` / `.release`, seeded by
`sql/181`) arrived with Issue #1012; the screens are #942. A resource-wide block
covers every unit of the resource, including a unit added later (`sql/240`: an
AFTER INSERT trigger on `resource_units` plus the resource lock in
`readBlockUnits`); the reconciliation (`block_missing_allocation`) remains the
detector for a write that bypassed the trigger. A block and its rows share one
release instant (`sql/241`).

Follow-ups recorded by the security audit of the foundation: the database
still does not tie a status change to an event row (the expiry pass and the
transition service each write exactly one history row per transition, in the same
transaction, and a test counts them; a trigger that enforces it is not built), and
the append-only tables should also refuse TRUNCATE by trigger (today only the
revoked privilege stops the runtime role).
