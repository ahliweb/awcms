# Sync Storage

Offline-first synchronization foundation ported from awcms-mini's proven
`sync-storage` module. Provides HMAC-authenticated node-to-node event exchange
(outbox/inbox), optimistic-concurrency conflict tracking, and an object sync
upload queue with an internal dispatcher. See the skill `awcms-sync-hmac` and
docs `08_sop_operasional_user_guide.md` / `10_template_kode_coding_standard.md`.

## Scope — Outbox/Inbox

- `awcms_sync_nodes` — sync node registration per tenant (`node_code` unique
  per tenant), status active/inactive, checkpoint (`last_pull_sequence`),
  `last_pushed_at`/`last_pulled_at`. Nodes auto-register on first contact.
- `awcms_sync_outbox` — local events available to be pulled by other nodes;
  `sequence` (identity, monotonic) is the checkpoint cursor.
- `awcms_sync_inbox` — events received from other nodes via push, stored with
  status `received` (this foundation has no domain module to actually "apply"
  the events — a derived app processes them).
- `awcms_sync_push_batches` — idempotency ledger keyed
  `(tenant_id, node_id, batch_id)`; a push replayed with the same `batch_id`
  is treated as success without reprocessing its events.
- Endpoints `POST /api/v1/sync/push`, `POST /api/v1/sync/pull`,
  `GET /api/v1/sync/status`.

Schema: `sql/010_awcms_sync_storage_outbox_inbox_schema.sql`.

## Scope — Conflict tracking

- `awcms_sync_aggregate_versions` — server's last-known version per
  `(aggregate_type, aggregate_id)`, used by the generic optimistic-concurrency
  conflict evaluator (no domain knowledge of what the aggregate represents).
- `awcms_sync_conflicts` — immutable conflict records (core facts — node,
  batch, aggregate, conflict type, payload — never change after creation; only
  the resolution columns are filled once, at resolve time). Two generic
  conflict types:
  - `missing_base_version` — the aggregate already has a version
    (`current_version > 0`) but the pushed event carries no `baseVersion`.
  - `version_mismatch` — the sent `baseVersion` differs from the server's
    current version.
- `POST /sync/push` records conflicting events into `sync_conflicts` (not
  `sync_inbox`) and does **not** advance the aggregate version; the response
  adds a `conflicted` count.
- `GET /sync/conflicts` (filter `?status=open|resolved`) and
  `POST /sync/conflicts/{id}/resolve` — unlike the other sync endpoints these
  are **session-authenticated** (bearer token or SSR cookie), not HMAC,
  because conflict resolution is a human decision, not a node action.
  Guarded by `sync_storage.conflict_resolution.read`/`.approve`. Resolving an
  already-`resolved` conflict is rejected with `409`. Resolution is audited.

Schema: `sql/011_awcms_sync_storage_conflict_schema.sql`.

## Scope — Object sync queue

- `awcms_object_sync_queue` — queue of local objects (e.g. receipt/attachment
  files) awaiting upload to object storage. Unique `(tenant_id, node_id,
object_key)` — re-enqueuing the same `objectKey` upserts (not duplicates):
  `local_path`, `checksum_sha256`, `byte_size`, `requires_upload` are updated
  and the row is reset to `status='pending'`.
- `requires_upload` is set from `R2_ENABLED` at enqueue time. Enqueue itself
  never calls the provider — it is a data flag, not a network trigger
  (ADR-0006). The default driver is local (`STORAGE_DRIVER=local`,
  `LOCAL_STORAGE_PATH`); R2 is optional and never required.
- Endpoint `POST /api/v1/sync/objects` — body
  `{ objects: [{ objectKey, localPath, checksumSha256, byteSize }] }`, upsert
  per object, response `{ queued: <count> }`.
- Endpoint `GET /api/v1/sync/objects/status` — the calling node's non-`sent`
  entries (pending+failed), limit 100.
- Pure domain logic in `domain/object-queue.ts`: `verifyObjectChecksum`
  (plain string equality — a checksum is not a secret), `evaluateObjectRetry`
  (exponential backoff `2^retryCount` minutes, capped at
  `OBJECT_SYNC_MAX_RETRY_DELAY_MINUTES=60`, ineligible once
  `retryCount >= OBJECT_SYNC_MAX_RETRIES=5`), and
  `validateObjectSyncEnqueueRequestBody`.

Schema: `sql/012_awcms_object_sync_queue_schema.sql`.

## Authentication differs from other endpoints

The node-to-node endpoints (`/sync/push`, `/sync/pull`, `/sync/status`,
`/sync/objects`, `/sync/objects/status`) are machine-to-machine and do **not**
use bearer token/session. They authenticate via HMAC headers
(`X-AWCMS-Node-ID`, `X-AWCMS-Timestamp`, `X-AWCMS-Signature`,
`X-AWCMS-Signature-Version`) with a single deployment-wide secret from the
environment (`AWCMS_SYNC_HMAC_SECRET`), verified with a timing-safe compare
against a max skew (`AWCMS_SYNC_MAX_SKEW_SEC`, default 300s) for anti-replay.
`X-AWCMS-Tenant-ID` is required for tenant isolation.

### Signature versions (security advisory GHSA-c972-3q5p-g3h4)

- **v2 (canonical)** — `HMAC-SHA256("v2:<tenantId>:<nodeCode>:<timestamp>:<body>")`.
  The tenant and node are **inside** the signed material, so a signature minted
  for one tenant no longer verifies when `X-AWCMS-Tenant-ID` is swapped to
  another tenant. Nodes send `X-AWCMS-Signature-Version: 2`. This is the
  canonical scheme, mirrored across awcms, awcms-mini, and the `awcms-sync-hmac`
  skill. `tenantId` **must be a UUID** and this is enforced at the v2 boundary
  (audit finding L1): because `nodeCode` may contain `:` (schema `node_code
text`), a non-UUID `tenantId` would make the tenant/node boundary ambiguous
  (`v2:A:x:y:…` matches both `tenantId="A", nodeCode="x:y"` and `tenantId="A:x",
nodeCode="y"`). A UUID is a fixed 36 chars with no `:`, so the boundary is
  unambiguous; `computeSyncSignatureV2` throws and `verifySyncSignatureV2` fails
  closed on a non-UUID tenant. The material format is unchanged (`nodeCode` is
  not constrained), so this is transparent to existing nodes.
- **v1 (legacy, VULNERABLE)** — `HMAC-SHA256("<timestamp>.<body>")`, used when no
  `X-AWCMS-Signature-Version` header is sent. Neither tenant nor node is bound,
  so it is **cross-tenant forgeable** and is kept only so already-deployed nodes
  keep working during migration. It is accepted while `SYNC_HMAC_ALLOW_LEGACY`
  is not `false` (env, default allow). **Set `SYNC_HMAC_ALLOW_LEGACY=false` once
  every node has moved to v2 to reject v1 and close the cross-tenant hole
  completely.** The advisory is only fully closed when legacy is disabled AND
  every node is on v2.

Endpoints return `403` when `AWCMS_SYNC_ENABLED` is not `true`, and `403` for
any node whose status is not `active`. First-contact nodes now auto-register
`inactive` (advisory GHSA-c972-3q5p-g3h4) — an admin must approve them via
`PATCH /api/v1/sync/nodes/{id}` (`status: "active"`) before they can push/pull.
This quarantines a forged first-contact node id for another tenant. Nodes
already `active` are unaffected; deactivating a node via the admin endpoint
takes effect immediately across push/pull/status/objects.

## Admin surfaces (session-authenticated)

- `GET /api/v1/sync/nodes` + `PATCH /api/v1/sync/nodes/{id}` — list nodes and
  activate/deactivate/rename (guarded by `sync_storage.node_management.*`,
  audited).
- `GET /api/v1/sync/object-queue` (filter `?status=`, keyset pagination
  `?cursor=`/`nextCursor`) — tenant-wide, all-nodes admin view, distinct from
  the node-scoped HMAC `GET /sync/objects/status`. Guarded by
  `sync_storage.object_queue.read`.
- `POST /api/v1/sync/object-queue/{id}/retry` — manual override of the
  automatic backoff schedule: resets a `failed` entry back to `pending`
  (`pending`/`sent` rejected with `409`). Guarded by
  `sync_storage.object_queue.retry`; audited. It is a nudge to the automatic
  schedule, not a destructive action, so `isHighRiskAction("retry")` is false.

## Dispatcher

`application/object-dispatch.ts` — `dispatchObjectSyncQueue(sql, tenantId,
options?)`, an internal worker (not an HTTP endpoint) invoked by
`scripts/object-sync-dispatch.ts` (`bun run sync:objects:dispatch`), one tenant
at a time. Three-phase pattern required by ADR-0006 (never call a provider
inside a transaction):

1. **CLAIM** — one short transaction flips eligible due rows to a transient
   `sending` status (`FOR UPDATE SKIP LOCKED`), reusing `next_retry_at` as a
   claim lease expiry (no new column). Commits immediately.
2. **UPLOAD** — outside any transaction, calls the `ObjectUploader` resolved
   from the row's `requires_upload`
   (`infrastructure/object-storage-uploader.ts`): `createNoopObjectUploader`
   (requires_upload=false — R2 off / `STORAGE_DRIVER=local`, no network/I/O,
   always succeeds) or `createR2ObjectUploader` (requires_upload=true — real
   upload via Bun's native `Bun.S3Client`, no npm SDK; verifies the local
   file's actual sha256 against the recorded checksum before uploading).
3. **FINALIZE** — a second short transaction per row flips `sending` to `sent`,
   or back to `pending` with backoff (`evaluateObjectRetry`), or to `failed`
   once retries are exhausted.

Naturally idempotent: `sent`/`failed` rows are never re-claimed, and the
destination `objectKey` is itself the dedup key (an S3/R2 PUT to the same key
is an overwrite). A per-provider circuit breaker
(`getProviderCircuitBreaker("object-storage")`) skips claiming
`requires_upload=true` rows while open; `requires_upload=false` rows still run
(they never touch the provider). Every upload is timeout-bounded
(`OBJECT_SYNC_UPLOAD_TIMEOUT_MS`, default 10000). No new OpenAPI/AsyncAPI
contract — the dispatcher is purely internal.

## Belum tersedia

- Automatic application of `awcms_sync_inbox` events to domain tables (this
  foundation has no domain module to apply them — events stay `received`; a
  derived app processes them).
