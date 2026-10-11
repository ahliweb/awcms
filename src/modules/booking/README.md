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
**Not present yet:** the allocator and any write of a reservation, blocks being
written, AsyncAPI channels, an admin screen and the reporting projection
(Issues #939 to #941).

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

| Path                                   | What it is                                                                                      |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `module.ts`                            | Descriptor: 32 permissions, `dataLifecycle` and `subjectData` for the tables                    |
| `domain/booking-reservation-state.ts`  | The reservation state machine as a pure function (no I/O, the caller passes the database clock) |
| `domain/booking-permissions.ts`        | Literal guard objects for `authorizeInTransaction` (used from Issue #938)                       |
| `domain/booking-audit.ts`              | Audit event names and severities                                                                |
| `domain/booking-time.ts`               | Pure zone, date arithmetic and RFC 5545 gap/fold resolution                                     |
| `domain/booking-schedule.ts`           | Pure closed rules schema, schedule selection, expansion to UTC windows, closures                |
| `domain/booking-availability.ts`       | Pure slot availability and stay evaluation (no I/O, no clock)                                   |
| `domain/booking-validation.ts`         | Strict request validation (RFC 3339 with offset, IANA zones)                                    |
| `domain/booking-staff-availability.ts` | The no-op StaffAvailabilityConsumer seam that Issue #949 wires                                  |
| `application/*-directory.ts`           | The only code that reads or writes rows (database clock, tenant-scoped, savepoints)             |

Not in the schema yet and recorded as follow-ups: `service_requirements` and
`staff_assignments` (booking.md section 4). `resource_blocks` arrived with
Issue #938, but its allocation rows (so the stay exclusion constraint also holds
a block against a reservation) and its writer arrive with the allocator (#939);
until then availability reads blocks directly.

Follow-ups recorded by the security audit of the foundation: the transition
handlers of #939 and #940 must write exactly one history event per transition
(the database does not yet tie a status change to an event row), and the
append-only tables should also refuse TRUNCATE by trigger (today only the
revoked privilege stops the runtime role).
