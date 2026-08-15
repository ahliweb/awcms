🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0077-one-outbox-sync-pull-reads-domain-events.id.md)

# ADR-0077 — One outbox: `awcms_sync_outbox` is retired, and `/sync/pull` reads `awcms_domain_events`

- **Status:** Accepted
- **Date:** 2026-08-10
- **Decision maker:** @ahliweb
- **Related:** Issue #477, [ADR-0006](0006-offline-first-sync-outbox.md) (the outbox pattern), [ADR-0034](0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md) (derived application pathway removed), [ADR-0074](0074-push-delivery-is-a-second-outbox.md) (when a SECOND outbox really is justified)

## Context

`awcms_sync_outbox` was born in `sql/010` and **nothing has ever written to it** — not application code, not a trigger, not a migration. `POST /api/v1/sync/pull`, its only reader, therefore could never return anything but an empty list. The opposite direction (`/sync/push` → `awcms_sync_inbox`) works fully.

Issue #477 concluded that the question is not _"how do we fill it"_ but **whether it needs to exist at all**, given that this repo already has a working transactional outbox: `awcms_domain_events`, complete with a dispatcher, a DLQ, and replay.

The answer is no.

## Decision

**The table is retired.** `awcms_sync_outbox` is `DROP`ped, and `POST /api/v1/sync/pull` reads `awcms_domain_events` — the outbox that already exists, is already tested, and already has a dispatcher.

**Replication is a property of the EVENT TYPE, not a property of the table.** `SYNC_REPLICABLE_EVENT_TYPES` (`sync-storage/domain/sync-replication.ts`) is an explicit allow-list, and it **lands EMPTY**. An HMAC-bearing node that receives the entire contents of `awcms_domain_events` is a widening of access, not a wiring-up: its payloads belong to any module, and the existing `redactEventPayloadForResponse` **cannot be reused** for this — it masks `email`/`phone`/`nik`/`npwp`, which are exactly the fields a replica needs, and it is installed on a session-bearing admin surface, not on this path.

So today's behaviour does not change: `/sync/pull` still answers `200` with an empty list. What changes is **why** it is empty. Before, because there was no path; now, because there is a policy, that policy is written down in one place, and changing it is a reviewable change.

### Why the allow-list is empty rather than "filled with one entry to prove the mechanism"

Because the mechanism is **not yet correct**, and discovering that is the most valuable outcome of this issue.

`event_sequence` is a `bigint GENERATED ALWAYS AS IDENTITY`: its value is assigned at `INSERT`, but the row only becomes visible at `COMMIT`. Two overlapping business transactions can therefore commit **out of order** with respect to their sequence. A cursor-bearing reader using `event_sequence > checkpoint` that runs in between the two will see 101, advance the checkpoint to 101, and **will never see 100** — silent, permanent data loss, on a protocol whose whole job is to lose nothing.

That hazard was **dormant** on `awcms_sync_outbox` because it had zero writers. It becomes **real** on `awcms_domain_events`, which is written by seven production call sites in two modules, each inside its own business transaction.

This repo already has the correct answer to that problem, and it is not a cursor: `appendDomainEvent` writes one `awcms_domain_event_deliveries` row **per consumer, inside the same transaction as the event**. The delivery row becomes visible together with its event, so a claimer can never skip anything — there is no cursor to jump over. That is what makes its dispatcher correct.

Serious node-side replication must therefore ride on that mechanism, not repeat the cursor. That design has not been written, and this ADR does **not** pretend to write it. What it does: delete the second table so that design is not born on top of the wrong foundation, and **write down the two traps already found** so they are not found again:

1. **commit visibility** — an `event_sequence` cursor is not safe against concurrent writers; a time-based lag window only moves the bet onto `statement_timeout`, which bounds a single statement and not a transaction;
2. **payload projection** — replication needs a per-event-type projection declared by the owning module, not generic redaction: the existing one masks exactly the fields that need to be sent.

### Why now, and why it is free today

Because `last_pull_sequence` for **every node in every deployment is provably 0**: `pull.ts` writes back `newCheckpoint = sinceSequence` on every call, and `events` is always empty. There is not a single checkpoint that needs migrating when the cursor source moves table.

That stops being true on the first day a producer is switched on. Moving it today costs one `DROP TABLE`; moving it later costs a per-node cross-table sequence mapping.

## Consequences

This repo has **one** transactional outbox for domain events, and the justified exception is still recorded as an exception ([ADR-0074](0074-push-delivery-is-a-second-outbox.md) explains why `push_delivery` may have its own — its dispatcher calls the network, which is forbidden inside the claim transaction).

`awcms_sync_outbox` leaves `BOUNDED_BY_DESIGN` because the table no longer exists; that list is empty again, as it was designed to be.

The migration **refuses** rather than destroys: it counts rows first and `RAISE EXCEPTION`s if it finds even one. The table is provably empty in this repo, but a deployment that somehow has rows deserves to be stopped, not silently cleaned out.
