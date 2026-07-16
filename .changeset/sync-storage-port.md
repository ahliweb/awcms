---
"awcms": minor
---

Add the sync-storage module: offline-first synchronization ported from
awcms-mini. HMAC-authenticated node-to-node event exchange (outbox/inbox),
optimistic-concurrency conflict tracking, and an object sync upload queue with
an internal dispatcher.

- New migrations `010_awcms_sync_storage_outbox_inbox_schema.sql`,
  `011_awcms_sync_storage_conflict_schema.sql`, and
  `012_awcms_object_sync_queue_schema.sql`: add `awcms_sync_nodes`,
  `awcms_sync_outbox`, `awcms_sync_inbox`, `awcms_sync_push_batches`
  (idempotency ledger keyed `(tenant_id, node_id, batch_id)`),
  `awcms_sync_aggregate_versions`, `awcms_sync_conflicts` (immutable), and
  `awcms_object_sync_queue`. All tenant-scoped tables have RLS tenant-isolation
  policies, FK-covering indexes, and the performance/listing indexes. Seeds the
  `sync_storage` permissions (node_management, conflict_resolution,
  object_queue).
- Node-to-node endpoints (`POST /sync/push`, `POST /sync/pull`,
  `GET /sync/status`, `POST /sync/objects`, `GET /sync/objects/status`)
  authenticate via HMAC (`X-AWCMS-Node-ID`/`Timestamp`/`Signature`,
  `HMAC-SHA256("<timestamp>.<body>")`, timing-safe compare, skew-bounded
  anti-replay), gated by `AWCMS_SYNC_ENABLED`, rejecting inactive nodes with
  403. Push is idempotent per batch; conflicts are recorded immutably.
- Admin surfaces (`GET/PATCH /sync/nodes`, `GET /sync/conflicts` +
  `/{id}/resolve`, `GET /sync/object-queue` + `/{id}/retry`) are
  session-authenticated, ABAC-guarded, and audited.
- Object storage defaults to the local driver (`STORAGE_DRIVER=local`); R2 is
  optional (`R2_ENABLED`). The internal dispatcher `bun run sync:objects:dispatch`
  drains the object queue per tenant with a claim-lease, backoff, circuit
  breaker, and timeout — provider calls happen strictly outside transactions
  (ADR-0006).
- Adds `readTextBody` to the shared request-body reader (raw-body read for HMAC
  verification) and the `retry` action to the identity-access `AccessAction`
  union (not high-risk).
