🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](README.id.md)

# `booking`

Generic **resources, capacity units, schedules and reservations** for anything
that rents out time, space or capacity, including nightly stays (Issue #937,
[ADR-0131](../../../docs/adr/0131-generic-booking-module-admission.md), amended by
[ADR-0135](../../../docs/adr/0135-day-granularity-stays-admitted-into-booking-v1.md)).
The full design pack is [`docs/awcms/booking.md`](../../../docs/awcms/booking.md);
this file is the map of the code.

## Slices present

Foundation (Issue #937): the descriptor (`experimental`), the schema (`sql/180`),
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

Stays and blocks (Issue #940, `sql/204`): a stay is claimed through the same
allocator and `placeHold` (`stay: { checkInDate, checkOutDate }`, the second
exclusion constraint over dates), blocked nights are allocation rows owned by a
`resource_blocks` row (`createBlock` / `releaseBlock`, `BLOCK_CONFLICT`), and
the lazy reclaim and the reconciliation understand both. **Not present yet:**
the reservation routes and the transitions after creation (`confirm`, `cancel`,
`reschedule`, ...), the block routes, AsyncAPI channels, an admin screen and
the reporting projection (Issues #941 and #942).

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
  time, horizon and `reservations.override` are the handler's (Issue #941) and
  run before it. It never sees a customer name: the customer is the opaque
  `externalCustomerRef`, kept out of the audit row and the event detail.

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

| Path                                     | What it is                                                                                      |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `module.ts`                              | Descriptor: 32 permissions, `dataLifecycle` and `subjectData` for the tables                    |
| `domain/booking-reservation-state.ts`    | The reservation state machine as a pure function (no I/O, the caller passes the database clock) |
| `domain/booking-permissions.ts`          | Literal guard objects for `authorizeInTransaction` (used from Issue #938)                       |
| `domain/booking-audit.ts`                | Audit event names and severities                                                                |
| `domain/booking-time.ts`                 | Pure zone, date arithmetic and RFC 5545 gap/fold resolution                                     |
| `domain/booking-schedule.ts`             | Pure closed rules schema, schedule selection, expansion to UTC windows, closures                |
| `domain/booking-availability.ts`         | Pure slot availability and stay evaluation (no I/O, no clock)                                   |
| `domain/booking-validation.ts`           | Strict request validation (RFC 3339 with offset, IANA zones)                                    |
| `domain/booking-staff-availability.ts`   | The no-op StaffAvailabilityConsumer seam that Issue #949 wires                                  |
| `application/*-directory.ts`             | The only code that reads or writes rows (database clock, tenant-scoped, savepoints)             |
| `domain/booking-allocation.ts`           | Pure hold lifetime, slot window, unit ordering, SQLSTATE classification, retry backoff          |
| `application/booking-allocator.ts`       | `claimUnits`: the units of one item, all-or-none, under the exclusion constraint                |
| `application/booking-hold-expiry.ts`     | Lazy reclaim and the reaper pass: one statement per expiry (reservation, units, history)        |
| `application/booking-hold-service.ts`    | `placeHold`: reservation, item snapshot, allocations, history, audit, in one savepoint          |
| `application/booking-hold-expiry-job.ts` | The per-tenant sweep behind `scripts/booking-holds-expire.ts`                                   |
| `application/booking-reconciliation.ts`  | Read-only proof that reservations, allocations and blocks agree; the reaper lag                 |
| `domain/booking-stay.ts`                 | Pure stay dates, night limits, pool terms and block validation (no I/O, no clock)               |
| `application/booking-block-service.ts`   | `createBlock` / `releaseBlock`: blocked nights as allocation rows, `BLOCK_CONFLICT`, audit      |

Not in the schema yet and recorded as follow-ups: `service_requirements` and
`staff_assignments` (booking.md section 4). `resource_blocks` arrived with
Issue #938 and its allocation rows and writer with Issue #940 (`sql/204`); the
HTTP routes for blocks (`blocks.read` / `.create` / `.release`, seeded by
`sql/181`) arrive with the route slices (#941, #942). A resource-wide block
covers the units that exist when it is placed; a unit added later is reported by
the reconciliation (`block_missing_allocation`), not covered.

Follow-ups recorded by the security audit of the foundation: the transition
handlers of #941 must write exactly one history event per transition (the
database does not yet tie a status change to an event row; the expiry pass of
#939 does, in one statement), and the append-only tables should also refuse
TRUNCATE by trigger (today only the revoked privilege stops the runtime role).
