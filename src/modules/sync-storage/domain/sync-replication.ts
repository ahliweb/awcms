/**
 * Which domain events a sync node may pull (ADR-0077, Issue #477).
 *
 * `POST /api/v1/sync/pull` used to read `awcms_sync_outbox`, a second outbox
 * that nothing ever wrote. That table is gone; the endpoint now reads
 * `awcms_domain_events`, which is this repo's transactional outbox and already
 * has a dispatcher, a DLQ, and replay.
 *
 * ## Why this list is EMPTY, and why that is not the same as "not done"
 *
 * A sync node authenticates with HMAC and is not a session. Handing it every
 * row of `awcms_domain_events` is a widening of access, not a wiring-up: those
 * payloads belong to whichever module produced them.
 *
 * The obvious shortcut — reuse `redactEventPayloadForResponse` — does not work
 * here, and it is worth saying why so nobody tries it twice. That function
 * masks `email`/`phone`/`nik`/`npwp`: exactly the fields a replica needs. It
 * exists for a session-authenticated admin inspecting a dead letter, where
 * masking costs nothing. Replication needs the opposite — a per-event-type
 * PROJECTION declared by the owning module, stating which fields travel.
 *
 * ## The blocker that is not about policy
 *
 * Reading this table by `event_sequence > checkpoint` is NOT SAFE against
 * concurrent writers, and adding an entry below without fixing that would ship
 * silent data loss.
 *
 * `event_sequence` is `GENERATED ALWAYS AS IDENTITY`: assigned at `INSERT`,
 * visible at `COMMIT`. Two overlapping business transactions can therefore
 * commit out of sequence order. A reader that runs in between sees 101, moves
 * its checkpoint to 101, and never sees 100 — permanently, silently, in a
 * protocol whose whole job is not to lose anything. On the old table this was
 * dormant (no writers). Here it is real: seven production call sites across two
 * modules append inside their own business transactions.
 *
 * The repo already solves this correctly, and not with a cursor:
 * `appendDomainEvent` writes one `awcms_domain_event_deliveries` row PER
 * CONSUMER inside the same transaction as the event, so a claimer cannot skip
 * anything — there is no cursor to jump over. Real node replication belongs on
 * that mechanism.
 *
 * So: an entry here is blocked on TWO things, both design work rather than
 * typing — a per-event-type payload projection, and a claim/delivery model
 * instead of a sequence cursor. Until then the route short-circuits on this
 * empty list and never runs a query at all.
 */

/**
 * Event types a sync node may receive. **Empty on purpose** — see above.
 *
 * Adding an entry without the two prerequisites is not a small change: it turns
 * a documented gap into silent, permanent event loss for every node.
 */
export const SYNC_REPLICABLE_EVENT_TYPES: readonly string[] = [];

/** True when a sync node is allowed to receive this event type. */
export function isReplicableToSyncNodes(eventType: string): boolean {
  return SYNC_REPLICABLE_EVENT_TYPES.includes(eventType);
}

/**
 * True when NOTHING is replicable, so the route can answer without querying.
 *
 * Not merely an optimisation: with an empty allow-list the `WHERE event_type =
 * ANY(...)` form would still have to be written, reviewed, and indexed for a
 * predicate that can never match — and a reader glancing at the route would see
 * a cursor scan over `awcms_domain_events` and reasonably assume replication
 * works. The short-circuit keeps the route's behaviour and its policy saying
 * the same thing.
 */
export function syncReplicationIsDisabled(): boolean {
  return SYNC_REPLICABLE_EVENT_TYPES.length === 0;
}
