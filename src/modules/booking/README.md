🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](README.id.md)

# `booking`

Generic **resources, capacity units, schedules and reservations** for anything
that rents out time, space or capacity, including nightly stays (Issue #937,
[ADR-0131](../../../docs/adr/0131-generic-booking-module-admission.md), amended by
[ADR-0135](../../../docs/adr/0135-day-granularity-stays-admitted-into-booking-v1.md)).
The full design pack is [`docs/awcms/booking.md`](../../../docs/awcms/booking.md);
this file is the map of the code.

## This is the foundation slice

Present: the descriptor (`experimental`, no routes, no navigation), the schema
(`sql/180`), the permission catalogue (`sql/181`), the pure reservation state
machine, the guard literals and the audit event names. **Not present yet:** the
allocator, availability search, any HTTP route, OpenAPI path, AsyncAPI channel,
admin screen and reporting projection (Issues #938 to #941).

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

| Path                                  | What it is                                                                                      |
| ------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `module.ts`                           | Descriptor: 32 permissions, `dataLifecycle` and `subjectData` for the tables                    |
| `domain/booking-reservation-state.ts` | The reservation state machine as a pure function (no I/O, the caller passes the database clock) |
| `domain/booking-permissions.ts`       | Literal guard objects for `authorizeInTransaction` (used from Issue #938)                       |
| `domain/booking-audit.ts`             | Audit event names and severities                                                                |

Not in the schema yet and recorded as follow-ups: `service_requirements`,
`resource_blocks` and `staff_assignments` (booking.md section 4).

Follow-ups recorded by the security audit of the foundation: the transition
handlers of #939 and #940 must write exactly one history event per transition
(the database does not yet tie a status change to an event row), and the
append-only tables should also refuse TRUNCATE by trigger (today only the
revoked privilege stops the runtime role).
