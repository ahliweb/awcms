---
"awcms": minor
---

BookingPort additions, capability contract `booking` 1.1.0 (Issue #1108, tracking ahliweb/awcms-one#420 item 1). Purely additive: no existing port signature changed.

- `checkIn`, `checkOut` (the module's `complete` transition) and `markNoShow` are exposed through `createBookingPort` over the adapter's existing `transition()`, with the contract of `confirm`: an actor-namespaced idempotency key (ADR-0145), the actor and a `Targeted` reservation. Refusals are returned as `BookingOutcome` values and the same history row, audit row and `awcms.booking.reservation.*` event are written as by the HTTP routes. `BookingRefusal` gains `CHECK_IN_TOO_EARLY` and `NO_SHOW_TOO_EARLY` (previously folded into `INVALID_STATE`).
- `get(tx, { tenantId, reservationId } | { tenantId, reservationNo })` returns `status`, `startsAt`, `endsAt`, `reservationNo`, `holdExpiresAt`, `lineageId`, `supersededById`, `stays[]` and `externalRef` from an explicit column allow-list, with no customer reference, contact or note. Not found is a value.
- `getOffering` and `listOfferings` (keyset paging, limit 1..100) return `granularity`, `confirmationMode` and `status` for live offerings.
- `availability` is an actor-less read for a public booking page: slots or a stay's night and free-unit counts for one offering on one resource, bounded to a 31-day window and 500 slots, with no personal or internal data. No HTTP route is added; the public route, its rate limit and caching belong to the consumer.
- The `booking` key enters `CAPABILITY_CONTRACT_VERSIONS` and `awcms-family-compatibility.yaml` at `1.1.0`. Docs: `booking.md` section 10.1, `cross-domain-contracts.md` section 3, the module README and an ADR-0131 addendum, each with its Indonesian mirror.
