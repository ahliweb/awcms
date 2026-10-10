🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0135-day-granularity-stays-admitted-into-booking-v1.id.md)

# ADR-0135 — Day-granularity (nightly) stays are admitted into booking v1

- **Status:** Accepted
- **Date:** 2026-10-10
- **Decision maker:** ahliweb
- **Amends:** [ADR-0131](0131-generic-booking-module-admission.md) (§2 gains a second declarative constraint beside the first, §3 gains date intervals beside instants, and the pack's recorded assumption that nightly check-in/check-out stays are out of v1 is withdrawn) — an amendment, not a supersession; everything in ADR-0131 not named here stands
- **Related:** Issue #931; downstream `ahliweb/awcms-one` DoR owner decision O2, answered 10 Oct 2026 ([`aw-business-platform-dor.md`](https://github.com/ahliweb/awcms-one/blob/main/docs/aw-business-platform-dor.md)); [`docs/awcms/booking.md`](../awcms/booking.md) §2.5 (stay time semantics), §3.1 (stay mapping), §4 (data dictionary), §8.1 rule 7 and §8.3 T9–T13 (double-booking and required tests), §11 (O2 and the open sub-questions)

## Context

ADR-0131 admitted `booking` as a claim on a unit of a resource for a **time interval**: every claim is a UTC `tstzrange`, and the pack recorded, as an assumption pending owner decision O2, that "nightly (check-in/check-out day) stays are **out of v1**". On 10 October 2026 the awcms-one owner answered O2: the **first vertical is hotel / villa / rental**, and — because that conflicts with the assumption above — asked for an **upstream scope change** rather than a consumer-local workaround.

A stay is not a long time slot, for reasons that bite at the first customer:

- The unit of sale is the **night**, a calendar concept in the property's own zone. Expressing it as `tstzrange` between two "midnight" instants makes the night count depend on the daylight-saving rules of the zone (a night can be 23 or 25 hours long), and a zone-database update would silently shift what "the night of 5 October" means.
- **Same-day turnover** (guest A leaves on the 12th, guest B arrives on the 12th) is the normal case, not an edge. With instants it needs a fake buffer to mean "the room is free from check-out time to check-in time"; with dates it is simply two adjacent half-open intervals.
- Check-in and check-out **times** (say 14:00 and 12:00) describe when a guest may arrive and must leave. They are information for the guest and the front desk, not part of what must not overlap.
- A property must be able to take a room out of sale for a night or a week (maintenance) in a way that **cannot be double-booked against a guest**.

## Decision

### 1. A resource has a booking mode: `slot` or `stay`

`resources.booking_mode` ∈ {`slot` (the ADR-0131 behaviour, default), `stay`}. A unit of a `stay` resource is claimed only by stay allocations and a unit of a `slot` resource only by slot allocations; a trigger enforces that the allocation's granularity equals its resource's mode, so the two kinds of claim can never contend on one unit and the two constraints below never need to be reconciled. The mode cannot change while the resource has live allocations. Same module, same tables, same state machine, same port, same permissions model — no new module.

### 2. A stay is a half-open local date interval

A stay is `[check_in_date, check_out_date)`: **local calendar dates in the resource's IANA time zone**, inclusive check-in, exclusive check-out. Its **nights** are exactly the dates in the interval; nights = `check_out_date − check_in_date` is date arithmetic, so a daylight-saving change cannot alter it. The occupancy unit is **(unit, night)**. Because the interval is half-open, a stay ending on the 12th and one starting on the 12th do not overlap (**same-day turnover is allowed by construction**). `check_in_date < check_out_date`, and a stay is at most 366 nights (the existing 366-day bound, expressed in dates).

### 3. Check-in and check-out times are configuration, not occupancy

Each stay resource carries a local check-in time and a local check-out time in the same zone (tenant defaults in settings). They are used to derive the arrival and departure **instants** (`starts_at`, `ends_at`), which serve display, the arrival window, lead time, the late-cancellation cutoff, the no-show grace and event payloads. They are **not** part of any overlap test. The derivation uses the RFC 5545 §3.3.5 gap and fold rules already adopted in the pack §2.2, and — as for every reservation — the zone, the local times and the derived instants are **snapshotted onto the item** at creation and are facts afterwards (a later configuration or tzdata change never moves a confirmed stay).

### 4. Double-booking: a second declarative exclusion constraint, on dates

`awcms_booking_resource_allocations` gains a stay form and a second partial constraint beside the one ADR-0131 §2 defined:

```
EXCLUDE USING gist (resource_unit_id WITH =, daterange(stay_from, stay_to, '[)') WITH &&)
  WHERE (released_at IS NULL AND granularity = 'stay')
```

It reuses the `btree_gist` extension and cost ADR-0131 §2 already admitted, the same allocator (first free unit in a deterministic order, `INSERT … ON CONFLICT DO NOTHING RETURNING`, all-or-none for several units), the same lock order, the same lazy reclaim of expired holds, and the same `23P01` handling. A stay stays on **one unit** for all its nights in v1.

**Blocked nights** (maintenance, owner use) are stored as **allocation rows with no reservation**, owned by a `resource_blocks` row, so they share the same constraint. A block therefore cannot overlap a live stay (it is refused with `BLOCK_CONFLICT`, which cancels nothing), and a stay cannot be placed on a blocked night; the loser of a race between a block and a booking is decided by the database, not by a check. A block is a hard exclusion and, unlike a schedule closure, can never be overridden.

**Why a range constraint and not a unit-night ledger** (one row per `(unit, night)` under a plain unique index — the main alternative):

| Criterion                    | Daterange `EXCLUDE` (chosen)                                                                                                    | Unit-night ledger                                                                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Security / RLS               | Declarative, holds for every writer present and future; a constraint check is not subject to RLS, so isolation cannot weaken it | Same guarantee from the unique index, but an N-row claim must be all-or-none across N unique probes and a trigger must keep the rows equal to the item's dates — a second invariant |
| Performance                  | One row and one GiST probe per claim; the same index answers "is this range free" for availability                              | N rows per stay (up to 366) to insert, release and reschedule, and N btree probes; per-night counting is cheaper to read                                                            |
| Simplicity / maintainability | One mechanism, the same as slots (ADR-0131 §2); one test shape; a reschedule is release-one-insert-one                          | A different mechanism from slots; a reschedule touches 2N rows; but plain SQL, and per-night reporting is a `GROUP BY`                                                              |
| Cost                         | Nothing beyond ADR-0131                                                                                                         | No extension, but more rows and more write amplification                                                                                                                            |

The range form wins on consistency with the already-admitted mechanism and on write cost. The ledger's one real advantage — per-night aggregates — is met by reading the allocation ranges (`generate_series` over the stay) or by the projection counters in the pack §7.2, neither of which needs a second source of truth.

### 5. Mapping onto the reservation state machine and events: fields, not new states or events

The state machine of ADR-0131 §5 is unchanged: `held → confirmed → checked_in → completed`, `held → expired`, `held | confirmed → cancelled`, `confirmed → rescheduled`, `confirmed → no_show`. For a stay, `checked_in` is guest arrival and `completed` is check-out; no `checked_out` state is added. The nine provisional events are unchanged and **no event is added**; their payloads gain additive fields (`stays[]` with `checkInDate`, `checkOutDate`, `nights`, `timezone`) and are otherwise as before. Details, including holds, reschedule, no-show and early check-out, are in the pack §3.1.

### 6. What is deferred

Per-night rates and rate plans, date-dependent minimum stay and arrival-day restrictions, room moves inside one stay (a stay is one unit), in-place extension or shortening of a checked-in stay, a `property` entity grouping room types, and channel-manager events for blocks are **not** admitted here; they are recorded as open sub-questions in the pack §11.

## Consequences

- The first vertical (hotel / villa / rental) can be served without a consumer-local booking engine, and the double-booking guarantee is the same declarative one for both kinds of claim.
- **Cost:** one table (`resource_blocks`), a handful of columns on `resources`, `service_offerings`, `reservation_items`, `resource_allocations` and `settings`, one more partial exclusion constraint, three permissions (`blocks.read`, `blocks.create`, `blocks.release`), a few new refusal codes, and five more required regression tests (T9–T13). No new extension, no new module, no new job, no new event.
- **Not built.** Nothing in this ADR creates a migration, an OpenAPI path or an AsyncAPI channel. The provisional events in `asyncapi/provisional/` and `docs/awcms/cross-domain-contracts.md` do not yet list the additive stay fields; the module's phase-1 PR adds them when the events become live.
- ADR-0131's "not admitted in v1" list is unchanged, with this amendment: day-granularity stays are admitted; counted capacity without unit rows, best-fit packing and shared turnaround remain out.
- **Open sub-questions** the owner has not answered are listed in the pack §11 rather than decided here.

## Alternatives rejected

- **Keep stays out of v1 and let the consumer build them locally.** The owner chose this vertical first and asked for the scope change upstream; a consumer-local engine is the per-vertical duplication ADR-0131 rejected, with the hardest correctness property written twice.
- **Model a stay as a `tstzrange` between two midnight instants (or between check-in and check-out instants).** Night count and adjacency then depend on DST and on the configured times, same-day turnover needs a fake buffer, and a tzdata update changes meaning. Dates are the correct domain type.
- **A unit-night ledger.** See §4: valid, but a second mechanism, up to 366 rows per stay, and a second invariant to keep equal to the item's dates.
- **A separate `lodging` module or a hotel-specific module.** The stay is one more granularity of the same claim, allocator, state machine and port; a second module would duplicate all four and force every consumer to choose.
- **Closed or inclusive date intervals (`[check_in, check_out]`).** Same-day turnover would then look like an overlap and every adjacency rule would need a special case; half-open is already the pack's convention for every interval.
- **Making check-in and check-out times part of the overlap test.** It would make availability depend on configuration that changes, and on the zone's DST rules, which is the defect the date form removes.
