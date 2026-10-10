🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](booking.id.md)

# Booking — resources, schedules and reservations (module doc pack)

> **Status:** admitted by [ADR-0131](../adr/0131-generic-booking-module-admission.md)
> (Issue #915). **Design only: no module code, migration, OpenAPI path or
> AsyncAPI channel exists yet**, and none is to be written until this pack is
> accepted downstream (`ahliweb/awcms-one` Wave A) and the schema-affecting open
> questions in §11 are answered. PRD-lite, state machine, ERD and data
> dictionary, holds and idempotency, permissions/RLS matrix, reporting and
> events, the double-booking strategy with its required regression test, threat
> and privacy notes, the adapter/port contract and the open questions are in
> one place. Decisions and rejected alternatives are in the ADR. It follows the
> shape of [`inventory-ledger.md`](inventory-ledger.md),
> [`procurement.md`](procurement.md) and [`tax-calculation.md`](tax-calculation.md).
> Event names here are **provisional**; the AsyncAPI channels are added when the
> module is built. Day-granularity (nightly) stays are part of v1 by [ADR-0135](../adr/0135-day-granularity-stays-admitted-into-booking-v1.md) (§2.5, §3.1).

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
  overlap. `start < end` and `end − start ≤ 366 days` are CHECKs (a stay bounds the same 366 in dates, §2.5).
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
`HORIZON_EXCEEDED`, `PARTY_SIZE_OUT_OF_RANGE`, `STAFF_UNAVAILABLE` (409),
`RECURRENCE_UNSUPPORTED`, `TIMEZONE_INVALID`, `IDEMPOTENCY_REQUIRED` (400),
`IDEMPOTENCY_CONFLICT` (409), `PAYMENT_FIELD_NOT_ACCEPTED` (400).

**Late cancellation.** An offering's `cancellation_cutoff_seconds` makes a
cancellation inside the cutoff carry `late_cancellation = true` on the event and
the reservation. The module records the fact; **any fee is a commerce decision**.

**No-show.** Marked by a person, after `starts_at + no_show_grace_seconds`
(policy). An automatic no-show job is off by default and is an open question
(O2/O3).

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
| `resources`            | `code` (unique per tenant among live), `name`, `kind` (short code, e.g. `room`, `chair`, `court`, `vehicle`), `status` (`active`/`inactive`), `capacity int 1..500`, `pool_id` (nullable), `timezone` (IANA; immutable while live stay allocations exist), `booking_mode` (`slot` default / `stay`; immutable while the resource has live allocations, trigger), `stay_check_in_time` / `stay_check_out_time` (local `time` in `timezone`; required when `stay`, NULL when `slot`), `sort_order`, soft-delete stamps                                                                                                                                                                                                                                                    | SELECT, INSERT, UPDATE (no DELETE)                          |
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
| `reservation_events`   | `reservation_id`, `seq` (per reservation), `kind`, `from_status`, `to_status`, `actor_user_id`, `correlation_id`, `reason_code`, `detail` jsonb (closed keys: ids, instants, counts — **no free text, no personal data**), `occurred_at` (DB clock); unique `(reservation_id, kind)` for the once-only kinds; generated `kind` columns for the projections                                                                                                                                                                                                                                                                                                                                                                                                              | SELECT, INSERT (**no UPDATE/DELETE**)                       |

`awcms_worker` holds `SELECT` on `awcms_booking_reservation_events` only (the
reporting engine reads the projection source as that role). The hold-expiry job
runs as the application role under a per-tenant context, like `email:dispatch`.

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

## 6. Permissions and RLS matrix

All routes are `defineTenantRoute`, authorize through `authorizeInTransaction`
(ADR-0063), and are default-deny. The migration seeds the catalogue and grants
**nothing** to any role; existing tenants use
`bun run identity-access:permissions:backfill`. Permission codes are
`booking.<activity>.<action>` (module key `booking`, as `procurement.documents.read`).

| Permission                                                         | Covers                                                                | Risk                  |
| ------------------------------------------------------------------ | --------------------------------------------------------------------- | --------------------- |
| `resources.read` / `.create` / `.update` / `.delete` / `.restore`  | resources, units, pools                                               |                       |
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
| `policy.read` / `policy.configure`                                 | settings (holds, lead time, horizon, grace)                           | high-impact           |
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
whose `lineage_id` chain is broken, and a reservation with no `created` event. For stays it also lists a live stay allocation whose `[stay_from, stay_to)` differs from its item's `[check_in_date, check_out_date)`, a block allocation without an active block (and the reverse), and an allocation whose granularity differs from its resource's `booking_mode`.
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
**Occupancy** (units in use at an instant ÷ units) is a live query.
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

### 7.3 Schedule-conflict report

`GET /booking/schedules/{id}/conflicts?candidate=…` lists confirmed reservations
that fall outside a proposed schedule (or inside a proposed closure) without
changing anything. The same applies to a staff availability change reported by
the workforce capability.

### 7.4 Events (provisional)

Convention (as `awcms.procurement.document.finalised`): channel
`awcms.<module>.<entity>.<verb>`, one shared `DomainEvent` envelope, published
through the domain-event outbox **in the same transaction** as the transition; a
refused or replayed call publishes nothing. The issue's shorthand
`booking.reservation.*` therefore appears on the wire with the `awcms.` prefix.

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

Payload: `reservationId`, `reservationNo`, `lineageId`, `status`, `previousStatus`,
`startsAt`/`endsAt` (RFC 3339 UTC), `resourceIds`, `offeringIds`, `partySize`,
`externalRefType`/`externalRef` (the adapter's own opaque pair), `occurredAt`,
`correlationId`; for a reservation with stay items also `stays` (`resourceId`, `checkInDate`, `checkOutDate`, `nights`, `timezone`; additive, absent otherwise, no new event, §3.1). **Never** a customer name, contact, note or reason text. Consumers
de-duplicate on the envelope's event id; delivery is at-least-once.

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
   no row returned → try the next unit; none left → `SLOT_UNAVAILABLE`. (That `DO NOTHING` waits for an in-doubt concurrent conflicting row and then skips it is the behaviour T3 proves at implementation; if it did not hold, the fallback is a savepoint per attempt catching `23P01`.) A party
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
7. **Stays and blocks** (ADR-0135). A stay allocation is one row per unit under the second constraint of §4 (`daterange(stay_from, stay_to, '[)')` per unit, live rows only). The allocator, lock order, `ON CONFLICT DO NOTHING` absorption, lazy reclaim and bounded deadlock retry of rules 1–6 apply unchanged. A **block** is an allocation row with `block_id` set and no `item_id`, so a block and a stay contend on one constraint: whichever commits first wins and the other receives `23P01`, mapped to `SLOT_UNAVAILABLE` for the booking and `BLOCK_CONFLICT` for the block. A block over several units inserts its rows in the global order of rule 3, all-or-none. Creating a block never cancels a reservation. A trigger rejects an allocation whose granularity differs from its resource's `booking_mode`, so the time and stay constraints never both apply to one unit.

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
consumers depend on the neutral port, never on module code). It _returns_ a
refusal as a value; it throws only for defects. Provisional shape:

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

### 10.4 Module registration (design)

`type: "domain"`; `dependencies`: tenant-admin / identity-access only;
`capabilities.consumes`: workforce availability (optional) (no `profile_identity`: commerce is the customer authority, O12), `reporting` (projections), `domain_event_runtime`
(outbox); status `experimental` until its first admin screen (the navigation
registry requires a real page). Compatibility class: offline-lan-safe.

## 11. Open questions (owner decisions — recorded, NOT decided here)

Mapped to the downstream tracker
[`aw-business-platform-dor.md`](https://github.com/ahliweb/awcms-one/blob/main/docs/aw-business-platform-dor.md).
ADR-0040 settled placement only. The owner answered O1–O12 on 2026-10-10 (recorded downstream in the awcms-one DoR); the rows below say which answers are recorded here (**Answered**) and which are still open here (O1, O3, O5 and O9 were answered downstream the same day but change nothing in this pack and are not yet reconciled into it; O2 is handled by Issue #931). "Blocks" says what in this
pack cannot be finalised until the answer is recorded.

| #       | Question                                                                                                                                   | What this pack assumes meanwhile                                                                                                                                                                                                                                                                                                                                                                                                                                               | Blocks                                                                              |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| **O1**  | Personas in scope                                                                                                                          | The provisional list in §1 (receptionist, manager, resource owner, adapter, auditor)                                                                                                                                                                                                                                                                                                                                                                                           | §6 role bundles and the seed grants; UAT                                            |
| **O2**  | Which verticals come first (hotel/villa, salon, clinic, rental, facility, workshop, training), and whether a consumer builds locally first | **Answered 2026-10-10 (awcms-one DoR):** first vertical hotel / villa / rental; no existing consumer repository. The owner resolved the conflict with this pack's earlier assumption by asking for an upstream scope change: **day-granularity stays are in v1** (ADR-0135, §2.5, §3.1). Still generic: no vertical field. `MONTHLY` recurrence stays out of v1 (not requested). The health-note policy keeps its default (off for tenants that declare a health vertical, §9) | The first admin screens (the migration's final shape); the sub-questions below      |
| **O3**  | MoSCoW across CRM, Booking, Workforce, Payroll, Notification, Analytics                                                                    | Booking is Wave A/B; automatic no-show job and waitlist stay _Could_                                                                                                                                                                                                                                                                                                                                                                                                           | Ordering only; no schema                                                            |
| **O5**  | Legal role of the operator (controller/processor/both)                                                                                     | Neither asserted; design is neutral (§9)                                                                                                                                                                                                                                                                                                                                                                                                                                       | The privacy analysis text, not the schema                                           |
| **O8**  | Occupancy vs utilization, **do holds count**, booked vs actual time, denominator rules                                                     | **Answered 2026-10-10 (awcms-one DoR):** occupancy excludes holds (a hold is a separate pipeline figure); utilization is a separate metric; customer-retention window 90 days (a cross-domain KPI, not a data-retention period); net revenue is the headline (§7.2). **Still open:** whether the denominator excludes maintenance closures; booked vs actual time                                                                                                              | Only the remaining _definitions_; no table                                          |
| **O9**  | Explicit non-goals                                                                                                                         | The §1 list                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Scope wording                                                                       |
| **O12** | Customer identity: commerce stays the customer authority, or `profile_identity` harmonisation                                              | **Answered 2026-10-10 (awcms-one DoR): commerce stays the customer authority.** v1 `reservations` carries only the opaque, nullable `external_customer_ref` (null = walk-in); no `customer_profile_id`, no `profile_identity` dependency. A harmonisation, if ever wanted, is an additive column under its own ADR                                                                                                                                                             | Nothing: the customer columns and the erasure path (§4) are fixed for the migration |

**Open sub-questions raised by the stay design** (not answered by the owner; recorded, not decided; proposed for the downstream tracker):

- **O2a — what "rental" means.** Hotel and villa are nightly. A rental may be per day (covered by a `stay` resource, pick-up = check-in, return = check-out) or per hour (covered by a `slot` resource). Both are supported; confirm which the first rental consumer needs, and whether pick-up/return times differ from the lodging defaults.
- **O2b — a `property` entity.** v1 takes the time zone and the check-in / check-out times from each resource (and tenant defaults). Whether several room types of one property must share them through a `property` entity (and whether pools should carry them) is not decided.
- **O2c — default check-in / check-out times.** The module fixes none; the owner or the first consumer sets the tenant defaults.
- **O2d — amending a stay in place.** Extending or shortening a stay that is `checked_in` (an early departure releasing unused nights, an extension taking the next nights if free) is not specified; v1 supports only reschedule before check-in (§3.1).
- **O2e — room moves inside a stay** and best-fit packing of stays across units (a "sold out" answer that a move would avoid) are out of v1.
- **O2f — date-dependent rules.** Per-night rates and rate plans, date-dependent minimum stay, arrival-day or departure-day restrictions are out of v1 (the minimum is per offering, §2.5).
- **O2g — no-show for stays.** Whether the grace is per offering (and whether a no-show releases the remaining nights after the first) — the existing open question, now concrete.
- **O2h — block events.** Whether a downstream (a channel manager) needs `awcms.booking.block.*` events; v1 emits none.

Also open and _not_ in the downstream tracker (proposed for it): the default and
maximum hold TTL and the per-customer hold cap numbers (§5.1 are placeholders);
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

**Recorded follow-ups (not in v1).** Admin screens (the module is `experimental`
until the first); location/resource-scoped ABAC; counted capacity without unit
rows (would use §8.1 rule 4); partial-accept series; shared turnaround; waitlist;
iCal export; automatic no-show; a retention window with archive-then-purge; `profile_identity` harmonisation of the customer reference (own ADR; O12 kept commerce as the authority);
`MONTHLY` recurrence (O2); the stay follow-ups O2a–O2h (§11); updating the provisional AsyncAPI payloads and `cross-domain-contracts.md` with the additive `stays` field when the events go live; keyed hashing and at-rest
encryption are not applicable (no identifier is stored).
