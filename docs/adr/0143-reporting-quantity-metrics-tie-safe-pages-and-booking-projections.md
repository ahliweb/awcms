🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0143-reporting-quantity-metrics-tie-safe-pages-and-booking-projections.id.md)

# ADR-0143 — The reporting engine sums quantities, never ends a page inside a millisecond, and `booking` contributes three projections

- **Status:** Accepted
- **Date:** 2026-10-15
- **Decision maker:** @ahliweb
- **Related:** Issue #944 (this ADR and its implementation); [ADR-0131](0131-generic-booking-module-admission.md) (the booking module, which named "two projections"); [ADR-0126](0126-generic-multi-location-stock-ledger-module-admission.md) and [ADR-0128](0128-generic-procurement-supplier-receiving-transfer-module-admission.md) (the earlier domain projections and the "monotonic counters only" rule); [`docs/awcms/booking.md`](../awcms/booking.md) §7.2; `src/modules/reporting/README.md`.

## Context

Issue #944 asks `booking` for occupancy, hold pipeline, lead time, cancellation, no-show and utilization projections "registered with the existing reporting engine, no second analytics engine". Two limits of that engine stood in the way, and one earlier decision needed a pointer.

1. **The engine only counts rows.** A `ProjectionCursorMetricRule` adds one per matching source row. "How many unit-nights were booked" is a SUM: a two-night stay on three units is six, and the quantity is not a row count of anything.
2. **The engine can lose rows at a page boundary.** A scan reads `ORDER BY cursor LIMIT n` and resumes at `cursor + 1 ms` (the `Date` precision of the stored cursor). A source that writes several rows in one transaction gives them the same `created_at` (`DEFAULT now()` is the transaction start): booking's `created` and `held` history rows of one reservation are such a pair. When the page ends between them, the second row sits inside the excluded millisecond and is never counted, in the steady state or in a rebuild, and reconciliation reports a mismatch no rebuild repairs. The three sources the engine first wrapped had distinct timestamps, so it needed a coincidence; a multi-row-per-transaction source needs none.
3. ADR-0131 says the module has "two projections". The module now registers three, because the quantity counters split along the time and stay granularities (booking.md §7.2).

## Decision

### 1. `sumColumn`: a metric rule may add up a column instead of counting rows

`ProjectionCursorMetricRule.sumColumn?: string` (`MODULE_CONTRACT_VERSION` **4.5.0**, MINOR: purely additive; omitting it means "count the matching rows", which every existing rule already meant).

- **Increment-only.** A rule with `sumColumn` must have `effect: "increment"`. The metric store clamps at zero, so a decrement of a quantity would desync silently; `reporting:projections:registry:check` refuses the combination.
- **A non-negative safe integer, or the pass throws.** The column must hold a non-negative integer on every source row (a Postgres `bigint` arrives as a string and is parsed). Anything else (negative, fractional, `NULL`, non-numeric, beyond `Number.MAX_SAFE_INTEGER`) throws, the pass's transaction rolls back and the failure is recorded against the projection (freshness `failed` after the configured count). The engine never rounds or coerces a quantity into a wrong number.
- **One definition of the delta.** `domain/projection-metric-delta.ts` (`computeRuleDelta`) is used by the incremental worker and the rebuild; the reconciliation computes the same quantity as `SUM(col)` (or `COUNT(*)`), so reconcile and rebuild cannot disagree about what the correct value is.
- **The identifier is as safe as the other columns:** snake_case, validated in the registry and again where SQL is built.

### 2. The page boundary: a lookahead row, never ending a page inside a millisecond

Both scans (steady state and rebuild) read `limit + 1` rows. The extra row is a LOOKAHEAD: it is never processed. `trimIncompleteTail` (`reporting/domain/cursor-boundary.ts`) then decides:

- fewer than `limit + 1` rows: the source ran out; the page is whole;
- the lookahead is in a LATER millisecond than the page's last row: the page is exactly the `limit` rows it always was (behaviour for distinct timestamps is unchanged);
- the lookahead shares the page's last millisecond: the page drops its trailing rows of that millisecond. The kept rows are strictly earlier than every dropped one, so the dropped rows sit at `>= cursor + 1 ms` and the next pass reads the whole tie group.

**The residual case: `limit + 1` rows inside ONE millisecond.** There is nothing earlier to end on. Keeping the page would skip the rest of the millisecond silently, and dropping all of it would stall the cursor forever. The engine therefore **fails loudly**: the pass throws, the transaction rolls back (nothing is applied, the cursor does not move) and the projection records a failure, which surfaces as freshness `failed` and in the rebuild run's error. The descriptor's `batchLimit` is then raised above the tie group (a `batchLimit` of 2 000 against a millisecond holding 2 001 history rows needs a transaction writing thousands of rows; booking writes at most a handful). It is a configuration fix, not a data loss.

**Follow-up (not built here): a keyset cursor on `(cursorColumn, id)`.** It removes the millisecond pad and the residual case altogether, at the cost of a second cursor column and a migration of `awcms_reporting_projection_cursors`. Recorded as the proper fix; this ADR takes the smaller one that makes the multi-row-per-transaction case correct today.

**Consequence for projections that already exist:** a `cursor_table` projection over a multi-row-per-transaction source (`procurement.*`, `inventory.*` and any other) may have lost rows at page boundaries before this change. Deployments should **rebuild** those projections once after upgrading (`POST /api/v1/reports/projections/{key}/rebuild`); a reconciliation that reports a mismatch is the signal. Projections over single-row-per-timestamp sources (decision logs, identities, sync nodes) are unaffected.

### 3. `booking` registers three projections (amends ADR-0131's "two")

`booking.reservations` (transition counts per kind, `late_cancelled` a subset of `cancelled`), `booking.time` (booked and released service seconds) and `booking.nights` (booked and released unit-nights), all `cursor_table` over `awcms_booking_reservation_events`, read with `booking.reports.read`, every metric a counter that only increases (net is `booked - released`, computed at read, so a rebuild reproduces it). ADR-0131's "two projections" is superseded by this count; the rest of ADR-0131 stands.

The source is the append-only history table, not the nine live domain events: a rebuild is always a table re-scan, so the steady state and the rebuild are the same scan, and the table is written in the transition's own transaction rather than after an outbox dispatcher ran. The quantities are stamped on the row at write time by a trigger (`sql/244`), because the append-only row, unlike an allocation row, never changes. Details and the live report routes: [`docs/awcms/booking.md`](../awcms/booking.md) §7.2.1.

## Consequences

- One optional contract field and one engine behaviour change, both covered by unit tests and an integration test that fails without the boundary fix.
- A source with a pathological millisecond now fails loudly instead of losing rows silently.
- Operators should rebuild existing multi-row-per-transaction projections once after deploying.
- A keyset cursor remains the structural fix and is a recorded follow-up.

## Alternatives considered

- **A second analytics engine or direct SQL aggregates for booking.** Rejected by the issue and by ADR-0126/0128: it forks freshness, rebuild and reconciliation.
- **Counting per-night rows instead of summing (one event row per unit-night).** Multiplies the history table by up to 366 per stay and makes a retained, never-purged table grow with stay length.
- **A `domain_event` projection for booking.** Needs the rebuild-deferral protocol and depends on the outbox dispatcher for a dashboard figure.
- **Always dropping the last millisecond of a full page without a lookahead.** Changes the page size for sources that never tied and delays a lone row by a pass for nothing.
- **Fixing ties by keeping the page whole.** Silently skips the rest of the millisecond; rejected for the loud failure above.
