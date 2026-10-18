🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](booking.id.md)

# Booking — resources, schedules and reservations (module doc pack)

> **Status:** admitted by [ADR-0131](../adr/0131-generic-booking-module-admission.md)
> (Issue #915). **Built in slices: §13 says what exists in the code today**
> (schema, permission catalogue, availability and schedule routes, the
> allocator with holds and expiry, stays and blocked nights through the same
> allocator, and the reservation routes, the `BookingPort` and the nine live
> events), the block routes (#1012), the reports (#944) and the admin configuration routes
> (#1030: resources and units, pools, offerings, policy); the admin screens (#942, §3.0.3) are built, the module is
> `active`, and the open questions in §11 still govern what is not. PRD-lite, state machine, ERD and data
> dictionary, holds and idempotency, permissions/RLS matrix, reporting and
> events, the double-booking strategy with its required regression test, threat
> and privacy notes, the adapter/port contract and the open questions are in
> one place. Decisions and rejected alternatives are in the ADR. It follows the
> shape of [`inventory-ledger.md`](inventory-ledger.md),
> [`procurement.md`](procurement.md) and [`tax-calculation.md`](tax-calculation.md).
> The nine reservation events are **live** (Issue #941, §7.4): they moved from
> the provisional AsyncAPI document to the live one. Day-granularity (nightly) stays are part of v1 by [ADR-0135](../adr/0135-day-granularity-stays-admitted-into-booking-v1.md) (§2.5, §3.1).

## 1. PRD-lite

**Problem.** Anything that rents out time, space or capacity — a room, a
treatment chair, a court, a loan car, a workshop bay, a class seat — needs the
same thing: a claim on a limited resource for an interval, that two customers
cannot both win. Built per consumer, each differs in how it can be wrong: a
check-then-insert race, a slot grid that cannot express variable duration or
buffers, a zone-less datetime, a hold that never expires, a payment flag copied
onto the reservation.

**Goal.** One generic module that models resources, capacity, offerings,
schedules with explicit timezones, holds with expiry and a reservation
lifecycle with append-only history, and that makes double-booking impossible
**in the database** — with no dependency on a store, a payment provider or a
payroll table.

**Users (provisional — O1).** A receptionist or scheduler (creates, reschedules,
checks in), a manager (overrides, policy), a resource owner (maintains
resources and schedules), a customer acting through a downstream channel (never
directly: public endpoints are a downstream BFF concern), an adapter (a commerce
or portal integration calling the port), an auditor (history, reconciliation).

**Acceptance criteria (from Issue #915) and where each is met**

| Criterion                                                                                          | Where                                                           |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Resource / ResourcePool / capacity; ServiceOffering                                                | §4 `resources`, `resource_units`, `resource_pools`, `service_*` |
| Schedule + ScheduleException, explicit IANA timezone, UTC instants, interval bounds, buffers       | §2, §4 `schedules`, `schedule_exceptions`                       |
| Deterministic recurrence (RFC 5545 semantics)                                                      | §2.4: a closed structured subset                                |
| Reservation, ReservationItem, ResourceAllocation, StaffAssignment, append-only ReservationEvent    | §4                                                              |
| held → confirmed → checked_in → completed, cancelled, rescheduled, no_show; payment state not here | §3                                                              |
| Holds with expiry; idempotent create/reschedule; reschedule preserves history                      | §5                                                              |
| Proven double-booking prevention + the concurrent-final-slot test                                  | §8                                                              |
| Day-granularity (nightly) stays and blocked nights (owner decision O2, ADR-0135)                   | §2.5, §3.1, §4, §8.1 rule 7, §8.3 T9–T13                        |
| Permissions + RLS (FORCE) matrix                                                                   | §6                                                              |
| Threat and privacy notes                                                                           | §9                                                              |
| No `commerce` dependency; adapter/port contract                                                    | §10                                                             |
| Staff availability via a workforce availability port, never payroll tables                         | §10.3                                                           |
| Occupancy / utilization projections on `reporting`, owned by this module                           | §7.2                                                            |
| Open questions listed explicitly                                                                   | §11                                                             |

**Non-goals (recorded, not forgotten).** Price, payment, deposit, refund,
invoice or receipt (any commerce layer); a customer or staff master; any
notification or reminder delivery (a generic delivery capability, #918); public
anonymous endpoints; calendar sync with external calendars; waitlists; dynamic
pricing; best-fit multi-resource optimisation; counted capacity without unit
rows; shared turnaround between consecutive bookings; accounting.

## 2. Time semantics

### 2.1 Instants and intervals

- Every instant is a UTC `timestamptz`; the API speaks RFC 3339 with an explicit
  offset or `Z`. A request without an offset is `400`, never "server local".
- **Every interval is half-open `[start, end)`**: inclusive start, exclusive
  end. A booking 10:00–11:00 and one 11:00–12:00 share a boundary and do not
  overlap. `start < end` is a CHECK, and so is `end − start ≤ 368 days` on a reservation and an item (`sql/204`). A stay bounds the same 366 in DATES (§2.5), but the instants of a 366-night stay whose check-out time is later in the day than its check-in time, across a daylight-saving change, can span a day and an hour more than 366 days, and a CHECK on instants must not refuse a stay the date rule admits; for a slot the bound is therefore 368 days, not 366.
- Database range expressions always use `tstzrange(a, b, '[)')`.

### 2.2 Timezones

- A `schedule`, and therefore a resource, carries an **IANA timezone** name
  (`Asia/Pontianak`). Offsets such as `+07:00`, abbreviations (`WIB`) and the
  zone-less "local" are refused. Validated against the runtime tz database and
  against `pg_timezone_names`.
- A schedule is written in **local wall-clock time** ("Mon–Fri 09:00–17:00") and
  expanded to UTC instants by one pure function. Gaps and folds follow RFC 5545
  §3.3.5: a nonexistent local time (spring forward) is interpreted with the
  offset in effect **before** the gap; an ambiguous one (fall back) takes its
  **first** occurrence. Indonesian zones have no daylight saving; the rule
  exists because the module is generic and the code must not assume it.
- **A stored allocation's UTC instants are facts.** A schedule edit or a tz
  database update changes future availability only; it never moves a confirmed
  reservation. A schedule change that now conflicts with confirmed reservations
  produces a read-only conflict report (§7.3); it cancels nothing.

### 2.3 Buffers

An offering carries `setup_seconds` and `cleanup_seconds`. The **service
interval** `[starts_at, ends_at)` is what the customer sees. The **occupied
range** `[starts_at − setup, ends_at + cleanup)` is what the exclusion
constraint tests. Both are snapshotted onto the allocation, so editing the
offering never rewrites an existing booking. Buffers are conservative: one
booking's clean-up and the next one's setup cannot overlap (shared turnaround is
a non-goal).

### 2.4 Recurrence — the subset

RFC 5545 is the vocabulary, not the parser. A recurrence is a **structured
object**, validated against a closed schema, never an RRULE string from a client:

| Part                | Supported                                                                                                  | Not supported (refused with `RECURRENCE_UNSUPPORTED`)        |
| ------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `DTSTART`           | local date-time **plus** the IANA zone (never floating)                                                    | floating or UTC-only starts for a wall-clock rule            |
| `FREQ`              | `DAILY`, `WEEKLY`                                                                                          | `MONTHLY`/`YEARLY` in v1 (open: O2), `HOURLY` and finer      |
| `INTERVAL`          | 1–52                                                                                                       | larger                                                       |
| `BYDAY`             | weekdays, for `WEEKLY` (no ordinal prefixes such as `1MO`)                                                 | `BYSETPOS`, `BYWEEKNO`, `BYYEARDAY`, `BYMONTH`, `BYMONTHDAY` |
| `UNTIL` xor `COUNT` | exactly one, `UNTIL` as a local date; `COUNT` ≤ 52 for a reservation series, ≤ 1000 for a schedule horizon | both, or neither (unbounded)                                 |
| `EXDATE` / `RDATE`  | as `schedule_exceptions` rows (closed days, extra days) — dates in the schedule's zone                     | time-of-day exceptions inside an expanded occurrence         |

Expansion is deterministic: same input and same tz database version → same
instants, in ascending order, capped (schedule expansion horizon ≤ 366 days per
call; a series ≤ 52 occurrences). A booked series is **materialised** into N
independent reservations sharing a `series_id`, created all-or-none in one
transaction (a conflict on occurrence 7 refuses the series and names the
occurrence; a partial-accept mode is a follow-up). Each occurrence is cancelled
or rescheduled on its own.

### 2.5 Stays — day-granularity (nightly) bookings

([ADR-0135](../adr/0135-day-granularity-stays-admitted-into-booking-v1.md), answering owner decision O2: the first vertical is hotel / villa / rental.) A resource with `booking_mode = 'stay'` is booked by **dates, not instants**; everything in §2.1–§2.4 still governs resources in `slot` mode, and the two modes never share a unit.

- **A stay is a half-open local date interval `[check_in_date, check_out_date)`**: two calendar dates (`YYYY-MM-DD`) in the resource's IANA zone (the §2.2 rules: a zone name, never an offset or abbreviation). Its **nights** are exactly the dates in the interval, so `nights = check_out_date − check_in_date` is date arithmetic and never depends on how long a day is. `check_in_date < check_out_date`; `nights ≤ 366` is a CHECK; the offering's `min_nights` / `max_nights` narrow it (`MIN_STAY_VIOLATION`, `MAX_STAY_EXCEEDED`, both `409`). Malformed, instant-shaped or out-of-order dates are `400 STAY_DATES_INVALID`; an instant is never accepted for a stay.
- **The occupancy unit is (unit, night).** A stay claims one unit for every night in its interval. In v1 a stay stays on **one** unit for all its nights (no room moves inside a stay; open, §11).
- **Same-day turnover is allowed by construction.** `[10th, 12th)` and `[12th, 14th)` do not overlap: the 12th is the check-out date of one and the check-in date of the other. Whether the unit is physically ready between check-out time and check-in time is operational and is not enforced (shared turnaround is a non-goal); an operator who needs a cleaning day creates a block.
- **Check-in and check-out times are configuration, not occupancy.** `stay_check_in_time` and `stay_check_out_time` are local times in the resource's zone (tenant defaults in `settings`; the module fixes no value). They derive the arrival and departure **instants**: `starts_at` = `check_in_date` at the check-in time, `ends_at` = `check_out_date` at the check-out time, converted with the §2.2 gap and fold rules. The zone, the two local times and the two instants are **snapshotted onto the item** at creation and are facts afterwards. The instants serve display, the arrival window, lead time and horizon, the late-cancellation cutoff, the no-show grace and event payloads. **They never enter an overlap test or a night count.**
- **The property time zone is the resource's `timezone`.** v1 has no separate property entity (open, §11). "Today" for a stay is the database clock's local date in that zone, `(clock_timestamp() AT TIME ZONE timezone)::date`: a `check_in_date` before it is `STAY_DATES_INVALID`; arriving late on the check-in date is allowed; lead time and horizon are then applied to the derived arrival instant.
- **Daylight saving and zone edge cases.** (1) Overlap and night counts use dates only, so a 23- or 25-hour day, or a skipped or repeated local hour, changes nothing. (2) A configured time inside a spring-forward gap takes the offset before the gap, and a repeated time (fall back) takes its first occurrence (§2.2); the item snapshot records the result. (3) For a stay across a transition `ends_at − starts_at` is not a multiple of 24 hours, and nothing reads that difference. (4) A tzdata update never moves a stored stay: dates and snapshotted instants are facts (§2.2). (5) A local date that does not exist in the zone (a calendar-day skip) is refused as `STAY_DATES_INVALID`. (6) A resource's `timezone` cannot change while it has live stay allocations (`TIMEZONE_IN_USE`): a date only means something in its zone.
- **Minimum stay is per offering and nothing finer.** Date-dependent minimums, arrival-day restrictions and rate plans are out of v1 (open, §11). The weekly windows of a schedule are ignored for a stay resource; only `closed` schedule exceptions apply, as a **soft closure** — a stay touching a closed date is refused `OUTSIDE_SCHEDULE`, `reservations.override` lifts it, and an existing reservation is never touched (the §7.3 conflict report lists it).
- **Blocked nights are a hard exclusion.** Maintenance, owner use or any other reason that takes units out of sale for a date range is a `resource_blocks` row (§4) whose allocation rows sit under the **same** exclusion constraint as stays, so a block can never be double-booked against a guest and no override lifts it. Creating a block never cancels a reservation: it is refused `BLOCK_CONFLICT` and names the conflicting reservations (to a caller holding `reservations.read`) for the operator to move or cancel first.
- **No staff, no buffers, no series.** A stay offering has `staff_required = false`, NULL `setup_seconds` / `cleanup_seconds` / `duration_seconds` / `slot_step_seconds` (CHECKs both ways), and refuses recurrence (`RECURRENCE_UNSUPPORTED`).

## 3. The reservation state machine

```
          ┌── expire (job / lazy reclaim) ──> expired
held ─────┤
          ├── confirm ──> confirmed ──check_in──> checked_in ──complete──> completed
          │                  │  │
          │                  │  ├── reschedule ──> rescheduled (terminal; a NEW reservation is created)
          │                  │  └── mark no_show (after start + grace) ──> no_show
          └── cancel ────────┴── cancel ──> cancelled
```

`create` yields `held` or, when the offering's `confirmation_mode = immediate`,
`confirmed` in the same transaction (events `held` is skipped; `created` and
`confirmed` are both emitted).

| Transition                        | Permission                  | Allocations                                            | Idem. | Audit    |
| --------------------------------- | --------------------------- | ------------------------------------------------------ | ----- | -------- |
| (create) → held / confirmed       | `reservations.create`       | **inserted** under the exclusion constraint            | yes   | info     |
| held → confirmed                  | `reservations.confirm`      | kept; hold expiry cleared                              | yes   | info     |
| held → expired                    | system (job) / lazy reclaim | **released** (`released_reason = expired`)             | n/a   | info     |
| held / confirmed → cancelled      | `reservations.cancel`       | **released**                                           | yes   | warning  |
| confirmed → rescheduled (+ new)   | `reservations.reschedule`   | old released, new inserted, one transaction            | yes   | warning  |
| confirmed → checked_in            | `reservations.check_in`     | kept                                                   | yes   | info     |
| checked_in → completed            | `reservations.complete`     | kept (booked interval is not shrunk)                   | yes   | info     |
| confirmed → no_show               | `reservations.no_show`      | kept (so the slot is accounted as consumed)            | yes   | warning  |
| create / reschedule outside hours | `reservations.override`     | as above; **never** overrides the exclusion constraint | yes   | critical |

Rules the database enforces (trigger `awcms_booking_reservations_update_guard`),
not only the handlers: only these transitions; per transition only the columns it
may change; `expired`, `cancelled`, `rescheduled`, `completed` and `no_show` are
terminal; `confirmed` requires `hold_expires_at IS NULL` or a not-yet-passed
expiry at the moment of the transition; an interval, an item or a lineage never
changes after creation. Every row of `awcms_booking_reservation_events` is
appended in the same transaction as its transition.

**Payment state is not stored.** There is no `paid`, `deposit`, `amount`,
`balance` or `payment_*` column on any table of this module, and a body naming
one is a `400` that names the field. A commerce adapter records its order
reference in `external_ref_*` (§4) and decides _when_ to ask for a confirm.

Refusals and codes: `INVALID_STATE` (409), `SLOT_UNAVAILABLE` (409: exclusion
conflict or no free unit), `OUTSIDE_SCHEDULE` (409, `override` lifts it),
`HOLD_EXPIRED` (409), `HOLD_LIMIT_EXCEEDED` (429), `LEAD_TIME_VIOLATION`,
`HORIZON_EXCEEDED`, `PARTY_SIZE_OUT_OF_RANGE` (409), `STAFF_UNAVAILABLE` (409),
`RECURRENCE_UNSUPPORTED`, `TIMEZONE_INVALID`, `IDEMPOTENCY_REQUIRED` (400),
`IDEMPOTENCY_CONFLICT` (409), `PAYMENT_FIELD_NOT_ACCEPTED` (400). The claim
(`placeHold`, Issue #939) adds the refusals only it can make:
`CONTENTION_RETRY` (409: the claim kept losing races or deadlocked three times
running; retry), `QUANTITY_EXCEEDS_UNITS` (422: more units asked than the target
has at all), `BOOKING_MODE_MISMATCH` (409: a time offering on a stay resource,
or the reverse), `EXTERNAL_REF_IN_USE` (409: a live reservation already holds
that `external_ref`), `RESOURCE_NOT_FOUND` and `OFFERING_NOT_FOUND` (404,
neutral: another tenant's id is the same answer as an unknown one). The stay slice (Issue #940) adds: `STAY_DATES_INVALID` (400: malformed or out-of-order dates, an instant instead of a date, a date the zone does not have, a check-in date already past in the zone), `MIN_STAY_VIOLATION` and `MAX_STAY_EXCEEDED` (409: the offering's night limits), `STAY_POOL_INCONSISTENT` (409: the stay resources of a pool do not share one zone and one pair of check-in and check-out times, so there is no single snapshot to take), and, for a block, `BLOCK_CONFLICT` (409: a live stay or another block holds a night of the range; nothing was cancelled), `UNIT_NOT_FOUND` and `BLOCK_NOT_FOUND` (404). A booking that loses a night to a block, or to another stay, is `SLOT_UNAVAILABLE`, as for slots.

The reservation routes (Issue #941) add the refusals only they can make:
`NO_SHOW_TOO_EARLY` (409: before the start plus the grace), `CHECK_IN_TOO_EARLY`
(409: a stay before its check-in date in the resource's zone), `RESOURCE_REQUIRED`
(400: a reschedule of a reservation that spans several resources must say where
it moves), `LEAD_TIME_VIOLATION`, `HORIZON_EXCEEDED` and `OUTSIDE_SCHEDULE` (all
409, all lifted only by `reservations.override`), and the neutral
`RESERVATION_NOT_FOUND` (404: an unknown id, another tenant's id and a hidden one
are one answer). `HOLD_EXPIRED` is also the answer for a hold the sweep has
already expired, not only for one that has elapsed and not been swept: a payment
observed after expiry learns it was too late.

**Late cancellation.** An offering's `cancellation_cutoff_seconds` makes a
cancellation inside the cutoff carry `late_cancellation = true` on the event and
the reservation. The module records the fact; **any fee is a commerce decision**.

**No-show.** Marked by a person, after `starts_at + no_show_grace_seconds`
(policy). An automatic no-show job is off by default and is an open question
(O2/O3).

### 3.0 The routes and the transition service (Issue #941)

| Route (all under `/api/v1/booking`)           | Verb       | Permission                | Success                                                    |
| --------------------------------------------- | ---------- | ------------------------- | ---------------------------------------------------------- |
| `POST /reservations`                          | create     | `reservations.create`     | `201`, `{ reservation, replayed, policyLifted }`           |
| `POST /reservations/{id}/confirm`             | confirm    | `reservations.confirm`    | `200`, `{ reservation, replayed }`                         |
| `POST /reservations/{id}/cancel`              | cancel     | `reservations.cancel`     | `200`, `{ reservation, replayed }`                         |
| `POST /reservations/{id}/reschedule`          | reschedule | `reservations.reschedule` | `200`, `{ reservation, previous, replayed, policyLifted }` |
| `POST /reservations/{id}/check-in`            | check_in   | `reservations.check_in`   | `200`, `{ reservation, replayed }`                         |
| `POST /reservations/{id}/check-out`           | complete   | `reservations.complete`   | `200`, `{ reservation, replayed }`                         |
| `POST /reservations/{id}/no-show`             | no_show    | `reservations.no_show`    | `200`, `{ reservation, replayed }`                         |
| `GET /reservations`, `GET /reservations/{id}` | read       | `reservations.read`       | list (keyset) / detail with the history                    |

Every mutation requires `Idempotency-Key` (the shared component, ADR-0129) and
takes the same path: the route authorizes its permission first (default deny),
validates the body strictly, then `runIdempotent` returns the stored response of
the same key, user and request or runs the transition. A refusal is a returned
value, is never stored, and wrote nothing. The service
(`application/booking-reservation-service.ts`) locks the reservation `FOR UPDATE`,
reads the database clock in the same statement, decides with the pure state
machine, and only then writes: the reservation, the allocations the verb releases,
**exactly one** history row, one audit row and one outbox event, in the one
transaction. The `BookingPort` (§10.1) calls the same functions, so a transition
made through the port is identical to one made through the route.

**`overridePolicy` is a second, independent check.** Opening hours, lead time and
horizon are refused unless the body says `overridePolicy: true` AND the caller
also holds `reservations.override`, which is checked first through
`authorizeInTransaction` (a high-risk action, so action-time separation of duties
applies), before anything is read or written, and audited `critical`. `create`
alone cannot lift policy and `override` alone cannot create (both tested). It
never lifts an allocation conflict. A pool is as strict as its strictest member,
because the allocator may land the booking on any of them.

**Ownership.** There is no ownership grant on any reservation route: grants can
only widen a read, the customer is an opaque token at the commerce authority and
not a tenant user, and the creator of a reservation is not entitled to read it for
having created it. A customer-facing grant is a downstream decision (ADR-0063).

### 3.0.1 The block routes (Issue #1012)

| Route (all under `/api/v1/booking`) | Verb    | Permission       | Success                                                       |
| ----------------------------------- | ------- | ---------------- | ------------------------------------------------------------- |
| `POST /blocks`                      | create  | `blocks.create`  | `201`, `{ block, replayed: false }`                           |
| `POST /blocks/{id}/release`         | release | `blocks.release` | `200`, `{ block, replayed, releasedAllocations }`             |
| `GET /blocks`, `GET /blocks/{id}`   | read    | `blocks.read`    | list (keyset; filters `resourceId`, `unitId`, `status`) / one |

`POST /blocks` takes `{ resourceId, unitId?, fromDate, toDate, reasonCode }`
(strict body; a client cannot assert a status or an actor). `unitId` absent or
null blocks every unit, **including units added later** (see §4). A block is
**high-impact** (it removes sellable inventory): `blocks.create` is a separate
permission, audited `warning` (`booking.block.created`); a release is audited
`info` (`booking.block.released`). Both take `Idempotency-Key` and use the same
`runIdempotent` path as the reservation routes, so:

- a client that retries after the commit receives the **stored response** (the
  same block, the same `201`) and never `409 BLOCK_CONFLICT` naming its own block
  (finding N2 of the #940 review). The exclusion constraint is never the retry
  mechanism; it decides only between genuinely different callers;
- concurrent requests with one key are serialised by the per-key advisory lock and
  make one block;
- a refusal is a returned value, is never stored and wrote nothing, so the same
  key succeeds once the obstacle is gone; a reused key with a different request or
  by another user is `409 IDEMPOTENCY_CONFLICT`.

`BLOCK_CONFLICT` (`409`) names the conflicting reservations (number, status,
dates; never a customer reference) and blocks in `error.details.conflicts` **only
to a caller who also holds `reservations.read`**, decided through
`authorizeInTransaction` (ABAC applies). Without it the caller learns that nights
are taken, not by whom. Creating a block never cancels a reservation. Other
refusals: `RESOURCE_NOT_FOUND` / `UNIT_NOT_FOUND` (`404`), `BOOKING_MODE_MISMATCH`
(`409`, a slot resource), `STAY_DATES_INVALID` (`400`), `CONTENTION_RETRY` (`409`).
Releasing an already released block is `200` with `replayed: true` and writes
nothing; an unknown id and another tenant's id are one `404 BLOCK_NOT_FOUND`.

**No domain event in v1.** Blocks are an administrator's configuration of what is
for sale, not a fact a consumer of the nine reservation events needs to react to,
and nothing consumes them (channel-manager events are open, §11). They are
audited; an event can be added later without a breaking change, and then follows
the AsyncAPI rules of §7.4.

### 3.0.2 The admin configuration routes (Issue #1030)

Prerequisite of the admin screens (#942): the screens call only these and the routes above. Resources and their units, resource pools, service offerings and the tenant policy, all under `/api/v1/booking`, all `defineTenantRoute`, default-deny, tenant-scoped under RLS FORCE.

| Route                                                                                 | Permission                                    | Success                                   |
| ------------------------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------- |
| `GET /resources`, `GET /resources/{id}`                                               | `resources.read`                              | list (keyset) / one with its `units`      |
| `POST /resources`                                                                     | `resources.create`                            | `201`, `{ resource, replayed: false }`    |
| `PATCH /resources/{id}`                                                               | `resources.update`                            | `200`, `{ resource, replayed }`           |
| `DELETE /resources/{id}`, `POST /resources/{id}/restore`                              | `resources.delete` / `.restore`               | `200`, `{ resource, replayed }`           |
| `GET/POST /resource-pools`, `GET/PATCH/DELETE /resource-pools/{id}`, `POST …/restore` | the `resources.*` permissions                 | the same shapes, `{ pool, replayed }`     |
| `GET/POST /offerings`, `GET/PATCH/DELETE /offerings/{id}`, `POST …/restore`           | `offerings.read/create/update/delete/restore` | the same shapes, `{ offering, replayed }` |
| `GET /policy`                                                                         | `policy.read`                                 | `{ policy, effective, updatedAt }`        |
| `PUT /policy`                                                                         | `policy.configure` (high-risk)                | `200`, the policy now in force            |

**Every write** takes `Idempotency-Key` and uses the same `runIdempotent` path as the reservation and block routes (§3.0.1): a retry after the commit returns the **stored response** (a retried create is the same `201` and body, never `CODE_TAKEN` about its own row), concurrent requests with one key make one row, a refusal is a returned value that is never stored and wrote nothing, and a reused key with another request is `409 IDEMPOTENCY_CONFLICT`. Each runs under a savepoint, so a database refusal halfway through (a unit that is not this resource's) rolls the whole request back. Delete and restore are also **state replays**: repeating one is `200` with `replayed: true`, writing and auditing nothing. Bodies are strict (an unknown key is `400`); nothing in them is a price, a payment state, a product id or a customer name (§10.2).

**Resources and units.** `POST /resources` creates the resource and its `capacity` units (ordinals 1 to `capacity`, labelled from the optional `unitLabels`) in one transaction. A stay resource sends `stayCheckInTime` and `stayCheckOutTime`, a slot resource neither; `timezone` is an IANA name. `PATCH` edits `name`, `kind`, `status`, `sortOrder`, `timezone`, `bookingMode`, the stay times, **`poolId` (the pool membership: a pool id, or `null` to leave)**, `capacity` and `units`. `code` is fixed. Capacity **grows only**: new units are appended (a resource-wide block covers them, §4, `sql/240`) and it never shrinks (`409 CAPACITY_REDUCTION_NOT_ALLOWED`), because a unit is the anchor of the exclusion constraints and `awcms_app` is denied `DELETE` on it; a unit is relabelled or deactivated through `units: [{ id, label?, status? }]`. A `PATCH` to `bookingMode: "slot"` clears the stay times unless they are sent.

**The database guards reach the caller as named refusals, not 500s:** `409 BOOKING_MODE_IN_USE` (the mode cannot change while the resource has a live allocation or an active block), `409 TIMEZONE_IN_USE` (same, for the zone), `409 SCHEDULE_TIMEZONE_MISMATCH` (an active schedule is written in the current zone; deactivate it first), `409 CODE_TAKEN` (codes are unique per tenant, case-insensitively), `400 TIMEZONE_INVALID`, `422 CONSTRAINT_VIOLATED` (a CHECK the validator did not state), `404 UNIT_NOT_FOUND`, `404 POOL_NOT_FOUND` (an unknown or deleted pool), `409 GUARD_REFUSED` (any other database guard, `55000`, not named above), `409 POOL_DELETED` (restoring a resource whose pool is deleted: restore the pool first or move the resource; the membership is never cleared silently).

**Deactivating is not deleting, and refuses nothing.** Setting a unit or a resource `inactive` stops NEW allocation (the allocator skips inactive units; availability stops offering them), but allocations already live stay: there is no `UNIT_IN_USE` refusal, because a booking a customer holds is a fact and cancelling it is a reservation decision (`reservations.cancel`), not a side effect of configuration. Tested: a live stay survives both deactivations.

**A pool read lists at most 500 live members** (`members`); `memberCount` is the full count of live members, so a pool larger than 500 shows the first 500 by `sortOrder`.

**Delete is soft, and refused while the resource is in use.** `DELETE /resources/{id}` is `409 RESOURCE_IN_USE` while a held, confirmed or checked-in reservation or an active block needs it (a completed one does not, and neither does a hold past its expiry on the database clock, which is about to be reclaimed): stop selling with `status: "inactive"` instead. A pool with a live member is `409 POOL_NOT_EMPTY`. A deleted row cannot be edited (`409 RESOURCE_DELETED`, `POOL_DELETED`, `OFFERING_DELETED`). Editing or deleting an offering changes **future** bookings only: an item keeps its snapshot. Soft-deleted rows follow the ADR-0128 rule of §6: `?includeDeleted=true` or `?onlyDeleted=true` on a list is refused (`403`) without the area's `.restore` as well, and `GET /…/{id}` of a deleted row is the neutral `404` for a caller without it.

**Offerings.** `code` and `granularity` are fixed. A `time` offering needs `durationSeconds` and `slotStepSeconds` (at least 300) and may set buffers; a `stay` offering needs `minNights` and `maxNights` (at most 366); `maxParty` is at least `minParty`. The merged row is validated against the shape CHECK of `sql/186`, so a `PATCH` cannot leave a stay offering with a duration.

**Policy.** `GET /policy` returns `policy` (what the tenant set, `null` where it did not) and `effective` (what is in force). `null` is the **module default, not "unlimited"** (§13: 5 live holds per customer, 500 per tenant, 15-minute hold, 15-minute no-show grace, no lead time, 365-day horizon). `PUT /policy` **replaces** the row: every field must be sent (a missing key is `400`, so a partial client cannot wipe the caps by omission); ranges are the CHECKs of `sql/180` plus sanity bounds (hold 60 to 86400 seconds with the default at most the maximum, caps at least 1, horizon 1 to 3650 days, no-show grace 0 to 30 days). It changes **future** holds and searches only. It is high-risk (`configure` is a high-risk action: it bounds how much inventory one actor can hold), so the audit row is **`critical`** (`booking.policy.configured`, before and after values; numbers, a zone name and local times, no personal data). **No MFA step-up:** [ADR-0141](../adr/0141-permissions-may-require-an-enrolled-mfa-factor.md) §6 flags payroll permissions only and says flagging a routine permission is a lockout the tenant did not choose; a tenant that wants it can add a SoD rule over the high-risk action. `defaultTimezone`, `defaultCheckInTime` and `defaultCheckOutTime` are stored for a screen to offer when creating a stay resource; the server does not apply them.

Audit: resource, pool and offering creation and update are `info`, soft delete is `warning`, restore is `info`; attributes are ids, codes and the names of changed fields, never a unit label. **No domain event** (configuration, like blocks; §3.0.1).

### 3.0.3 The admin screens (Issue #942)

Six screens under `/admin/booking/`, each a `navigation` entry of the module (so `booking` is `active`, not `experimental`: ADR-0021 criterion 1). They call only the routes of §3, §3.0.1 and §3.0.2; **a screen holds no business rule**, it maps a form to a body and a refusal to a sentence.

| Screen                        | Entry permission    | Drives                                                                                                                                                        |
| ----------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/admin/booking/reservations` | `reservations.read` | the list (status filter, keyset), the hold and its expiry; `?id=` is one reservation with items, history and confirm / cancel / check in / complete / no-show |
| `/admin/booking/resources`    | `resources.read`    | resources with their units (edit view lists the units), and resource pools (create, rename, delete, restore)                                                  |
| `/admin/booking/offerings`    | `offerings.read`    | offerings: create, edit, delete, restore                                                                                                                      |
| `/admin/booking/schedules`    | `schedules.read`    | weekly opening hours (add, end on a date, deactivate), closures and special hours (add, remove)                                                               |
| `/admin/booking/blocks`       | `blocks.read`       | blocked nights: block, release                                                                                                                                |
| `/admin/booking/policy`       | `policy.read`       | the tenant policy: one form, `PUT` replacing the whole row                                                                                                    |

How they are built, each a decision rather than an accident:

- **The read is the route's own function.** Each screen reads through `loadAdminScreen` with the same application function its JSON route calls (`listOfferings`, `getResource`, `listReservations`, `getPolicy`, ...), so the entry decision (`authorizeInTransaction`, ABAC, the decision log) and the read share one transaction. Controls are gated by `can()` on the permission the endpoint enforces; every gate is UX-only and the endpoint is the authority. A tenant that lacks the read permission gets the `*-denied` notice, a refusal by the pool or circuit breaker is `*-error`, never "no rows".
- **Every mutation carries an `Idempotency-Key`.** One shared sender (`src/lib/ui/booking-admin-client.ts`, `bookingMutate`) draws it from the repo's `createIdempotencyKeySource` (the one inventory, tax and procurement use), keyed on method + url + body: pressing the SAME request again after a lost response replays the stored response instead of repeating it, and an edited request draws a new key. A double click is stopped by locking the control. The memory is per page load, so after a manual reload a create-style route answers `CODE_TAKEN` or `BLOCK_CONFLICT` truthfully (the first attempt did succeed); delete, restore, release and the reservation transitions also replay by STATE (§3.0.1, §3.0.2). The shared source falls back to `getRandomValues` where `crypto.randomUUID` is absent (the offline-LAN profile serves plain http). A contract test (`tests/admin-booking-page-contract.test.ts`) fails if a screen sends a mutation any other way.
- **Refusals are sentences in the reader's language.** The page renders its translated messages as JSON in a `data-msgs` attribute, keyed by the API's error code (`CODE_TAKEN`, `BOOKING_MODE_IN_USE`, `BLOCK_CONFLICT`, ...); the script picks the sentence of the code and never prints server text. No English literal lives in a script. The catalogues are `locales/en.po` and `locales/id.po`.
- **No browser dialog.** Delete, cancel, no-show, release and deactivate go through the native `<dialog>` of ADR-0125 (`confirmAction`), operated by keyboard like every other control; there are no pointer-only controls. A table is a scrollable, focusable region with a caption, stacked below tablet width; the sweeps cover 360 px and axe in both themes (`responsive-360.e2e.ts`, `a11y-axe.e2e.ts`), and `tests/e2e/admin-booking.e2e.ts` drives each action by keyboard.
- **The reservation detail is a view of the list page (`?id=`), not a dynamic route.** A dynamic admin route must be reachable from a link on its parent, and a fresh tenant has no reservation to link; as a view it can never be an orphan. It shows items, the hold's expiry (a hold past it that the sweep has not released is marked **Overdue**, judged on the DATABASE clock, `hold_expires_at <= clock_timestamp()`, as `booking-hold-expiry.ts` does) and the append-only history as a timeline of the closed event kinds. It never shows the customer reference or the note (`reservation_notes.read` is its own audited read).
- **Units of time are minutes on screen** (durations, buffers, notice, hold length, no-show grace), and the conversion NEVER rewrites what the operator did not touch (`src/lib/booking-admin-format.ts`). The API takes any whole number of seconds, so `Math.round(seconds / 60)` shown and `minutes * 60` sent back would turn 90 s into 120 s, a 330 s slot step into 360 s (changing availability), make a 20 s duration unsavable, and rewrite the policy under a `critical` audit row on an unrelated edit. Each control therefore carries the displayed text (`data-initial`) and the API value it came from (`data-original`): an unedited control sends the original, an edited one is converted; a `PATCH` sends only the changed fields and a `PUT /policy` sends every field, unedited ones byte-identical. A value that is not a whole minute shows as decimal minutes with its exact seconds beside it. An offering holds no price (§10.2). Times are shown in UTC and labelled so.
- **No silent cap.** A list is a keyset page with a Next link (reservations, blocks, resources, offerings, and the schedules and closures tables each page on their own cursor). The lookups a screen needs to show a name or fill a picker (resources, pools, the units of stay resources, deleted rows) read every page up to a bound of 50 pages, in one batch for the units, so the 101st resource still has its name and can still be picked. The policy form's hint beside a blank field is the MODULE default, not the value in force once the tenant has set one.
- **Not on any screen, on purpose:** creating, rescheduling and overriding a reservation (the storefront and cashier do that; a picker UI is the follow-up of the epic), the availability search, the customer note, reports and the reconciliation. Those permissions stay on the admin-screen coverage ledger (`scripts/admin-screen-coverage-ledger.ts`, seven keys), which now lists only them.

### 3.1 Stays on the state machine

The states, transitions, permissions, idempotency and audit levels above are **unchanged** for a stay item; no state and no event is added. A reservation may hold stay items and slot items together (a room plus a treatment); they are claimed all-or-none, each under its own constraint. What each step means for a stay:

| Transition                      | For a stay                                                                                                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| (create) → held / confirmed     | claims one unit for every night under the stay exclusion constraint (§4); holds occupy nights exactly as they occupy slots (§5.1), and lazy reclaim applies to the target unit's stay rows |
| held → expired                  | releases the nights                                                                                                                                                                        |
| held / confirmed → cancelled    | releases the nights; the late-cancellation cutoff is measured against the arrival instant `starts_at`                                                                                      |
| confirmed → rescheduled (+ new) | new dates (possibly another unit) as a new reservation; the old nights are released first, so moving or extending over one's own nights does not conflict with itself (§5.3, T5a)          |
| confirmed → checked_in          | guest arrival (`reservations.check_in`); refused before `check_in_date` in the resource's zone, with no time-of-day check (an early arrival is a front-desk decision)                      |
| checked_in → completed          | guest departure, "check-out" in the UI (`reservations.complete`); the booked nights are **not** shrunk by an early departure, as for slots — releasing unused nights is open (§11)         |
| confirmed → no_show             | measured from the arrival instant plus the grace; every night stays consumed. Whether the grace is per offering is the already-open question, made concrete by stays (§11)                 |

**Events.** The nine provisional names of §7.4 are unchanged. A reservation with stay items adds, to the payload of every event, an additive `stays` array (`resourceId`, `checkInDate`, `checkOutDate`, `nights`, `timezone`); `startsAt` / `endsAt` are the earliest arrival and latest departure instants. Nothing new is emitted for blocks in v1 (audit rows only; channel-manager events are open, §11).

## 4. ERD and data dictionary

```
(no link to awcms_profiles in v1: the customer is the opaque external_customer_ref, commerce is the authority - O12)
resource_pools 1──0..n resources 1──1..n resource_units
resources 1──0..n resource_blocks 1──1..n resource_allocations   (a block claims units like an item; stays only)
service_offerings 1──0..n service_requirements ──> (resource_pools | resources)
resources 0..n──0..n schedules (resource_id NULL = tenant default) 1──0..n schedule_exceptions
reservations 1──1..n reservation_items 1──1..n resource_allocations ──> resource_units
                                       1──0..n staff_assignments
reservations 1──1..n reservation_events (append-only)
reservations ──superseded_by / rescheduled_from──> reservations (lineage_id)
tenant_booking_settings (one row per tenant)
```

All tables are `awcms_booking_<name>` and carry `tenant_id uuid NOT NULL`, with
RLS `ENABLE`+`FORCE`. Every reference is a composite `(tenant_id, id)` foreign
key. Money does not exist in this module; quantities are integers (seconds,
units, party size). Column lists below are the **design contract**; types are
final, names may be adjusted by the migration review.

| Table                  | Holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `awcms_app` privileges                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `settings`             | `default_hold_seconds`, `max_hold_seconds`, `max_active_holds_per_customer`, `max_active_holds_per_tenant`, `min_lead_seconds`, `max_horizon_days`, `no_show_grace_seconds`, `default_timezone`, `default_check_in_time`, `default_check_out_time` (local times for stay resources, §2.5); `NULL` = module default                                                                                                                                                                                                                                                                                                                                                                                                                                                      | SELECT, INSERT, UPDATE                                      |
| `resources`            | `code` (unique per tenant, case-insensitively, **soft-deleted rows included**: a deleted resource keeps its code, and restoring never collides), `name`, `kind` (short code, e.g. `room`, `chair`, `court`, `vehicle`), `status` (`active`/`inactive`), `capacity int 1..500`, `pool_id` (nullable), `timezone` (IANA; immutable while live stay allocations exist), `booking_mode` (`slot` default / `stay`; immutable while the resource has live allocations, trigger), `stay_check_in_time` / `stay_check_out_time` (local `time` in `timezone`; required when `stay`, NULL when `slot`), `sort_order`, soft-delete stamps                                                                                                                                          | SELECT, INSERT, UPDATE (no DELETE)                          |
| `resource_units`       | `resource_id`, `ordinal 1..capacity`, `label`, `status` (`active`/`inactive`); exactly `capacity` rows, created with the resource; the **anchor of the exclusion constraint** (unique `(resource_id, ordinal)`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | SELECT, INSERT, UPDATE (no DELETE)                          |
| `resource_pools`       | `code`, `name`, `allocation_policy` (`first_free` by `sort_order, ordinal`; v1 has only this one), soft-delete stamps. A pool is a set of interchangeable resources (three treatment rooms)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | SELECT, INSERT, UPDATE (no DELETE)                          |
| `service_offerings`    | `code`, `name`, `duration_seconds`, `setup_seconds`, `cleanup_seconds`, `slot_step_seconds` (these four are NULL for a stay offering), `granularity` (`time` / `stay`; must equal the `booking_mode` of every resource it requires), `min_nights` / `max_nights` (stay only, NULL for a time offering; CHECK both ways), `min_party`, `max_party`, `confirmation_mode` (`immediate`/`hold_then_confirm`), `cancellation_cutoff_seconds`, `min_lead_seconds`/`max_horizon_days` overrides, `status`, soft-delete stamps. **No price, no product id**                                                                                                                                                                                                                     | SELECT, INSERT, UPDATE (no DELETE)                          |
| `service_requirements` | `offering_id`, `pool_id` xor `resource_id` (CHECK), `unit_count ≥ 1` (per party member or per booking: `unit_basis`), `staff_required bool`, `staff_role` (short code)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | SELECT, INSERT, UPDATE, DELETE (config; no history value)   |
| `schedules`            | `resource_id` (NULL = tenant default), `timezone`, `effective_from`/`effective_to` (local dates, half-open), `rules` jsonb (closed schema: weekday → list of local `[from,to)` windows, plus the §2.4 recurrence), `status`. A new effective window **supersedes** rather than edits (an overlap trigger like ADR-0127)                                                                                                                                                                                                                                                                                                                                                                                                                                                 | SELECT, INSERT, UPDATE (no DELETE)                          |
| `schedule_exceptions`  | `schedule_id` or `resource_id`, `local_from`/`local_to` (dates, half-open, in the schedule's zone), `kind` (`closed`/`override_hours`), `windows` jsonb for `override_hours`, `reason_code` (short code, no free text); for a `stay` resource only `closed` applies, as a soft closure (§2.5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | SELECT, INSERT, UPDATE, DELETE (config)                     |
| `reservations`         | `reservation_no` (server-generated random code, unique per tenant), `lineage_id`, `rescheduled_from_id`, `superseded_by_id`, `series_id`, `status`, `external_customer_ref` (opaque, nullable; the customer authority is commerce - O12 answered 2026-10-10, so no `customer_profile_id` and no `profile_identity` link in v1), `party_size`, `starts_at`/`ends_at` (envelope of its items), `hold_expires_at`, `source`, `external_ref_type`/`external_ref` (one opaque pair), `customer_note` (**redacted**, ≤ 500 chars), `late_cancellation`, `cancel_reason_code`, actor and stamp columns per transition                                                                                                                                                          | SELECT, INSERT, UPDATE (**no DELETE**)                      |
| `reservation_items`    | `reservation_id`, `line_no`, `offering_id`, offering snapshot (`code`, `name`, `duration_seconds`, `setup_seconds`, `cleanup_seconds`), `granularity` (`time` / `stay`), `starts_at`, `ends_at` (instants; for a stay the derived arrival and departure), `check_in_date` / `check_out_date` / `nights`, `check_in_local_time` / `check_out_local_time` / `timezone` (the stay snapshot, §2.5; all NULL for a time item, all set for a stay, CHECK), `quantity` (units asked). Immutable after insert                                                                                                                                                                                                                                                                   | SELECT, INSERT (**no UPDATE/DELETE**)                       |
| `resource_allocations` | `item_id` (NULL for a block row), `block_id` (NULL for a reservation row; CHECK exactly one of the two), `granularity` (`time` / `stay`; a trigger requires it to equal the resource's `booking_mode`), `resource_unit_id`, `resource_id`, `starts_at`, `ends_at` (instants; NULL for a block row), `occupied_from`, `occupied_to` (time rows: CHECK `occupied_from ≤ starts_at < ends_at ≤ occupied_to`, and a trigger verifies the buffer equals the item snapshot; NULL for stay rows), `stay_from`, `stay_to` (dates; stay rows only, equal to the item's or block's dates by trigger, CHECK `stay_from < stay_to`; NULL for time rows), `released_at`, `released_reason` (`cancelled`/`expired`/`rescheduled`/`block_released`), **the two exclusion constraints** | SELECT, INSERT, UPDATE of `released_*` only, once (trigger) |
| `resource_blocks`      | `resource_id`, `resource_unit_id` (NULL = every unit of the resource), `block_from` / `block_to` (local dates, half-open, in the resource's zone; ≤ 366 nights), `reason_code` (closed short-code list, for example `maintenance`, `owner_use`, `other`; no free text), `status` (`active` / `released`), actor and stamp columns. Creating one inserts one allocation row per affected unit (§8.1 rule 7); releasing it stamps `released_*` on those rows. Stay resources only                                                                                                                                                                                                                                                                                         | SELECT, INSERT, UPDATE of `released_*` only, once (trigger) |
| `staff_assignments`    | `item_id`, `staff_ref` (opaque text ≤ 128, resolved only by the workforce port), `staff_role`, `occupied_from`/`occupied_to`, `released_at`/`released_reason`, **the same exclusion constraint keyed on `staff_ref`**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | SELECT, INSERT, UPDATE of `released_*` only, once (trigger) |
| `reservation_events`   | `reservation_id`, `seq` (per reservation), `kind`, `from_status`, `to_status`, `actor_user_id`, `correlation_id`, `reason_code`, `detail` jsonb (closed keys: ids, instants, counts — **no free text, no personal data**), `occurred_at` (DB clock); unique `(reservation_id, kind)` for the once-only kinds; the `projection_kind` generated column and four integer quantities for the projections (`sql/244`, §7.2)                                                                                                                                                                                                                                                                                                                                                  | SELECT, INSERT (**no UPDATE/DELETE**)                       |

`awcms_worker` holds `SELECT` on `awcms_booking_reservation_events` only (the
reporting engine reads the projection source as that role) and **no privilege on
any other booking table**. The hold-expiry job (`booking:holds:expire`) runs as
`awcms_worker` under a per-tenant context and reaches the tables only through
two narrow SECURITY DEFINER functions of `sql/200` (the `sql/142` / ADR-0090
pattern): `awcms_booking_expire_due_holds(tenant, batch)`, which can only expire
an elapsed hold of the session's own tenant, and `awcms_booking_count_due_holds`
for `--dry-run`. `UPDATE` on reservations granted to the worker would also have
let a cron job confirm or cancel a booking; the owner role of the functions
(`awcms_booking_expiry`, NOLOGIN, memberless) holds only the column-scoped
privileges their literals need, and `EXECUTE` is the worker's alone. Lazy
reclaim (§5.1) is not this job: it runs inside the claim's transaction as the
application role.

**The exclusion constraint** (on `resource_allocations`; the staff constraint is
identical on `staff_ref`):

```sql
EXCLUDE USING gist (
  resource_unit_id WITH =,
  tstzrange(occupied_from, occupied_to, '[)') WITH &&
) WHERE (released_at IS NULL)
```

Requires `CREATE EXTENSION IF NOT EXISTS btree_gist` (§8.2). The unit id is
globally unique, so the constraint needs no `tenant_id` term, and a constraint
check is not subject to RLS, so tenant isolation cannot weaken it.

**The stay constraint** (same table; ADR-0135) sits beside the first and tests dates, not instants:

```sql
EXCLUDE USING gist (
  resource_unit_id WITH =,
  daterange(stay_from, stay_to, '[)') WITH &&
) WHERE (released_at IS NULL AND granularity = 'stay')
```

The first constraint is likewise limited to `granularity = 'time'`. Because a trigger forces an allocation's granularity to equal its resource's `booking_mode`, the two constraints partition the unit space and never need reconciling. A `daterange` is discrete, so `[10th, 12th)` and `[12th, 14th)` are adjacent, not overlapping. **Why a range constraint and not a unit-night ledger** (one row per `(unit, night)` under a plain unique index): the range form is the same mechanism as slots (one test shape, one allocator, one `23P01` handling), costs one row and one GiST probe per claim instead of up to 366 rows to insert, release and reschedule, and needs no second invariant to keep rows equal to the item's dates; the ledger's advantage, per-night aggregates, is met by `generate_series` over the stay or the §7.2 counters. Both are declarative and unaffected by RLS; the choice is made on consistency and write cost (ADR-0135 §4).

**Built (`sql/204`, Issue #940).** `block_id`, and a CHECK that exactly one of `item_id` / `block_id` is set; `starts_at` and `ends_at` are nullable and NULL on a block row; `block_released` is a release reason, allowed on block rows only. The allocation insert guard has a block form: the row must equal its block's resource, unit (when named) and dates, and the block must be active; the unit's status is deliberately **not** checked, so a unit put back in service later is still blocked. A block row is released only by releasing its block, and an AFTER UPDATE trigger on the block releases its rows in the same statement, so "block released <=> its nights released" is a database invariant. Two blocks that overlap on one unit conflict like any two live rows on it (release or shorten the first). A resource-wide block (no `resource_unit_id`) covers every unit of the resource, **including units added later** (`sql/240`, Issue #1012, finding N1): an AFTER INSERT trigger on `resource_units` inserts the block row of the new unit for every active resource-wide block on its resource, after taking the resource row `FOR NO KEY UPDATE`; the block service reads the unit list after taking the same row `FOR SHARE`. A unit insert and a block placement therefore serialise on the resource, and under READ COMMITTED the statement after the lock sees the other's commit: whichever commits first, no unit is left uncovered (both orders and a race are tested). The reconciliation (`block_missing_allocation`) stays as the after-the-fact detector for a write that bypassed the trigger. A block and its rows carry **one** release instant (`sql/241`, finding N4): the trigger copies the block's `released_at` onto its rows. The instant bound on `reservations` and `reservation_items` is 368 days (§2.1). A booking_mode change under live allocations or blocks is `BOOKING_MODE_IN_USE` (a timezone change, `TIMEZONE_IN_USE`).

**Data-subject answers (ADR-0094).** `reservations.external_customer_ref` identifies a person (it is opaque; the customer authority is the downstream commerce, O12); `customer_note` may contain one; actors are tenant users. On erasure or anonymisation of the customer at the authority the module severs `external_customer_ref` and nulls `customer_note`,
and keeps the non-personal facts (resource, interval, status) as the tenant's
operational record. `reservation_events.detail` carries no personal data by
construction. Items, allocations and staff assignments carry no customer data
(`staff_ref` is a workforce reference, governed by that capability).

## 5. Holds, idempotency and reschedule

### 5.1 Holds

- A hold is a reservation in `held` with `hold_expires_at = clock_timestamp() +
ttl`, where `ttl` = the request's `holdSeconds` clamped to
  `[60, max_hold_seconds]` (default 900, max 86 400). The **database clock** is
  the only clock: `now()` is the transaction start and a client clock is
  attacker-controlled.
- A hold **occupies**: its allocations are live rows under the constraint.
  Whether a hold counts toward _occupancy_ (a KPI) is a separate question (O8, answered 2026-10-10: it does not, §7.2);
  whether it blocks _availability_ is not — it does.
- `POST …/extend` extends once per hold, by at most `default_hold_seconds`, never
  beyond `max_hold_seconds` from creation; it requires `reservations.create`.
  **Not built by Issue #941** (it was not in that issue's list): when it is, it
  creates no hold but must still take the cap lock of §13 before it counts.
- **Hold caps default to 5 live holds per customer and 500 per tenant**
  (Issue #941; `NULL` in the settings is the module default, not unlimited). A
  hold with no customer reference is bounded by the tenant cap only, and an
  `immediate` confirmation is not a hold. The numbers and their trade-off are in
  §13.
- **Expiry has two cooperating parts**, because an exclusion constraint cannot
  read a clock: (1) the job `booking:holds:expire` (every minute, per tenant,
  `FOR UPDATE SKIP LOCKED`, bounded batch) sets `expired`, releases allocations
  and emits `expired`; (2) **lazy reclaim**: every write that inserts allocations
  first releases any expired-but-unswept hold on the target units, under the
  reservation row lock, in the same transaction. Correctness therefore does not
  depend on the job's health.
- `confirm` re-checks `hold_expires_at > clock_timestamp()` under `FOR UPDATE`;
  an expired hold is `409 HOLD_EXPIRED` even when the job has not run; a confirm
  racing the job serialises on the row lock and one wins, the other takes the
  replay or the refusal path.

### 5.2 Idempotency (three layers, as ADR-0128 §5)

1. **`Idempotency-Key`** (the shared component, ADR-0129) is required on create,
   extend, confirm, cancel, reschedule, check-in, complete, no-show and override.
   The acting user is part of the request hash; the same key against a different
   target is `409 IDEMPOTENCY_CONFLICT`.
2. **State check.** Confirming a `confirmed` reservation returns it with
   `replayed: true` and writes nothing; so do the other verbs on their target
   state, with the same key, a different key, or none.
3. **The constraint.** Even if both layers above were bypassed, a second claim
   for the same unit and interval cannot commit. A natural-key backstop
   `(tenant, external_ref_type, external_ref)` partial-unique among live
   reservations lets an adapter retry with a fresh key without duplicating.

A refusal produced inside the application (a ledger-style _returned_ 409) is
converted to a throw inside a savepoint and back to a value outside it: a handler
that returns a 4xx would otherwise COMMIT whatever it had already written (the
same trap as ADR-0128 §5).

### 5.3 Reschedule preserves history

One transaction: lock the old reservation `FOR UPDATE` and re-check it is
`confirmed`; **release the old allocations** (`released_reason = rescheduled`);
insert the new reservation (same `lineage_id`, `rescheduled_from_id`), items and
allocations under the constraint (so a move to an overlapping time does not
conflict with itself); mark the old `rescheduled` with `superseded_by_id`;
append events on both. A refusal (conflict, hours, lead time) rolls the whole
transaction back to the untouched original. Intervals are never edited in place.
The adapter's `external_ref` moves to the new reservation; the lineage is the
stable handle for "this customer's booking" across reschedules.

**Built in Issue #941.** The old reservation is superseded BEFORE the replacement
exists (its allocations released, then `rescheduled` naming the replacement's
pre-generated id), so it has left the live set of the `external_ref` unique index
when the replacement carries the same reference; `sql/208` therefore makes the
`superseded_by_id` foreign key `DEFERRABLE INITIALLY DEFERRED` (still enforced at
commit). The replacement is born `confirmed` whatever the offering says, with the
old customer reference, party, source, note and external reference, and announces
itself with `created` and `confirmed` (naming `rescheduledFromId`); the old one
announces `rescheduled` (naming `supersededById`). Repeating the same reschedule
against an already-rescheduled reservation is a replay; a different move is
`INVALID_STATE`. Only a reservation with one item moves (v1 claims one item per
reservation).

## 6. Permissions and RLS matrix

All routes are `defineTenantRoute`, authorize through `authorizeInTransaction`
(ADR-0063), and are default-deny. The migration seeds the catalogue and grants
**nothing** to any role; existing tenants use
`bun run identity-access:permissions:backfill`. Permission codes are
`booking.<activity>.<action>` (module key `booking`, as `procurement.documents.read`).

| Permission                                                         | Covers                                                                | Risk                  |
| ------------------------------------------------------------------ | --------------------------------------------------------------------- | --------------------- |
| `resources.read` / `.create` / `.update` / `.delete` / `.restore`  | resources, units, pools and pool membership (§3.0.2)                  |                       |
| `offerings.read` / `.create` / `.update` / `.delete` / `.restore`  | offerings and requirements                                            |                       |
| `schedules.read` / `.create` / `.update` / `.delete`               | schedules and exceptions                                              |                       |
| `blocks.read` / `.create` / `.release`                             | blocked nights (stay resources); `.create` removes sellable inventory | `.create` high-impact |
| `availability.read`                                                | availability search, quote (no persistence)                           | rate-limited          |
| `reservations.read`                                                | list, detail, events (note excluded)                                  |                       |
| `reservation_notes.read`                                           | the redacted `customer_note`                                          | audited read          |
| `reservations.create` / `.confirm` / `.cancel`                     | hold/create, confirm, cancel                                          |                       |
| `reservations.reschedule` / `.check_in` / `.complete` / `.no_show` | the other transitions (new `AccessAction` members)                    |                       |
| `reservations.override`                                            | book or reschedule outside schedule hours or lead time                | **high** (new)        |
| `reservations.reconcile`                                           | read-only reconciliation                                              |                       |
| `policy.read` / `policy.configure`                                 | settings (holds, lead time, horizon, grace); `PUT` audited `critical` | high-impact           |
| `reports.read`                                                     | occupancy / utilization / reservation reports                         |                       |

New `AccessAction` members: `confirm`, `reschedule`, `check_in`, `complete`,
`no_show` (none high-risk: each is reversible by cancel or compensated by an
event) and the HIGH-RISK `override` (it lifts a business rule; the
action-time SoD check becomes available for it). `cancel` and `restore` are
reused. Each high-risk guard is tested both ways: every other permission cannot
do it, only that one can. A soft-deleted resource or offering is listed only with
`includeDeleted=true` **and** `.restore` (the ADR-0128 rule).

**Row-level security.** Every table: `tenant_id`, `ENABLE`+`FORCE`, a policy with
`USING` and `WITH CHECK`; verified as the runtime role (`awcms_app`), including
that it cannot read or write another tenant's rows and that a composite-FK to
another tenant's resource or profile is unrepresentable. Past events, items,
allocations (other than `released_*`) and events are immutable by trigger **and**
by absent privileges.

**Scoped access.** v1 has no location- or resource-scoped ABAC: a holder of
`reservations.cancel` can cancel any reservation of the tenant. A business-scope
dimension for "this branch's resources" is the same follow-up as ADR-0128 L5 and
is a recorded limit, not a hidden one. Separating `create` from `confirm` or
`override` is an operator duty expressed as a SoD rule over the high-risk
actions.

## 7. Reconciliation, reporting and events

### 7.1 Reconciliation

`GET /booking/reservations/reconciliation` (read-only, tenant-scoped,
`reservations.reconcile`) proves, per live reservation, that its allocations are
exactly its items' units and intervals; lists a live allocation whose
reservation is terminal or released, a `held` reservation past its expiry beyond
a grace (a stuck job), an allocation with a mismatching buffer, a reservation
whose `lineage_id` chain is broken, and a reservation with no `created` event. For stays it also lists a live stay allocation whose `[stay_from, stay_to)` differs from its item's `[check_in_date, check_out_date)`, a live block row whose block is released (`block_allocation_orphan`), an active block that does not own exactly one live row per unit it covers (`block_missing_allocation`, which a unit added to the resource afterwards also trips), a block row whose resource, unit or dates differ from its block's (`block_allocation_mismatch`), and an allocation whose granularity differs from its resource's `booking_mode`.
It repairs nothing; a defect is corrected by a compensating transition, never an
edit.

### 7.2 Occupancy and utilization projections (reporting engine, owned here)

Projections ride the existing `reporting` engine as **monotonic counters** over
the append-only events table (the engine clamps a decrement at zero, so every
metric is a counter that only increases, as in ADR-0126/0128):

| Projection             | Counters                                                                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `booking.reservations` | created, held, confirmed, cancelled, late_cancelled, rescheduled, expired, checked_in, completed, no_show                                 |
| `booking.time`         | `booked_seconds` (+ on confirmed / on a replacement), `released_seconds` (+ on cancel / reschedule-away of a confirmed reservation)       |
| `booking.nights`       | `booked_nights` (+ on confirmed / on a replacement of a stay item), `released_nights` (+ on cancel / reschedule-away of a confirmed stay) |

Net booked time is `booked − released`, computed at read, so a rebuild reproduces
the same figures; net booked **nights** are computed the same way from `booking.nights`. Blocked unit-nights are read live from `resource_blocks`: they are an input to whichever denominator the owner chooses (open under O8), not a counter. **Utilization** = net booked seconds ÷ _available_ seconds,
where available seconds are a pure function of the schedule expansion (§2), not
an event, so the denominator is computed live by `GET /booking/reports/utilization`.
**Occupancy** (units in use ÷ units) is a live query: per unit-night for a stay, `GET /booking/reports/occupancy`.
**Owner decision O8 (answered 2026-10-10, recorded in the awcms-one DoR) fixes
three things that bind this pack:** (1) **occupancy excludes holds** — only units
under a `confirmed` or `checked_in` allocation count as occupied, and a hold is
reported as a separate _pipeline_ figure (the `held` counter and a live
held-units query), never added to occupancy; utilization stays a separate metric
from occupancy; (2) the **customer-retention window is 90 days** (a repeat
purchase or booking within 90 days of the first) — a cross-domain analytics KPI
over commerce orders and booking reservations joined on `external_customer_ref`,
computed by the consumer's analytics, **not** inside booking and **not** a
data-retention period (reservation retention is unchanged, §9); (3) **net
revenue is the revenue headline** (gross, then discounts, then refunds, then
net) — booking holds no price (§1), so revenue is computed by the commerce and
analytics layer and booking supplies only the facts (the events and counters
above). **Not covered by the recorded answer and still open:** whether the
utilization denominator excludes maintenance closures, and booked versus actual
(`checked_in`→`completed`) time; the counters above remain the inputs of every
candidate definition. The
detail (which resource, which day) is the live, re-authorized report; the
projection is the dashboard figure only.

#### 7.2.1 Built (Issue #944)

**Projections.** `BOOKING_REPORTING_PROJECTIONS` (`domain/booking-reporting.ts`) hands the three projections of the table above to the existing `reporting` engine through `ModuleDescriptor.reportingProjections` (read `booking.reports.read`). There is no second analytics engine: the same incremental worker (`reporting:projections:refresh`), the same bounded rebuild and the same reconciliation run them. Each reads the append-only `awcms_booking_reservation_events` table on `created_at`.

**Source choice (trade-off).** The table, not the nine live domain events, is the source.

| For the table                                                                                                                                                       | Against                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| A rebuild is always a table re-scan, so the steady state and the rebuild are the SAME scan and cannot disagree; an event consumer needs a rebuild-deferral protocol | Polled, not pushed: current within the freshness policy (5 minutes), not instantly |
| The table is genuinely append-only (trigger + REVOKE), the one precondition `cursor_table` needs                                                                    | Needed one migration (`sql/244`) to put the quantities on the row                  |
| Written in the transition's own transaction; an event is visible only after the outbox dispatcher ran, so a stopped dispatcher would stall the dashboard            |                                                                                    |

**Quantities (`sql/244`).** A count of rows cannot answer "how many unit-nights". Four non-negative bigint columns on the event row (`booked_seconds`, `released_seconds`, `booked_nights`, `released_nights`) are filled by a BEFORE INSERT trigger from the reservation's own allocation rows: a `confirmed` event BOOKS, a `cancelled` / `rescheduled` event whose `from_status` is `confirmed` RELEASES, nothing else carries a quantity (a hold that expires was never booked; a `no_show` keeps its booking until booked-versus-actual is decided). Seconds are the SERVICE interval, never the setup/cleanup buffer. Nights are `stay_to - stay_from` per allocation, and an allocation is one unit: a two-night stay on one unit is two unit-nights, the same stay on three units is six. `projection_kind` is a stored generated column: `kind`, except a cancellation judged late reads `late_cancelled`, so `late_cancelled` is a subset of `cancelled` by construction. The engine gained one optional rule field, `sumColumn` (add up a column instead of counting rows; `MODULE_CONTRACT_VERSION` 4.5.0); the incremental worker, the rebuild and the reconciliation all use it.

**Page boundary.** A transaction's history rows share `created_at = now()`, and the engine resumes at `cursor + 1 ms`, so a page that ended between the `created` and `held` rows of one reservation lost the second. The engine now never ends a page inside a millisecond: it reads one lookahead row and, when that row shares the page's last millisecond, drops that millisecond from the page (`trimIncompleteTail`, `reporting/domain/cursor-boundary.ts`). A test fails without it.

**Reports (live, windowed, re-authorized).** `GET /booking/reports/occupancy`, `/utilization` and `/reservations`, each `from` / `to` (local dates, half-open, at most 92 days) and an optional `resourceId`, gated by `booking.reports.read`, never cached. The rules (`domain/booking-report.ts`):

- **Day windows are Asia/Jakarta**, `[00:00, next 00:00)`, derived through the zone rules (24 h each: Jakarta has no daylight saving).
- **Occupancy** is per unit-night of STAY resources: a night is occupied by a `confirmed`, `checked_in` or `completed` reservation. A `held` reservation is never occupancy: its live nights are `heldUnitNights`, beside the rate. A `no_show` keeps its allocation but is not occupied. `blockedUnitNights` is reported beside the rate (whether maintenance leaves the denominator is still open under O8). Units are those active now.
- **Utilization** is its own report for SLOT resources: net-booked service seconds clipped to each Jakarta day by the database, over the schedule's open seconds (`expandOpenWindows`, the function availability uses) times the active units, clipped the same way. A closed day has no ratio, not zero.
- **Reservations** report: the hold PIPELINE (placed, converted, expired, cancelled while held in the window; open holds and units now), the LEAD TIME of the reservations confirmed in the window (buckets, mean), and the CANCELLATION / LATE CANCELLATION / NO-SHOW outcomes of that confirmation cohort. A rescheduled reservation is left out of the cohort (its replacement has its own). The no-show denominator is resolved arrivals (`no_show` + `checked_in` + `completed`).
- **Ratios over small groups are withheld.** A ratio or mean over fewer than 5 reservations is `{ suppressed: true, value: null }`. Counts (including the lead-time bucket counts) are the tenant's own operational figures and are not anonymised: the reader already holds `booking.reports.read` on that tenant's data.
- **No revenue.** Booking holds no price; nothing here computes one (revenue follows the commerce ledgers). No customer reference, note, reason or actor is read by a projection or a report.

The live net booked nights and seconds equal the projections' `booked - released` when the window spans every reservation (an integration test pins it).

### 7.3 Schedule-conflict report

`GET /booking/schedules/{id}/conflicts?candidate=…` lists confirmed reservations
that fall outside a proposed schedule (or inside a proposed closure) without
changing anything. The same applies to a staff availability change reported by
the workforce capability.

### 7.4 Events (live since Issue #941)

Convention (as `awcms.procurement.document.finalised`): channel
`awcms.<module>.<entity>.<verb>`, one shared `DomainEvent` envelope, published
through the domain-event outbox **in the same transaction** as the transition; a
refused or replayed call publishes nothing. The issue's shorthand
`booking.reservation.*` therefore appears on the wire with the `awcms.` prefix.
The nine channels are in `asyncapi/awcms-domain-events.asyncapi.yaml`, the types
in `DOMAIN_EVENT_TYPE_REGISTRY` and in the module's `events.publishes`, all
version `1.0`.

| Event                                   | When                                                                             |
| --------------------------------------- | -------------------------------------------------------------------------------- |
| `awcms.booking.reservation.created`     | a reservation exists (held or confirmed)                                         |
| `awcms.booking.reservation.held`        | a hold was placed (not emitted for `immediate` confirmation)                     |
| `awcms.booking.reservation.confirmed`   | held → confirmed (or created confirmed)                                          |
| `awcms.booking.reservation.rescheduled` | the old reservation was superseded; payload names both ids                       |
| `awcms.booking.reservation.cancelled`   | held/confirmed → cancelled (carries `lateCancellation`)                          |
| `awcms.booking.reservation.checked_in`  | confirmed → checked_in                                                           |
| `awcms.booking.reservation.completed`   | checked_in → completed                                                           |
| `awcms.booking.reservation.no_show`     | confirmed → no_show                                                              |
| `awcms.booking.reservation.expired`     | a hold expired (a ninth name beyond the issue list; ADR-0040's adapter needs it) |

**Who publishes what.** A new reservation: `created`, then `held` (a hold) or
`confirmed` (an `immediate` offering). A replacement of a reschedule: the old one
`rescheduled`, the new one `created` then `confirmed`. `expired` is published by
BOTH ways a hold expires: lazy reclaim, in the claim's transaction, and the
`booking:holds:expire` sweep, in its own tenant transaction as `awcms_worker`.
The worker may use the outbox but not read the booking tables, so the sweep's
SECURITY DEFINER function now returns the non-personal facts of what it expired
(`sql/209`); the facts of every event come from the one function
`awcms_booking_reservation_event_facts`, so a request transition, lazy reclaim and
the sweep cannot carry different fields. The cancellation reason code is on the
append-only history row and is **not** in the event.

Payload: `reservationId`, `reservationNo`, `lineageId`, `status`, `previousStatus`,
`startsAt`/`endsAt` (RFC 3339 UTC), `resourceIds`, `offeringIds`, `partySize`,
`externalRefType`/`externalRef` (the adapter's own opaque pair), `occurredAt`,
`correlationId`; `lateCancellation` on `cancelled`, `supersededById` on
`rescheduled`, `rescheduledFromId` on the events of a replacement; for a reservation with stay items also `stays` (`resourceId`, `checkInDate`, `checkOutDate`, `nights`, `timezone`; additive, absent otherwise, no new event, §3.1). **Never** a customer name, contact, note or reason text. Consumers
de-duplicate on the envelope's event id; delivery is at-least-once.

### 7.5 Reminders and confirmations (Issue #943)

Booking owns the **debt** ("a confirmation or reminder is owed for this
reservation"); `whatsapp_delivery` owns the **message** (consent, templating,
provider, queue;
[ADR-0133](../adr/0133-generic-delivery-capability-whatsapp-promotion.md)
sections 3 and 8). There is no booking queue, outbox or provider call.

**Flow.** Nothing on the reservation transaction path changes: confirming or
cancelling a booking writes nothing about reminders, so a slow or broken
delivery capability can never slow or fail a booking. The scheduled job
`booking:reminders:dispatch` (every minute, `awcms_worker`, per tenant) runs one
bounded pass per tenant, in this order:

1. **Stale sweep.** A `pending` intent whose reservation is no longer confirmed
   is settled `cancelled` (or `expired` once the reservation has begun). An
   `enqueued` intent whose reservation was cancelled, expired, rescheduled or
   marked no-show has its still-queued message cancelled through
   `WhatsappDeliveryPort.cancelByCorrelation` (a no-op once the message left the
   queue, as the port promises).
2. **Materialize.** Intents are created for **confirmed** reservations, once per
   `(reservation, kind, occurrence)` (unique key, `ON CONFLICT DO NOTHING`):
   `confirmation` (occurrence 0) for a reservation confirmed in the last 6 hours
   (so switching the feature on never floods the back catalogue), and `reminder`
   (occurrence 1) once the 24-hour lead window opens and before the reservation
   starts. A walk-in (no `external_customer_ref`) and a booking confirmed
   _inside_ the lead window are created already settled `skipped`
   (`no_customer_ref`, `booked_inside_lead`): the confirmation is the notice.
3. **Dispatch.** Each due intent is resolved to a recipient and handed to the
   port; the answer settles it (below).

**Idempotent per (reservation, kind, occurrence), in three layers**: the unique
key of `awcms_booking_reminder_intents` (`sql/284`); an intent leaves `pending`
exactly once and only `pending` intents reach the port (`FOR UPDATE SKIP
LOCKED`); and the delivery module's own `(tenant, idempotency_key)` unique key,
with the key `booking:{reservationId}:{kind}:{occurrence}` (also the correlation
id). A crash between the enqueue and the settle replays as `duplicate` and
settles `enqueued` with the original message id; two workers, or a retried job,
queue one message. (The idempotency keys of
[ADR-0145](../adr/0145-idempotency-keys-are-scoped-per-actor-and-the-request-hash-is-keyed.md)
are per actor and belong to request routes; this job has no actor and no route,
so the natural key above is the mechanism.)

**A cancelled reservation emits none, and nothing is sent late.** The dispatch
read returns a reservation only while it is `confirmed` and holds a share lock on
it for the rest of the transaction (`FOR SHARE ... SKIP LOCKED`): a cancel either
happened before (nothing is queued) or waits until the pass ends. A message
queued by an earlier pass is cancelled by the stale sweep through
`cancelByCorrelation`, which only touches `queued` and `retry_wait` messages. A
message leased in `sending` at that moment cannot be cancelled, and a provider
timeout would send it to `retry_wait` and resend it after backoff. So the sweep
marks an intent reconciled **only when every message under its key is terminal**
(`sent`, `failed`, `cancelled`, `expired`); otherwise the intent is left and
looked at again on the next pass until the message is cancelled or terminal. As
a second layer every message is enqueued with an expiry: the reservation's start
for a reminder, the earlier of the start and the 6-hour freshness window for a
confirmation, so even a delivery outage cannot send either after the booking has
begun. The sweep also revisits enqueued intents whose reservation has already
started. A pending intent whose reservation started or finished (confirmed,
checked in, completed) settles `expired`; one whose reservation was cancelled or
moved settles `cancelled`. The residual window is one job interval (a minute)
between a cancel and the cancellation of a still-queued message.

**Bounded work and lock time.** The sweep and the materialize step handle 100
intents per pass, and the job repeats a tenant's pass until it drains (sweep
work counts as progress), for at most 45 seconds per run, so a mass cancellation
of several hundred reservations is cleared within one run. The dispatch step
holds a share lock on every reservation it reads until the pass commits, and
that lock blocks a customer's cancel or confirm; so it reads at most 25 intents,
stops taking new ones after 5 seconds (the rest stay pending, unlocked at
commit), and runs under `lock_timeout` 2 s and `statement_timeout` 10 s, so a
stuck lock or query aborts the pass instead of holding those locks. A resolver
or enqueue failure is logged as `booking.reminder.dispatch_failed` with the
intent id, error class and code, never the message text or any contact.

**No contact in booking.** The customer is still only the opaque
`external_customer_ref` (commerce is the authority, O12). The deployment supplies
a `BookingReminderRecipientPort` (`_shared/ports/`) that turns the reference into
a `WhatsappRecipient` inside the job's transaction (database reads only, no
network); the contact is used for one `enqueue` and never stored, logged or put in
an event. **No implementation ships here, so the job is inert** (creates and
sends nothing) until a deployment registers one with
`registerBookingReminderRecipients` from its own job entry point. Only two
template variables leave the booking schema: the reservation number and the local
start time (templates `booking.confirmation` and `booking.reminder`, both
`transactional`, English wording).

**Settlement.** `queued`/`duplicate` become `enqueued`; `suppressed` (opt-out,
hard failure) becomes `suppressed`; a verdict refusal (`CONSENT_REQUIRED`,
`TEMPLATE_UNKNOWN`, `RECIPIENT_INVALID`, ...) becomes `refused`; a resolver that
cannot address the customer becomes `skipped` (`recipient_unresolved`).
`DISABLED`, `MISCONFIGURED` and `RATE_LIMITED` are properties of the deployment,
not of the message: the intent stays `pending`, the pass stops for that tenant,
and it is retried next minute (a rate limit is given up after 30 attempts). A
resolver or enqueue that throws costs that intent one attempt (a savepoint per
intent) and does not stop the others. Consent is entirely the delivery module's:
a `transactional` message needs no marketing opt-in and survives a marketing
withdrawal; an opt-out stops it; neither touches the reservation.

**Privileges.** The worker holds no privilege on the reservation tables. It reads
through three narrow `SECURITY DEFINER` functions (`sql/285`, the `sql/200`
pattern, owner `awcms_booking_reminders`, tenant argument must equal the session
tenant, `EXECUTE` to `awcms_worker` alone) and settles intents with `UPDATE` on
`awcms_booking_reminder_intents` only. The runtime role may only read it; no row
is ever deleted (trigger and revoked privilege).

**Operations.** The pass is database-only, so it is safe on the offline/LAN
profile. WhatsApp itself is off unless `WHATSAPP_ENABLED=true`;
`whatsapp:dispatch` registers booking's templates in its own process (it does),
or a queued message fails terminally as `template_unknown`.

## 8. Double-booking prevention and the required regression test

### 8.1 The strategy

1. **Exclusive resource** (capacity 1): one unit row; the exclusion constraint on
   allocations forbids two live overlapping occupied ranges for it. The second
   concurrent INSERT **blocks** on the first's uncommitted row; when the first
   commits, the second fails with `23P01 exclusion_violation`; when the first
   rolls back, the second succeeds. This is PostgreSQL's own behaviour for
   exclusion constraints and needs no application lock.
2. **Capacity N > 1**: N unit rows, **each under the same constraint**. The
   allocator picks units in `(resource.sort_order, unit.ordinal)` order and
   inserts with `INSERT … ON CONFLICT DO NOTHING RETURNING id` (an exclusion
   violation is a conflict `DO NOTHING` absorbs, so no savepoint per attempt);
   no row returned → try the next unit; none left → `SLOT_UNAVAILABLE`. (That `DO NOTHING` waits for an in-doubt concurrent conflicting row and then skips it is the behaviour T3 proves, and Issue #939 observed it: the second INSERT blocks on the first's uncommitted row, and is absorbed when the first commits or takes the unit when it rolls back. A `23P01` that escapes anyway is mapped to `SLOT_UNAVAILABLE`.) A party
   or requirement of _k_ units inserts _k_ rows in one transaction, all-or-none.
   N is capped (500) because _k_ inserts are _k_ probes.
3. **Multi-item and multi-resource reservations** insert in a fixed global order
   (`resource_id` ascending bytewise, then `ordinal`, then `occupied_from`) so
   two writers acquire in the same order. Residual deadlocks (`40P01`) are
   caught (`errno`, not `code`, in Bun.SQL) and retried at most 3 times with
   jitter, then `409 CONTENTION_RETRY`. It never loops unboundedly.
4. **Where capacity is computed** (a per-offering concurrency cap, a pool-wide
   limit, a daily maximum — an aggregate no exclusion constraint expresses):
   take `SELECT … FOR UPDATE` on the owning pool or offering row, in the global
   order, re-read the aggregate under the lock, then write. READ COMMITTED with
   that lock is sufficient; SERIALIZABLE is not used. Any new invariant that is
   a sum rather than a non-overlap **must** use this rule and add its own test of
   the same shape.
5. **Staff** are claimed by the same mechanism on `staff_ref` (§4); the workforce
   availability read (§10.3) is advisory input, the constraint is the authority.
6. **Hold expiry** never weakens this: an unswept expired hold is reclaimed
   lazily under the row lock (§5.1), so the constraint only ever blocks on rows that are genuinely live.
7. **Stays and blocks** (ADR-0135). A stay allocation is one row per unit under the second constraint of §4 (`daterange(stay_from, stay_to, '[)')` per unit, live rows only). The allocator, lock order, `ON CONFLICT DO NOTHING` absorption, lazy reclaim and bounded deadlock retry of rules 1–6 apply unchanged. A **block** is an allocation row with `block_id` set and no `item_id`, so a block and a stay contend on one constraint: whichever commits first wins and the other receives `23P01`, mapped to `SLOT_UNAVAILABLE` for the booking and `BLOCK_CONFLICT` for the block. A block over several units inserts its rows in the global order of rule 3, all-or-none. Creating a block never cancels a reservation. A trigger rejects an allocation whose granularity differs from its resource's `booking_mode`, so the time and stay constraints never both apply to one unit. Two overlapping blocks conflict with each other the same way (they are rows under the same constraint), and a block over several units covers inactive units too, so a unit reactivated later is still blocked. A resource-wide block also covers a unit **added** later (`sql/240`, §4). Lazy reclaim before a block expires only the elapsed holds on the units the block covers: a block of one unit reclaims that unit's holds and leaves another unit's for its own sweep (Issue #1012, finding N3); the audit row says so.

### 8.2 Extension and deployment cost

The constraint needs `btree_gist` (uuid equality in a GiST index). Checked
against this repo: no migration creates `btree_gist` today; `sql/001`
(`pgcrypto`) and `sql/064` (`pg_trgm`) already run `CREATE EXTENSION IF NOT
EXISTS`; all three are **trusted extensions** in PostgreSQL 13+ (a database owner
with `CREATE` on the database can create them without superuser); the deployment
profile pins `postgres:18.4`. Cost: one `CREATE EXTENSION IF NOT EXISTS
btree_gist;` in the booking migration, an operator pre-flight line in the deploy
runbook, and a known failure mode — a managed database whose migration role
cannot create trusted extensions fails the migration before any table exists. The
offline/LAN profile (`postgres:18.4`) is unaffected. ADR-0127 §4 declined the
extension for tax windows; the reason (privilege) does not hold for a trusted
extension, and the stale sentence in `sql/171` is a historical comment in an
applied migration, which is immutable and is left alone. (If a target
deployment genuinely cannot create the extension, the fallback is the ADR-0127
pattern — advisory lock plus checking trigger — with the loss of the
every-writer guarantee stated; that is an operator-level exception to be
recorded, not a default.)

### 8.3 The required regression test (specification)

The module **must not ship without** these, in
`tests/integration/booking-concurrency.integration.test.ts`, run against a real
PostgreSQL as the runtime role `awcms_app` (FORCE RLS in effect), on separate
connections (not one pooled transaction). Use the repo's rejection helper, not
`expect(...).rejects` (which hangs with Bun.SQL).

**Status (§13).** T1 is in `booking-database.integration.test.ts` (#937). T2, T3 (with the `DO NOTHING` interleaving it rests on), T6 (a) and the reaper races of (b), and T7 are in `booking-concurrency.integration.test.ts` (#939), driven through `placeHold` on real concurrent transactions. Issue #941 adds `booking-reservation.integration.test.ts` (the application layer on real transactions: T5 (a), (b) and (c), the confirm-versus-sweep half of T6 (b), the default caps racing, `expired` published by both ways, no personal data in an event or an audit row, the `BookingPort`) and `booking-reservation-api.integration.test.ts` (the real route handlers: T4 with five parallel requests on one key, the access matrix of §6 both ways, the override both ways, neutral not-found, the payment-field refusal). T2 and T10 still drive `placeHold` directly: the route adds authorization and an idempotency store in front of the same claim and does not change what the 20 contenders race for. T9 to T13 are in `booking-stay.integration.test.ts` (#940), driven through `placeHold` and `createBlock` rather than through `POST /booking/reservations` and the block API, which arrive with #941 and #942; they move behind the routes then. T8 needs `staff_assignments`.

**T1 — database level, interleaving proven.** Fixture: one resource, capacity 1,
one unit; window `[10:00, 11:00)`.

1. Connection A: `BEGIN; INSERT` allocation for the unit `[10:00,11:00)` (not committed).
2. Connection B: `BEGIN; INSERT` the same unit `[10:30,11:30)` (overlapping). Start it without awaiting.
3. Assert B is **blocked**: poll `pg_stat_activity` for B's backend with
   `wait_event_type = 'Lock'` within 2 s (this proves genuine concurrency, not
   sequential execution).
4. A: `COMMIT`. Assert B's INSERT rejects with SQLSTATE `23P01` (`errno`).
5. Variant: repeat with A `ROLLBACK`; assert B's INSERT succeeds.
6. Variant: adjacent ranges `[10:00,11:00)` and `[11:00,12:00)` both commit
   (half-open boundary); with `cleanup_seconds = 900` on the first, the second
   conflicts (buffers occupy).

**T2 — application level, final slot, many contenders.** Fixture: capacity 1, one
open slot. `Promise.all` of **20** `POST /booking/reservations` with 20
**distinct** `Idempotency-Key`s and distinct customers, each on its own
connection. Assert: exactly **one** `201`, nineteen `409 SLOT_UNAVAILABLE`, no
`5xx`, and `SELECT count(*) FROM allocations WHERE resource_unit_id = $1 AND
released_at IS NULL` equals **1**. Repeat the whole test **50 times** with fresh
fixtures (a race that survives one run rarely survives fifty).

**T3 — capacity N, final unit.** A pool/resource with 3 units, 10 contenders for
the same interval, one unit each: exactly **3** succeed on **3 distinct units**,
7 are `409`. A contender needing 2 units when only 1 remains gets `409` and
leaves **no** partial allocation (all-or-none).

**T4 — idempotency under concurrency.** Five parallel requests with the **same**
`Idempotency-Key` produce one reservation and one stored response (four replays);
the same key with a different body is `409 IDEMPOTENCY_CONFLICT`.

**T5 — reschedule races.** (a) Rescheduling to an overlapping time of its own
slot succeeds (release-then-insert). (b) Two reservations rescheduling into each
other's slots concurrently: no hang (test timeout 10 s), at most one completes,
the other is `409`, and both originals remain intact if refused. (c) A refused
reschedule leaves the original `confirmed` with its allocations live.

**T6 — hold expiry races.** (a) An expired, unswept hold does not block a new
claim on the same unit (lazy reclaim) and is left `expired`. (b) Confirm racing
the expiry job on one hold: exactly one outcome, never a `confirmed` row without
live allocations. Time is driven by the database clock (set `hold_expires_at` in
the past through the test's SQL), not by sleeping.

**T7 — the test detects the defect.** A mutation check: against a scratch schema
where the exclusion constraint is dropped, T1 step 4 and T2 **fail**. A
concurrency test that passes without the constraint proves nothing.

**T8 — staff.** The same final-slot shape on `staff_ref`: two parallel
reservations needing the same person, one wins.

**T9 — stays, database level (interleaving proven as T1).** Fixture: one `stay` resource, capacity 1, one unit. (a) Connection A inserts a stay `[10th, 12th)` uncommitted; B inserts `[11th, 13th)`; assert B is blocked on a lock; A `COMMIT` → B fails `23P01`; the variant with A `ROLLBACK` → B succeeds. (b) Adjacent `[10th, 12th)` and `[12th, 14th)` both commit (same-day turnover). (c) `[10th, 12th)` and `[11th, 12th)` conflict (night 11). (d) A released stay no longer blocks.

**T10 — stays, final room, many contenders.** 20 parallel `POST /booking/reservations` for the same `[d, d+2)` with 20 distinct `Idempotency-Key`s on one room: exactly **one** `201`, nineteen `409 SLOT_UNAVAILABLE`, one live allocation row; repeat **50 times**. A capacity-3 variant with 10 contenders: exactly 3 succeed on 3 distinct units, and no stay is ever split across units.

**T11 — blocks against bookings.** (a) A block and a booking racing for the same night: exactly one commits. (b) A block over an existing confirmed stay is `409 BLOCK_CONFLICT`, writes nothing and cancels nothing. (c) A released block frees its nights. (d) An expired, unswept hold on the target units does not refuse a block (lazy reclaim). (e) A block over several units is all-or-none.

**T12 — DST and zones.** In a DST zone fixture (for example `Europe/Berlin`) and a non-DST zone (`Asia/Pontianak`): a stay spanning the spring-forward date and one spanning the fall-back date each have `nights = check_out_date − check_in_date` (the 23-hour and 25-hour days count as one night each); adjacent stays on a transition date do not conflict; a check-in time inside the gap and one inside the fold yield the §2.2 instants, stored in the item snapshot; changing the resource's `timezone` while live stays exist is `TIMEZONE_IN_USE`; a nonexistent local date is `STAY_DATES_INVALID`.

**T13 — the test detects the defect, and the granularity guard.** Against a scratch schema where the stay constraint is dropped, T9 and T10 **fail**. A slot allocation on a stay resource, and the reverse, is rejected by the trigger.

## 9. Threat and privacy notes

**Assets.** The integrity of the claim (no double-booking, no phantom booking),
availability of the schedule (no one holds it hostage), and the personal data of
people who book (a customer reference, a free-text note, and in some verticals
what the note reveals).

| Threat                                                                                   | Mitigation                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Race to the last slot (double-booking)                                                   | §8: declarative exclusion constraint; required regression test                                                                                                                                                                                                     |
| **Hold flooding** — an actor holds every slot to block sales or a competitor             | holds are capped per customer and per tenant (`max_active_holds_*`), expire (max TTL), `extend` is limited, creating a hold needs `reservations.create` (a downstream public channel authenticates its customer and rate-limits at the edge); expiry releases      |
| Availability enumeration (competitor scrapes occupancy, or a person's appointment times) | `availability.read` is a permission, search window ≤ 31 days and page-bounded, per-principal rate limit; results never include other customers' identity; **never edge-cached** (it is per-tenant and per-request); the public projection is a downstream decision |
| Cross-tenant read or write                                                               | `tenant_id` + FORCE RLS on every table, composite FKs, tests as `awcms_app`                                                                                                                                                                                        |
| IDOR on a reservation id                                                                 | every handler authorizes through `authorizeInTransaction`; ownership-style access for a customer is a downstream grant (ADR-0063), not assumed                                                                                                                     |
| Replay / double submit                                                                   | §5.2 three layers                                                                                                                                                                                                                                                  |
| Client asserts a state, interval, price or payment                                       | server owns status, intervals (derived from the offering and the request's start), buffers, expiry; payment fields are refused by name                                                                                                                             |
| Timezone / DST manipulation to book an impossible time                                   | explicit IANA zone, RFC 5545 gap and fold rules, `start < end`, lead-time and horizon checks on UTC instants                                                                                                                                                       |
| Unbounded recurrence / expansion (CPU denial)                                            | closed schema, hard caps (§2.4), expansion horizon ≤ 366 days, ≤ 52 occurrences per series                                                                                                                                                                         |
| Staff overbooked or shift ignored                                                        | staff exclusion constraint + advisory read of the workforce port; a later shift change is reported (§7.3), never silently applied                                                                                                                                  |
| Free-text note leaks (log, export, event, audit)                                         | `customer_note` classified, ≤ 500 chars, in `redactedColumns`, absent from events/audit/logs, read behind `reservation_notes.read` (audited), nulled on erasure                                                                                                    |
| Override abuse (booking outside hours)                                                   | HIGH-RISK `override`, `Idempotency-Key`, audited `critical`; it can never override the exclusion constraint                                                                                                                                                        |
| Stay dates sent as instants, in the wrong zone, or for a day the zone skips              | dates only (`YYYY-MM-DD`), read in the resource's zone; an instant is refused for a stay; a nonexistent local date is `STAY_DATES_INVALID`; the zone is immutable while live stays exist                                                                           |
| Blocks used to hide inventory or deny sales                                              | `blocks.create` is a separate, high-impact permission, `Idempotency-Key`, audited `warning`; a block cannot override or cancel an existing reservation; the active blocks are listed and releasable (`blocks.release`) and reconciled (§7.1)                       |
| Provider call inside a transaction                                                       | none exists; any notification or payment is downstream, through the outbox                                                                                                                                                                                         |

**What the hold caps rely on.** The per-customer cap counts holds by
`external_customer_ref`, which the adapter or BFF supplies and the module cannot
verify: a hold with no reference (or a fresh reference per hold) is not counted
against any customer. Only the **per-tenant** cap is a hard bound; the
per-customer cap is a fairness control that is as good as the caller's
authentication of its customers (a downstream public channel authenticates its
customer and rate-limits at the edge).

**Privacy (UU PDP 27/2022) — inputs to the privacy analysis, not legal
conclusions.** The operator's legal role (controller, processor or both) is
owner decision O5 of the downstream DoR and is not assumed here. The design
choices that hold in either case: _data minimisation_ — a customer is a
reference, not a copied name, address or phone number; _purpose_ — a note is
operational, short, and policy-gated; _special-category data_ — in a clinic or
similar vertical a note or an offering name can reveal health information, which
the Act treats as specific personal data; the module therefore ships with the
note **off by default for tenants that declare a health vertical (O2)** and with
no health-specific field; _subject rights_ — every table answers the
data-subject question (§4), and access/erasure are answered per tenant (ADR-0094)
by customer reference; _retention_ — reservations are retained for the life of
the tenant in v1 and a per-tenant retention window with archive-then-purge is a recorded follow-up needing its own ADR (the 90-day "retention window" of O8 is a customer-retention KPI, §7.2, not this data-retention period); _security_ — masking/redaction in logs,
exports, audit rows and events; _breach_ — the module adds no new store of
secrets, and no credential, token or key exists in it.

## 10. Adapter and port contract

### 10.1 What the module gives

A `BookingPort` in `src/modules/_shared/ports/booking-port.ts` (ADR-0011:
consumers depend on the neutral port, never on module code), **built in Issue
#941** with its adapter `application/booking-port-adapter.ts`. It _returns_ a
refusal as a value; it throws only for defects. The built signatures differ from
the sketch below in four ways: every method takes the caller's transaction first
(`tx`) and the input carries `tenantId`; `quote` asks one `resourceId` (a pool is
a `hold`-only target); the refusal union is completed with what the claim can say
(`RESERVATION_NOT_FOUND`, `QUANTITY_EXCEEDS_UNITS`, `BOOKING_MODE_MISMATCH`,
`EXTERNAL_REF_IN_USE`, `CONTENTION_RETRY`, the stay refusals, `VALIDATION_ERROR`);
and the port has **no override** (lifting policy is a human act behind a
high-risk permission). Idempotency is by key on the same store as the routes under
its own scopes; only a success is stored. Sketch:

```ts
interface BookingPort {
  /** Non-binding: is this claim possible now? No row is written. */
  quote(input: { tenantId; offeringId; startsAt; partySize; resourceId?; staffRef?; correlationId }):
    Promise<{ ok: true; endsAt; occupiedFrom; occupiedTo; unitsNeeded }
           | { ok: false; reason: "SLOT_UNAVAILABLE" | "OUTSIDE_SCHEDULE" | "LEAD_TIME_VIOLATION" | … }>;
  /** Claim the slot as a hold (or confirmed when the offering is `immediate`). Idempotent on idempotencyKey. */
  hold(input: { …quote input; externalCustomerRef?; holdSeconds?; externalRef?: { type; id }; idempotencyKey }):
    Promise<{ ok: true; reservationId; status; holdExpiresAt; replayed } | { ok: false; reason }>;
  confirm(input: { tenantId; reservationId; idempotencyKey; correlationId }): Promise<…>;
  cancel(input: { tenantId; reservationId; reasonCode; idempotencyKey; correlationId }): Promise<…>;
  reschedule(input: { tenantId; reservationId; startsAt; idempotencyKey; correlationId }): Promise<…>;
}
```

Consumer duties, as for `InventoryLedgerPort`: the **route authorizes before the
port runs**; the port is tenant-scoped; the correlation id is passed to every
audit row and event so both halves of one action join. A `quote` is not a
promise — only a `hold` or a `confirm` is.

**Stays (provisional extension).** `quote` and `hold` accept, instead of `startsAt`, `stay: { checkInDate, checkOutDate }` (local `YYYY-MM-DD` dates in the resource's zone) and return `nights` and the derived `checkInAt` / `checkOutAt` instants; `reschedule` takes the same `stay`. Refusal reasons gain `MIN_STAY_VIOLATION`, `MAX_STAY_EXCEEDED`, `STAY_DATES_INVALID`, `BLOCK_CONFLICT` (a block call) and `TIMEZONE_IN_USE`. Blocks are created and released through the module's own admin API, not the port.

**Port contract 1.1.0 (Issue #1108).** The capability `booking` is versioned in
`src/modules/_shared/capability-contract-versions.ts` (first entry: `1.0.0` was
the port above, `1.1.0` adds the following; no existing signature changed). A
consumer that builds on the port (the commerce adapter's cancellation policy,
reschedule, POS check-in/out and storefront pages) needs more than the five verbs:

| Method                                                      | What it does                                                                                                                                                                               |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `checkIn(tx, Targeted)`                                     | `confirmed -> checked_in`. A stay is refused before its check-in DATE (`CHECK_IN_TOO_EARLY`); no time-of-day check.                                                                        |
| `checkOut(tx, Targeted)`                                    | `checked_in -> completed` (the module's `complete`).                                                                                                                                       |
| `markNoShow(tx, Targeted)`                                  | `confirmed -> no_show` after the start plus the tenant grace (`NO_SHOW_TOO_EARLY` before). The route restricts it to staff; the port authorizes nothing, so that check is the CONSUMER's.  |
| `get(tx, {tenantId, reservationId \| reservationNo})`       | `status`, `startsAt`, `endsAt`, `reservationNo`, `holdExpiresAt`, `lineageId`, `supersededById`, `stays[]`, `externalRef`. **No** customer reference, party size, note or actor.           |
| `getOffering(tx, {tenantId, offeringId})`                   | One live offering: `granularity`, `confirmationMode`, `status`, party range, `durationSeconds` or night bounds.                                                                            |
| `listOfferings(tx, {tenantId, cursor?, limit?})`            | Live offerings, newest first, keyset paged (limit 1..100, default 50, optional `status`); `nextCursor: null` is the end. Retires a consumer's direct read-only `SELECT` of booking tables. |
| `availability(tx, {tenantId, offeringId, resourceId, ...})` | The anonymous-safe read for a public booking page: slots (`from`/`to`, at most 31 days, at most 500 slots) or a stay's `{nights, freeUnits, available}`. No actor, nothing written.        |

The three transitions have exactly the contract of `confirm`: the actor, an
`idempotencyKey` namespaced per actor (ADR-0145), a `Targeted` reservation, the
**same** `transition()` as the HTTP route (so the same history row, audit row and
`awcms.booking.reservation.*` event), and a refusal returned as `{ ok: false,
reason }`. Each verb has its own idempotency scope (`booking_port_check_in`,
`booking_port_check_out`, `booking_port_no_show`), so one key reused for two
verbs on a reservation is not a replay. The refusal union gains
`CHECK_IN_TOO_EARLY` and `NO_SHOW_TOO_EARLY` (the adapter used to fold both into
`INVALID_STATE`; a POS needs to tell "wrong state" from "come back later").

Reads write nothing and take no key. Not found is a VALUE (`RESERVATION_NOT_FOUND`,
`OFFERING_NOT_FOUND`) and is the same answer for an unknown id and another
tenant's; a malformed key or cursor is `VALIDATION_ERROR`. `get` selects an
explicit column allow-list (`application/booking-port-reads.ts`) that never names
`external_customer_ref`, so the opaque customer token is not readable through the
port even by the consumer that placed the hold (it already has it). Instants in a
`get` are rendered by the database with microseconds (`...00.000000Z`), as every
other booking read; availability slots use millisecond `toISOString()` form. Both
are RFC 3339 UTC.

**The anonymous availability read.** The port runs inside the caller's tenant
transaction, so the pattern is the one every public read in this repository uses:
the public route resolves the tenant from the host, runs `withTenant(tenantId)`
(RLS FORCE then scopes every row; each query also names `tenant_id`), and calls
`availability` with no actor and no principal. A caller that names another tenant
than its transaction's reads nothing (the neutral "no availability" answer). The answer holds
slots (start, end, free units) or the stay counts, never a resource name or unit
label, a reservation, the staff serving a slot, the tenant policy, or whether a
night is blocked rather than booked (both are `SLOT_UNAVAILABLE`). An unavailable
stay is ONE answer whatever the cause (booked, blocked, min or max stay, lead
time, horizon, schedule): `available: false`, `freeUnits: 0`, `nights: null`,
`reason: SLOT_UNAVAILABLE`, never `MIN_STAY_VIOLATION`, `MAX_STAY_EXCEEDED`,
`LEAD_TIME_VIOLATION`, `HORIZON_EXCEEDED` or `OUTSIDE_SCHEDULE`. A quantity above
the resource's units and an unknown `resourceId` are the same "no availability"
answer as a fully-booked window (an empty `slots`, or the stay answer above), so
the total unit count cannot be binary-searched. Every answer without free
capacity carries the fixed `timezone: "UTC"`; an answer with free capacity
carries the resource's own zone. Only the offering, the booking mode and a
malformed date stay named refusals, and a malformed `tenantId` (on `get`,
`getOffering`, `listOfferings` and `availability`) is `VALIDATION_ERROR`. It asks one
`resourceId` because an offering does not fix a resource (there is no
offering-to-resource link in the schema); the page already knows which one it
sells. **This change adds no HTTP route:** the anonymous route, its rate limit
(the authenticated `GET /availability` is 120 per minute per principal; a public
one is keyed on the client address) and its CDN caching belong to the consumer,
which owns the page. The port bounds the work itself (31-day window, 500 slots,
`maxCandidates`). **A consumer route that exposes `availability` MUST rate-limit
and cache-bound it:** the port takes no actor and does no ABAC check, by design
(that is what makes it anonymous), so the route is the only throttle against
occupancy scraping. And `get` by `reservationNo` is an unauthenticated lookup by
a guessable-shaped number: a consumer must never expose it publicly by number
(authorize the actor first, or look up by the unguessable `reservationId` the
consumer already holds).

### 10.2 What the module never does (no `commerce` dependency)

It does not import, call or declare a dependency on `commerce`. A tenant with no
store enables `booking` and uses it through its own admin screens and API. The
following are the **downstream adapter's** (in `awcms-one` `commerce`, per its
ADR-0040), described so the port is shaped right, not specified here:

- offering ↔ product link (a product row naming an `offeringId`);
- hold → order: create a pending order, store its id in `external_ref`;
- payment observation → `confirm`; hold `expired` event → cancel the order;
- deposit as a partial payment on the order; refund coordination on `cancelled`;
- receipts and invoices from the order. Booking never issues a numbered document.

The adapter consumes events through the generic consumer-registration mechanism
the downstream still has to build (ADR-0040 "known mechanism gap"); this module
only emits through the outbox and needs no consumer registry of its own.

### 10.3 Staff availability port (consumed; defined by `hr_payroll`, #916)

Booking **reads** staff availability through `StaffAvailabilityPort`, defined by
the `hr_payroll` admission ([ADR-0132](../adr/0132-hr-payroll-module-family-admission.md),
Issue #916; full contract in [`hr-payroll.md`](hr-payroll.md) §5) — never payroll,
attendance or employee tables. Booking consumes it as defined and adds no
requirement of its own:

```ts
interface StaffAvailabilityPort {
  getAvailability(
    tx: TenantTx,
    query: {
      staffRefs: readonly string[]; // opaque, 1..200
      fromUtc: string; // inclusive
      toUtc: string; // exclusive, span <= 35 days
      officeId?: string;
    }
  ): Promise<{
    asOf: string;
    staff: ReadonlyArray<{
      staffRef: string;
      status: "resolved" | "unknown";
      intervals: ReadonlyArray<{ startUtc: string; endUtc: string }>; // [start, end)
    }>;
  }>;
}
```

Classified an **optional** `consumes` capability (doc 21 §5). Without it
(`hr_payroll` not enabled, or the tenant tracks no shifts) staff assignments are
constrained only by booking's own exclusion rule and the response says
`staffAvailability: "unchecked"`. With it, the read is **advisory**: point-in-time
and unlocked, so a shift edited between the read and the commit is not caught
here; the later change is surfaced by the §7.3 conflict report, not by
cancelling. `unknown` is **not bookable** (fail closed): `STAFF_UNAVAILABLE`.
`staffRef` is opaque to booking and resolved only by the port.

**As built (Issue #949, `sql/305`).** The port is consumed as an optional
capability `staff_availability` provided by `hr_workforce` (a soft edge in the
module descriptor, never a `dependencies` entry; the DAG has no cycle). The
adapter is imported lazily in `booking/module.ts` only
(`loadStaffAvailabilityPort`, ADR-0011); `application/**` sees the port type from
`_shared/ports` and a `StaffAvailabilityConsumer`.

- **When a resource "requires staff".** `awcms_booking_resources.required_staff_refs`
  (text[], at most 50) names the opaque references of the people who can serve
  it. Empty (the default) means the resource needs nobody and no staff query ever
  runs. There is no admin route or screen for the column yet (a follow-up); it is
  written by a migration or an operator today.
- **On or off.** `resolveStaffAvailability(tx, tenantId, loadPort)` decides once
  per request: `hr_workforce` enabled for the tenant AND the adapter loadable,
  else `NO_OP_STAFF_AVAILABILITY`: **no staff constraint at all** (no staff row is
  written either), the booking that existed before this change. A loader that
  throws degrades to the same no-op. Once the constraint is on it fails closed: a
  resource whose people are all `unknown` to the port (or on leave, or outside a
  shift) is unbookable, and a port error is a 500, not a silent skip.
- **Read.** `GET /availability` offers a slot only if some named person is working
  for the whole service interval (one merged working interval) and is not already
  serving a live claim; the slot answer carries `staffAvailability: "checked" |
"unchecked"`.
- **Claim.** After `claimUnits`, in the same savepoint, the port-eligible people
  are tried in order with `INSERT ... ON CONFLICT DO NOTHING` into
  `awcms_booking_staff_assignments`, whose single exclusion constraint on
  `(tenant_id, staff_ref, occupied range)` refuses two live overlapping
  assignments of one person (among the assignments that were recorded; see the
  enable-later gap below). No free person throws inside the savepoint, which rolls back the
  units, the item and the reservation: **`SLOT_UNAVAILABLE`, nothing allocated
  partially**. One person serves the whole claim of one resource, whatever the
  quantity; the staff interval is the service interval, not the setup/cleanup
  widened range. Stays carry no staff.
- **Release.** A trigger on `awcms_booking_resource_allocations` releases the
  assignment, with the same reason, when the last live allocation of the (item,
  resource) is released, so cancel, expiry (lazy and the worker sweep) and
  reschedule need no staff code.
- **The `BookingPort` adapter is staff-aware.** `PlaceHoldContext.staff` is
  required (no default, so "no constraint" must be spelled
  `NO_OP_STAFF_AVAILABILITY`). `createBookingPort(resolveStaff)` takes the
  resolver; `createComposedBookingPort()` in `booking/module.ts` is the composed
  instance (loader injected, `application/**` never imports `hr_workforce`).
  Transitions (confirm, cancel) claim nothing and pass the no-op on purpose.
- **Occupancy does not depend on the reaper.** The busy read ignores an assignment
  whose reservation is an elapsed hold, and the claim reclaims elapsed holds by
  staff reference (`reclaimExpiredHoldsForStaff`) before racing for a person, so
  an unreaped hold on one resource does not block the same person on another.
- **Enable-later gap (operator guidance).** Staff rows are written only while
  `hr_workforce` is on for the tenant. Reservations made while it was OFF have no
  staff assignment, so after enabling it the person is **not protected against
  them**: a new claim can overlap an old reservation that nobody recorded as
  theirs. Before enabling for a tenant that names staff on resources, either
  enable the module before taking bookings on those resources, or review
  existing future reservations of those resources and reassign or move any that
  overlap a rostered person. There is no backfill: booking never learns who
  served an unrecorded reservation.
- **Not covered yet.** A shift edited after the claim is surfaced by the §7.3
  report, not applied; `service_requirements.staff_role` is still design.

Tests: `tests/booking-staff-availability.test.ts` (pure rules, the composition
boundary) and `tests/integration/booking-staff-availability.integration.test.ts`
(with and without the module, fail closed, the conflict leaving nothing behind,
twelve parallel claims for one person, release follows the allocation).

### 10.4 Module registration (design)

`type: "domain"`; `dependencies`: tenant-admin / identity-access only;
`capabilities.consumes`: workforce availability (optional) (no `profile_identity`: commerce is the customer authority, O12), `reporting` (projections), `domain_event_runtime`
(outbox); status `experimental` until its first admin screen (the navigation
registry requires a real page); `active` since Issue #942. Compatibility class: offline-lan-safe.

## 11. Open questions (owner decisions — recorded, NOT decided here)

Mapped to the downstream tracker
[`aw-business-platform-dor.md`](https://github.com/ahliweb/awcms-one/blob/main/docs/aw-business-platform-dor.md).
ADR-0040 settled placement only. The owner answered O1–O12 on 2026-10-10 (recorded downstream in the awcms-one DoR); the rows below say which answers are recorded here (**Answered**) and which are still open here (O1, O3, O5 and O9 were answered downstream the same day but change nothing in this pack and are not yet reconciled into it; O2 is handled by Issue #931). "Blocks" says what in this
pack cannot be finalised until the answer is recorded.

| #       | Question                                                                                                                                   | What this pack assumes meanwhile                                                                                                                                                                                                                                                                                                                                                                                                                                               | Blocks                                                                                 |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| **O1**  | Personas in scope                                                                                                                          | The provisional list in §1 (receptionist, manager, resource owner, adapter, auditor)                                                                                                                                                                                                                                                                                                                                                                                           | §6 role bundles and the seed grants; UAT                                               |
| **O2**  | Which verticals come first (hotel/villa, salon, clinic, rental, facility, workshop, training), and whether a consumer builds locally first | **Answered 2026-10-10 (awcms-one DoR):** first vertical hotel / villa / rental; no existing consumer repository. The owner resolved the conflict with this pack's earlier assumption by asking for an upstream scope change: **day-granularity stays are in v1** (ADR-0135, §2.5, §3.1). Still generic: no vertical field. `MONTHLY` recurrence stays out of v1 (not requested). The health-note policy keeps its default (off for tenants that declare a health vertical, §9) | The first admin screens (the schema is final since `sql/204`); the sub-questions below |
| **O3**  | MoSCoW across CRM, Booking, Workforce, Payroll, Notification, Analytics                                                                    | Booking is Wave A/B; automatic no-show job and waitlist stay _Could_                                                                                                                                                                                                                                                                                                                                                                                                           | Ordering only; no schema                                                               |
| **O5**  | Legal role of the operator (controller/processor/both)                                                                                     | Neither asserted; design is neutral (§9)                                                                                                                                                                                                                                                                                                                                                                                                                                       | The privacy analysis text, not the schema                                              |
| **O8**  | Occupancy vs utilization, **do holds count**, booked vs actual time, denominator rules                                                     | **Answered 2026-10-10 (awcms-one DoR):** occupancy excludes holds (a hold is a separate pipeline figure); utilization is a separate metric; customer-retention window 90 days (a cross-domain KPI, not a data-retention period); net revenue is the headline (§7.2). **Still open:** whether the denominator excludes maintenance closures; booked vs actual time                                                                                                              | Only the remaining _definitions_; no table                                             |
| **O9**  | Explicit non-goals                                                                                                                         | The §1 list                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Scope wording                                                                          |
| **O12** | Customer identity: commerce stays the customer authority, or `profile_identity` harmonisation                                              | **Answered 2026-10-10 (awcms-one DoR): commerce stays the customer authority.** v1 `reservations` carries only the opaque, nullable `external_customer_ref` (null = walk-in); no `customer_profile_id`, no `profile_identity` dependency. A harmonisation, if ever wanted, is an additive column under its own ADR                                                                                                                                                             | Nothing: the customer columns and the erasure path (§4) are fixed for the migration    |

**Open sub-questions raised by the stay design** (not answered by the owner; recorded, not decided; proposed for the downstream tracker):

- **O2a — what "rental" means.** Hotel and villa are nightly. A rental may be per day (covered by a `stay` resource, pick-up = check-in, return = check-out) or per hour (covered by a `slot` resource). Both are supported; confirm which the first rental consumer needs, and whether pick-up/return times differ from the lodging defaults.
- **O2b — a `property` entity.** v1 takes the time zone and the check-in / check-out times from each resource (and tenant defaults). Whether several room types of one property must share them through a `property` entity (and whether pools should carry them) is not decided.
- **O2c — default check-in / check-out times.** The module fixes none; the owner or the first consumer sets the tenant defaults.
- **O2d — amending a stay in place.** Extending or shortening a stay that is `checked_in` (an early departure releasing unused nights, an extension taking the next nights if free) is not specified; v1 supports only reschedule before check-in (§3.1).
- **O2e — room moves inside a stay** and best-fit packing of stays across units (a "sold out" answer that a move would avoid) are out of v1.
- **O2f — date-dependent rules.** Per-night rates and rate plans, date-dependent minimum stay, arrival-day or departure-day restrictions are out of v1 (the minimum is per offering, §2.5).
- **O2g — no-show for stays.** Whether the grace is per offering (and whether a no-show releases the remaining nights after the first) — the existing open question, now concrete.
- **O2h — block events.** Whether a downstream (a channel manager) needs `awcms.booking.block.*` events; v1 emits none.
- **O13 — reminder policy (Issue #943).** Recorded, not decided: (a) the lead is a fixed 24 hours and there is one reminder per reservation; whether it is per tenant (a `reminder_lead_seconds` column and policy field) or per offering, and whether a second reminder exists; (b) the confirmation is sent on the next job pass after `confirm`; whether a tenant can switch confirmations or reminders off independently; (c) the wording is neutral English and carries only the reservation number and the local start; per-tenant wording and locale, and a Meta-approved provider template name, are the owner's; (d) e-mail is not routed (the e-mail module cannot take an opaque customer reference either); whether a customer without WhatsApp should fall back to e-mail; (e) which downstream adapter implements `BookingReminderRecipientPort` (commerce, per O12).

Also open and _not_ in the downstream tracker (proposed for it): the default and
maximum hold TTL (§5.1, 900 and 86 400 seconds, are the module's defaults, not an
owner decision); the hold CAP numbers were settled by Issue #941 as a safe default
(§13) and stay tunable per tenant;
whether a series can be partially accepted; whether the no-show grace is
per-offering rather than per-tenant; whether `reservation_notes.read` should be a
separate permission from `reservations.read` (assumed yes). None of the above is
decided by this document.

## 12. Rollback, operations and follow-ups

**Rollback.** Forward-only like every migration here. To stop using the module:
stop calling it and (optionally) disable it per tenant; the tables are inert and
downstream orders stay valid by themselves. Dropping the tables is a
restore-class decision. After any restore run the booking reconciliation (§7.1):
reservations and allocations must come back from the same point in time. To give
an existing tenant the new permissions run
`bun run identity-access:permissions:backfill`.

**Operations.** The expiry job's health is observable (stuck holds show in the
reconciliation, §7.1); correctness does not depend on it (§5.1). The `btree_gist`
pre-flight belongs in the deploy runbook (§8.2). Allocation rows grow with
bookings, not with traffic; a partial GiST index over live rows keeps probes
cheap, and past rows are an archive-then-purge follow-up (no purge in v1;
registered with `data_lifecycle` as `delegated` with a stated reason, ADR-0126 §7).

**Recorded follow-ups (not in v1).** Admin screens for creating, rescheduling and overriding a reservation (the six screens of §3.0.3 exist since Issue #942 and the module is `active`); location/resource-scoped ABAC; counted capacity without unit
rows (would use §8.1 rule 4); partial-accept series; shared turnaround; waitlist;
iCal export; automatic no-show; a retention window with archive-then-purge; `profile_identity` harmonisation of the customer reference (own ADR; O12 kept commerce as the authority);
`MONTHLY` recurrence (O2); the stay follow-ups O2a–O2h (§11); the `extend` route of §5.1; keyed hashing and at-rest
encryption are not applicable (no identifier is stored).

## 13. Implementation status

What is built, what is only specified, and where the next slice attaches. The
design above is the contract; this section is the map from it to the code
(module map: [`src/modules/booking/README.md`](../../src/modules/booking/README.md)).

| Slice                | Issue | Built                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foundation           | #937  | Schema `sql/180` (RLS FORCE, composite foreign keys, both exclusion constraints, the state machine as a trigger, append-only history), permission catalogue `sql/181`, the pure state machine. Test T1 (database-level interleaving).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Availability         | #938  | Schedules, exceptions, blocks table (`sql/186`), the pure slot and stay availability, `GET /availability`, schedule routes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Allocator, holds** | #939  | The slot allocator (§8.1 rules 1 to 3, 6): `INSERT ... ON CONFLICT DO NOTHING RETURNING`, first free unit in `(sort_order, id, ordinal)` order, all-or-none for several units, units chosen together inserted in `(resource_id, ordinal)` order, `23P01` and `40P01` handled (bounded retry with jitter). Holds with expiry (§5.1): lazy reclaim at write time plus the `booking:holds:expire` reaper, correctness independent of the reaper. `placeHold`, the claim a reservation route will call. Hold caps (a sum, §8.1 rule 4). The read-only reconciliation of §7.1. Tests T2, T3 (and its `DO NOTHING` premise), T6 (a, b), T7, in `tests/integration/booking-concurrency.integration.test.ts`. One migration, `sql/200`, and only for the job's privilege: the narrow SECURITY DEFINER sweep that lets `booking:holds:expire` run as `awcms_worker`; the schema of `sql/180` already holds every invariant the allocator needs.                                                                                                                                  |
| **Reservations**     | #941  | The routes of §3.0 (`POST/GET /reservations`, `GET /reservations/{id}`, `confirm`, `cancel`, `reschedule`, `check-in`, `check-out`, `no-show`) over `application/booking-reservation-service.ts`; `Idempotency-Key` through the shared component, with the state check as the second layer; policy (`application/booking-reservation-policy.ts`, `domain/booking-policy.ts`) and the `overridePolicy` path with its independent high-risk check; reschedule with lineage; the `BookingPort` and its adapter; the nine events on the live AsyncAPI document and in the runtime registry, published by request transitions, lazy reclaim and the sweep; safe default hold caps. Migrations `sql/208` (deferred `superseded_by_id` foreign key) and `sql/209` (the event-facts function, the sweep returning what it expired). Tests: the pure rules in `tests/booking-policy.test.ts` and `tests/booking-reservation-validation.test.ts`; `tests/integration/booking-reservation.integration.test.ts` and `booking-reservation-api.integration.test.ts`.                  |
| **Stays, blocks**    | #940  | Stay claims through `placeHold` (`stay: { checkInDate, checkOutDate }`: dates validated in the resource's zone, nights as date arithmetic, the arrival and departure instants and the zone and local times snapshotted onto the item, the offering's `min_nights` / `max_nights`) and through the same allocator (`UnitClaim` `kind: "stay"`, the `daterange` probe); lazy reclaim of stay holds (`ReclaimWindow` `kind: "stay"`); blocked nights as allocation rows (`booking-block-service.ts`: `createBlock`, `releaseBlock`, `BLOCK_CONFLICT`, `UnitClaim` `kind: "block"`); three block reconciliation checks; tests T9 to T13 in `tests/integration/booking-stay.integration.test.ts` and the pure rules in `tests/booking-stay.test.ts`. One migration, `sql/204` (the block rows and their guards, `BOOKING_MODE_IN_USE`, the 368-day instant bound). `sql/200` needs no change: a stay hold expires on the same column and releases through the same item join. No HTTP route, block routes included: they arrive with #941 (reservations) and #1012 (blocks). |
| **Block routes**     | #1012 | `POST /blocks`, `POST /blocks/{id}/release`, `GET /blocks`, `GET /blocks/{id}` (§3.0.1) over `booking-block-service.ts`, `booking-block-directory.ts` and `booking-block-routes.ts`, bound to `Idempotency-Key` with replay (N2), `BLOCK_CONFLICT` details gated by `reservations.read`, audit `warning` / `info`, no event. Follow-ups of #940: a resource-wide block covers units added later (N1, `sql/240`: AFTER INSERT trigger + the resource lock in `readBlockUnits`), lazy reclaim limited to the covered unit(s) with an accurate audit text (N3), one release instant (N4, `sql/241`). Tests: `tests/integration/booking-block-api.integration.test.ts`, the "Issue #1012" block of `tests/integration/booking-stay.integration.test.ts` (interleavings proven through `pg_stat_activity`) and `tests/booking-block-validation.test.ts`.                                                                                                                                                                                                                     |
| **Reporting**        | #944  | Three projections on the `reporting` engine (`booking.reservations`, `booking.time`, `booking.nights`; §7.2.1), the `sumColumn` rule field and the tie-safe page boundary in the engine, the live reports `GET /booking/reports/{occupancy,utilization,reservations}` with Asia/Jakarta day windows and small-group suppression. One migration, `sql/244` (the quantity columns, `projection_kind`, the stamping trigger, a backfill). Tests: `tests/booking-report.test.ts`, `tests/reporting-projection-metric-delta.test.ts`, `tests/integration/booking-reporting.integration.test.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Admin config**     | #1030 | The routes of §3.0.2 over `booking-resource-admin.ts` (resources, units, pools), `booking-offering-admin.ts`, `booking-policy-admin.ts` and the shared `booking-admin-routes.ts` / `booking-admin-support.ts` (the savepoint that maps a database guard to a 409, the keyset page, the idempotent-mutation wrapper) with the pure rules in `domain/booking-admin-validation.ts`; the audit events `booking.pool.*` and `booking.offering.restored`, and `booking.policy.configured` raised to `critical`. No migration: every invariant it relies on is in `sql/180`, `186`, `204` and `240`. Tests: `tests/booking-admin-validation.test.ts` and `tests/integration/booking-admin-api.integration.test.ts` (the access matrix both ways, replay, the guard refusals, soft delete, tenant isolation).                                                                                                                                                                                                                                                                   |
| **Admin screens**    | #942  | The six screens of §3.0.3 (`src/pages/admin/booking/*.astro`), the shared sender `src/lib/ui/booking-admin-client.ts`, the translated messages `src/lib/booking-admin-messages.ts` and labels `src/lib/booking-admin-labels.ts`, six `navigation` entries and the status flip to `active`, 218 catalogue entries in `locales/en.po` / `id.po`, the coverage ledger down to seven keys, and `APP_BUDGET_BYTES` raised by the 11,259 B of the seven new script files. No migration, no API change. Tests: `tests/admin-booking-page-contract.test.ts`, the navigation registry, `tests/e2e/admin-booking.e2e.ts` (keyboard-only, every action), and the booking screens in `a11y-axe.e2e.ts` and the 360 px sweep.                                                                                                                                                                                                                                                                                                                                                        |
| **Reminders**        | #943  | The job `booking:reminders:dispatch` (§7.5) over `booking-reminder-dispatch.ts` / `booking-reminder-job.ts`, the intents table `sql/284` and the three narrow reads of `sql/285`, the `BookingReminderRecipientPort`, the templates `booking.confirmation` / `booking.reminder`, handed to `whatsapp_delivery` through `WhatsappDeliveryPort`. Inert until a deployment registers a recipient resolver.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

**Still design (not in the code):** the `extend` route of §5.1; `service_requirements` (`staff_assignments` exists since #949, §10.3, without a `staff_role`) and the full T8 matrix (its concurrency half is in `booking-staff-availability.integration.test.ts`); the
`reservations/reconciliation` route; the screens for reservation create / reschedule / override, availability, notes and reports (§3.0.3 says why each is absent).

**Seams the next slices attach to**

- `placeHold` (`application/booking-hold-service.ts`) is the CLAIM. It checks
  claim integrity (offering and resources exist and are in the claim's mode (slot, or stay when `stay` dates are sent), party size,
  unit count, derived interval, clamped hold on the database clock, hold caps)
  and leaves **policy** to the create handler: opening hours
  (`OUTSIDE_SCHEDULE`), lead time and horizon, and whether
  `reservations.override` lifts them. The handler evaluates those with the same
  engine the search uses (`answerAvailability`) before calling it.
- `claimUnits` (`application/booking-allocator.ts`) takes a `UnitClaim` union
  with three members: `time` and `stay` share the free-unit loop (the stay
  member reads and inserts `stay_from` / `stay_to`), and `block` inserts the
  FIXED units of a block, in `(resource_id, ordinal)` order, all-or-none, under
  the same stay constraint.
- `reclaimExpiredHolds` takes a `ReclaimWindow` union with two members: `time`
  probes `tstzrange` overlap, `stay` probes `daterange` overlap (used for stays
  and for blocks).
- Confirm, cancel and reschedule (#941) write exactly one history row per
  transition, in the same transaction; the expiry primitive (`applyExpiry`) was
  the model. A trigger that ties a status change to its history row is still not
  built.

**Decisions taken in the #939 slice**

- **The reaper runs as `awcms_worker`, through one narrow SECURITY DEFINER
  function** (`sql/200`, the `sql/142` / ADR-0090 pattern), like the other
  scheduled jobs. A worker with `UPDATE` on reservations could also confirm and
  cancel, so it holds no privilege on the booking tables at all: it may
  `EXECUTE` `awcms_booking_expire_due_holds(tenant, batch)`, whose statements
  are fixed (only `status = 'expired'` on a hold that has run out on the
  database clock, only the literal release reason, only the `expired` history
  row, no actor) and which refuses a tenant that is not the session's. It
  selects `FOR UPDATE SKIP LOCKED` and never waits on a request. Lazy reclaim
  stays application SQL in the claim's own transaction (as the application
  role), waits for the row lock (it must know the answer), and locks in
  ascending `reservation id` order. The two implementations of one end state are
  compared by an integration test.
- **Lazy reclaim is scoped to the claim**: it expires only the elapsed holds
  whose live allocations overlap the claim's occupied range on the target
  resources, so a busy resource does not turn every new hold into a tenant-wide
  sweep. It runs before the claim's savepoint, so the expiry stands even when
  the claim is then refused. It works in batches until a batch locks nothing
  (a `LIMIT ... FOR UPDATE` that waited on a row another transaction changed
  drops it without back-filling, so "fewer rows than the limit" does not mean
  done) and advances a keyset cursor, so it never truncates and the locks stay
  in ascending id order.
- **The free-unit read is a hint, the constraint is the authority**: a stale
  read costs at most one extra round (bounded at 6, then `CONTENTION_RETRY`),
  never a double booking. Refusals are values, and the whole claim runs in a
  savepoint so a refusal leaves no reservation, item or allocation behind.
- **Reaper health** is read from the data (`hold_overdue_unswept` and
  `reaper.oldestOverdueSeconds` in the reconciliation, 300 second grace) and
  from the shared job runner's telemetry; nothing depends on it.
- **N4 settled in #941: the hold caps have a safe default.** `NULL` in the
  settings is now the module default, not unlimited: **5 live holds per customer
  and 500 per tenant** (`POLICY_DEFAULTS`). The reasoning: a hold occupies
  inventory with no payment behind it, so the number one actor can hold is the
  lever against hold flooding. Five is generous for a person comparing dates and
  small for a script; 500 is the number of checkouts in progress at one instant
  (holds last minutes) that a busy property does not reach and that bounds what one
  hostile caller can take out of sale. Too low turns a legitimate burst (a flash
  sale, a class that opens at noon) into `429 HOLD_LIMIT_EXCEEDED` for honest
  customers; too high lets one caller hold the shelf. A walk-in hold with no
  customer reference is bounded by the tenant cap only, and an `immediate`
  confirmation is not a hold. The numbers are per-tenant settings columns
  (`max_active_holds_per_*`, at least 1; a tenant that wants no practical cap sets
  a very large number); the policy route that writes them (`PUT /policy`,
  `policy.configure`) arrived with Issue #1030. **Every hold-creating path must still take the same per-tenant
  advisory lock** (`pg_advisory_xact_lock(hashtextextended('awcms_booking.holds:' || tenant, 0))`
  in `enforceHoldCaps`) before it counts live holds: the future `extend`, a
  series, an adapter route. A path that creates a hold without that lock reopens
  the race the cap test closes.

**Decisions taken in the #940 slice**

- **A stay is claimed through the same `placeHold`**, with `stay: { checkInDate,
checkOutDate }` instead of `startsAtMs` (exactly one of them). A client never
  sends an instant, an end or a buffer for a stay. `deriveStay`
  (`domain/booking-stay.ts`) applies the checks of `evaluateStay` in the same
  order and a test asserts the two agree on a table of cases, so a stay that
  availability offered is one the claim accepts. "Today" is the database clock's
  local date in the resource's zone (the same JS zone code availability uses, so
  the module has one reading of a zone).
- **A pool of stay resources must agree on one zone and one pair of check-in /
  check-out times** (`STAY_POOL_INCONSISTENT`), because an item snapshots a
  single set; the alternative, snapshotting the first resource's by accident,
  would make the dates mean different things on different units.
- **A block takes one row per unit, including inactive units**, in
  `(resource_id, ordinal)` order inside a savepoint: a unit that is not won is
  `BLOCK_CONFLICT` for the whole block and the savepoint rolls back the block row
  and the units already won. Trade-off: a block over a whole resource is refused
  because of one booked room (the operator blocks the other rooms by naming
  them), in exchange for a block that is never partial.
- **Overlapping blocks are refused**, because they are rows under the same
  constraint. The alternative (exempting block-against-block) needs a third
  constraint or a trigger, and two overlapping reasons for one night are
  recoverable by releasing and re-placing.
- **Releasing a block is a database invariant, not a handler step**: the AFTER
  UPDATE trigger of `sql/204` releases its rows in the statement that stamps the
  block, and the allocation update guard refuses to release a block row any other
  way. Releasing a released block is a replay and writes nothing.
- **`BLOCK_CONFLICT` cancels nothing and writes nothing** (no block row, no
  allocation, no audit row). The conflicting reservations (number, status, dates;
  never a customer reference) are returned only when the caller asks
  (`revealConflicts`, which a route sets from `reservations.read`), so a caller
  without it learns that nights are taken, not by whom.
- **Availability keeps reading the blocks table** so its answer can say
  `BLOCKED`; the stay read therefore excludes block rows (`block_id IS NULL`),
  otherwise every block would be counted as a booking and the reason would
  degrade to `NO_UNIT_AVAILABLE`.
- **Lazy reclaim is kind-aware.** A slot claim never reclaims a stay hold and
  the reverse; a block reclaims the stay holds that overlap its nights, so an
  elapsed unswept hold does not refuse a block and the reaper being stopped does
  not matter. The reaper (`sql/200`) needed no change.
- **Not decided here (and not needed):** a block may begin in the past (there is
  no "today" rule for a block); the block routes and their `Idempotency-Key`
  belong to the route slices, where the state check (a second release is a
  replay) and the constraint already make a retry harmless.

**Decisions taken in the #941 slice**

- **The cap is checked after the claim, not before.** The advisory lock is held
  until commit, so taking it first would serialise every hold of a tenant before
  the exclusion constraint saw them, and T2 would then prove the lock rather than
  the constraint. Checked after the units are won (inside the claim's savepoint,
  counting the hold just inserted, so "over" is a count above the cap), contenders
  for the same units still race at the constraint and only the winners queue on the
  cap. Trade-offs: the winners of one tenant queue on the lock until their
  transactions end (throughput of hold creation is bounded per tenant, never across
  tenants), a claim over the cap briefly wins and then loses its units with the
  savepoint, and a capped caller asking for a taken slot is told
  `SLOT_UNAVAILABLE`, not `HOLD_LIMIT_EXCEEDED`. There is no deadlock: the lock
  holder has finished every insert that could wait on another transaction.
- **The two mutation checks (T7, T13) use `immediate` offerings.** They keep
  claim A uncommitted while claim B runs, to prove the constraint is what stops
  B. A held claim now queues B on the cap lock after the claim (by design), so
  with the constraint dropped B would wait for A's commit; a confirmed reservation
  takes no cap lock, and the constraint-present premise tests (T1, T9, the
  `DO NOTHING` interleaving) are unaffected because B blocks on the allocation
  row before it ever reaches the cap.
- **The sweep returns what it expired.** `awcms_booking_expire_due_holds` changed
  its return type (`sql/209`; the old function is dropped, `sql/200` is untouched)
  so the job can publish `expired` in the same transaction without the worker
  reading the booking tables. Alternative rejected: a worker-readable "facts"
  function over arbitrary reservations, which would let a compromised worker read
  the external references of every reservation.
- **One facts function, not three payload builders.** An event may carry only
  what `awcms_booking_reservation_event_facts` returns; the customer reference and
  the note are not columns it reads, so no handler can leak them into an event by
  accident. A test asserts the key set and that no key names a person, reason,
  actor or amount (the envelope still carries `actorTenantUserId`, as every
  module's events do; the PAYLOAD has no actor).
- **The state check is the second idempotency layer, per verb, by target state.**
  Confirm on `confirmed`, cancel on `cancelled`, check-in on `checked_in`, check-out
  on `completed`, no-show on `no_show` return `replayed: true` and write nothing
  (no history, audit or event row), with any key. Reschedule on `rescheduled`
  replays only when the request matches the replacement; otherwise `INVALID_STATE`.
  A confirm of an `expired` reservation is `HOLD_EXPIRED`, not `INVALID_STATE`.
- **A client-supplied correlation id is not trusted to be a uuid.** It arrives in a
  header as any string; the history table's column is `uuid`, so it is written only
  when it parses as one (audit and events keep the string).
- **`externalRef.id` is refused if it looks like a credential.** The outbox
  refuses a payload with a credential-shaped value and the reference rides every
  event; refusing it at the door is a `400`, not a `500` after the claim is won.
- **No-show grace default is 15 minutes** (`no_show_grace_seconds`; for a stay the
  arrival instant plus the grace), a number this slice had to pick because the pack
  left it open. A property that holds a room until evening raises it.
- **`GET /reservations` and `GET /reservations/{id}`** were added beyond the issue's
  verb list because the access matrix of §6 names `reservations.read` and a screen
  (#942) cannot be built without them. They never return the note.
- **Same-key requests are serialised by an advisory lock.** The idempotency store
  is keyed on `(tenant, scope, key)`; the acting user is only in the request hash,
  so another user reusing a key gets `409 IDEMPOTENCY_CONFLICT`. Without a lock,
  two concurrent requests with one key both found nothing and both claimed, and the
  loser could be refused (`SLOT_UNAVAILABLE`, `HOLD_LIMIT_EXCEEDED`) by the
  winner's uncommitted booking: a retry told its own booking conflicts. Both the
  routes and the port now take `pg_advisory_xact_lock('idem:' || tenant || scope
|| key)` before the lookup, so the second request waits for the first to commit
  and replays its stored response (tested with capacity 1: five concurrent
  requests, five `201`s, one body). The port additionally runs produce-and-save in
  a savepoint and answers a lost save race with the winner's outcome.
- **The clock is read after the row lock.** `lockReservation` locks, then reads
  `clock_timestamp()` in a second statement, so a confirm that queued behind
  another writer judges "elapsed" at the instant the `held -> confirmed` trigger
  will, and is `HOLD_EXPIRED`, never a trigger error (tested with a hold that
  elapses during the wait).
- **Out of scope and recorded:** the `extend` route. The tenant-facing way to
  change the hold caps and the no-show grace is `PUT /policy` (Issue #1030, §3.0.2).
  The no-show grace default (15 minutes) is a module default, tunable per tenant
  through the same settings row.

**Decisions taken in the #944 slice**

- **Counters over the event table, quantities stamped at write time.** The alternative, summing the allocation rows at report time, would be a live query again and would not survive the projection contract: an allocation row changes (`released_at`), the history row does not. Stamping the quantity on the append-only row makes the rebuild a pure re-scan.
- **The trigger reads the allocation rows, which still exist after a release.** A release therefore carries exactly what its confirmation booked, and a reschedule books the replacement and releases the original, so `booked - released` is the live total.
- **The backfill disables the append-only trigger for one statement** inside the migration's transaction. It writes only the four new columns from the same rule as the trigger.
- **Occupied includes `completed`, excludes `no_show`.** The recorded O8 answer says `confirmed` or `checked_in`; a lived stay must still count on the nights it was lived, so `completed` is added. `no_show` keeps its allocation but nobody used the unit. Both choices are stated in the OpenAPI description and the order of the statuses is one constant (`OCCUPYING_STATUSES`).
- **The occupancy denominator is every unit active now.** Unit history is not kept (§4), and whether a closure leaves the denominator is still open (O8), so `blockedUnitNights` is returned beside the rate.
- **Utilization uses booked, not actual, time**, also still open under O8.
- **Day windows are fixed to Asia/Jakarta** (the report time zone of the epic), not the resource's zone; a stay's nights are dates and need no zone.
- **No `reporting` dependency was declared.** The engine reads descriptors through `listModules()`; a tenant without `reporting` simply never refreshes them.
- **Not built:** a per-day breakdown of the reservation-flow report, and the customer-retention KPI (a cross-domain analytics figure, §7.2).

**Decisions taken in the #1030 slice**

- **Pool membership is the resource's `poolId`, and pools take the `resources.*` permissions.** The catalogue (`sql/181`) describes `resources.*` as "a resource or a resource pool", so no new permission was invented. A pool has no member list to write: moving a resource is a `PATCH` of the resource.
- **Capacity grows, never shrinks.** A unit is the anchor of the exclusion constraints and cannot be deleted, so "remove a unit" does not exist; deactivating one takes it out of the allocator's candidates while its history stays. A resource-wide block covers a unit added by growing capacity (`sql/240`), tested through the route.
- **`RESOURCE_IN_USE` is narrower than the mode guard.** The database refuses a mode or zone change while ANY live allocation exists (a completed stay keeps its allocation as a fact). Deleting is refused only for a held, confirmed or checked-in reservation or an active block: a resource whose only live allocations belong to completed stays can be deleted. Reasoning: delete must not strand a promise; it must not be blocked forever by history.
- **`PUT /policy` replaces the row and requires every field.** The alternative, merging only the sent fields, makes "send `null` to reset" and "omit to keep" two spellings of one request, and a partial client could not tell which it asked for. The cost is that a client must read before it writes; `GET /policy` returns exactly the writable shape under `policy`.
- **No MFA step-up on `policy.configure`.** ADR-0141 §6 enumerates the payroll permissions that carry `requiresMfaEnrolment` and says flagging a routine permission is a lockout the tenant did not choose. The policy change is high-risk (critical audit, idempotent, SoD-addressable) but not flagged; flagging it later is a one-line descriptor change plus the two tests ADR-0141 §6 requires.
- **`includeDeleted` needs `.restore` as well** (the ADR-0128 rule of §6, the `hr-workforce` precedent), and a deleted row read by id **or targeted by a delete or an update** (the repeated-delete replay, the `*_DELETED` refusal) is the neutral `404` for anyone without it, so the permission split cannot be used to learn that a row exists.
- **The timestamps of a DTO are UTC ISO strings with microseconds** (the shared keyset formatter), so a list cursor and the `createdAt` a client sees are the same text.
- **Lists are newest-first keyset pages**, like every other booking list; a screen that wants the `sortOrder` presentation order sorts the page it holds (`sortOrder` is on every row).

**Decisions taken in the #942 slice**

- **One page per area, six sidebar entries, no tabs.** Each area has its own permission and its own entry guard, so a user who may only read the policy sees one entry, and the navigation registry's rule (a real page and a seeded, enforced `requiredPermission` per entry) is met entry by entry. The alternative, one `/admin/booking?view=` page like `/admin/procurement`, would have made a 3,000-line file whose entry permission is the weakest of six.
- **Reservation detail as `?id=`, not `reservations/[id]`.** The render sweep requires a link to a dynamic route's real id on its parent page, and a fresh tenant has no reservations; a failing sweep on an empty tenant is the correct reading of an orphan route, so the detail is a view of the page that always exists.
- **Resource names come from `resources.read`.** A reader of reservations who may not read resources sees a dash instead of the name, never an id or a refusal: the permission split is honoured on screen as on the API.
- **The policy form sends all ten fields every time.** `PUT` replaces the row (§3.0.2); the form shows what the tenant set and, beside each blank field, the default in force, so "blank" is never read as "unlimited".
- **Reschedule, create and override stay off the screens.** Each needs a date and resource picker that mirrors availability; building a second, divergent copy of the availability rules in a page is exactly what "no business logic in the page" forbids. The seven permissions they and the other unscreened reads need stay on the shrink-only coverage ledger.
- **The asset budget was raised by the measured amount (twice: the second time for the review fixes).** The seven script files total 11,259 B (1,153 B of it the shared sender); see the ledger comment in `scripts/client-asset-budget.ts`. No stylesheet grew.
