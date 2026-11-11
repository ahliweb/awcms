🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](realtime-progress-streams.id.md)

# Realtime progress streams — operations

Issue [#1171](https://github.com/ahliweb/awcms/issues/1171), decided by
[ADR-0154](../adr/0154-realtime-progress-is-sse-first-on-the-existing-bun-process-reading-durable-state-websocket-not-admitted.md).

## What exists

- **Transport:** Server-Sent Events from the existing Bun process
  (`bun ./dist/standalone-entry.mjs`). No second listener, no second port, no
  WebSocket, no Socket.IO, no Node process.
- **One admitted topic:** `whatsapp.sender.progress` — the delivery progress of
  one tenant-owned WhatsApp sender, projected from `awcms_whatsapp_messages`.
  - Stream: `GET /api/v1/whatsapp/senders/{id}/progress/stream`
  - Snapshot and polling fallback: `GET /api/v1/whatsapp/senders/{id}/progress`
  - Permission: `whatsapp_delivery.progress.read` (seeded by `sql/360`)
  - Screen: the progress panel on `/admin/channel-accounts/{id}` for a WhatsApp
    sender.
- **Not built:** an inbox topic (the inbox, Issue #1164, does not exist), a
  campaign topic (no campaign entity exists), cross-channel message status.
  Each is added to `src/modules/_shared/realtime-topics.ts` in the change that
  builds its source rows.

A stream is a **projection of committed rows**. It never sends, enqueues or
changes a status. It is not a delivery receipt and it is not durable push: a
closed or backgrounded tab receives nothing (use Web Push for that, ADR-0074).

## Behaviour an operator can rely on

| Property                | Value / rule                                                                                                                                                                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Re-authorization        | Every 5 s (the tick). A role, an assignment or a business scope removed mid-stream, or an expired session, ends the stream with `authorization-revoked` on the next tick, and writes a `realtime_stream.revoked` audit row (severity `warning`).                                           |
| Origin                  | A present `Origin` that is not the request's own origin or `APP_URL`'s origin is refused with `403 ORIGIN_REFUSED` before any work. Applies to `push/stream` too.                                                                                                                          |
| Not visible = not found | An unknown, malformed, cross-tenant or hidden sender id answers `404` and opens no stream.                                                                                                                                                                                                 |
| Cursor and resume       | Every data event has `id: <cursor>` (a `(updated_at, id)` keyset position computed by PostgreSQL). `EventSource` sends it back as `Last-Event-ID`. A malformed, foreign or purged cursor, or more than 50 changes at once, gives `snapshot-required` and the client re-reads the snapshot. |
| Lifetime                | 10 minutes, then `stream-expired`; the browser reconnects with its cursor and loses nothing.                                                                                                                                                                                               |
| Heartbeat               | A `: hb` comment after 15 s without a frame.                                                                                                                                                                                                                                               |
| Database refusal        | The stream ends with `stream-error`; the client backs off with jitter. There is no per-connection retry loop.                                                                                                                                                                              |
| Caps                    | Per actor, per tenant and per instance; over a cap the answer is `429 STREAM_CAPACITY_REACHED` with `Retry-After: 30`, never a queued stream.                                                                                                                                              |
| Slow consumers          | A client whose unflushed bytes stay above the threshold for the grace period is sent `slow-consumer` and its connection is dropped. While it is behind, no frame is written and no read is made.                                                                                           |

### The limit of the change list

`updated_at = now()` is the start time of the writing transaction. A transaction
that started before a tick and committed after it is not reported in that
stream's change list. The **counters are recomputed from the table on every
tick and are always right**; the change list is a hint, and the snapshot is the
authority for an individual message.

### Rows a confined caller sees (security audit M-1)

Seeing a sender is not seeing every row through it. A tenant-wide sender
carries messages of every brand; a caller confined to business scopes sees
through it only the messages whose own business scope they hold (decided every
tick through the chokepoint, descendant scopes included). Counts, change list,
recent list and the first frame's cursor are all filtered; an unscoped message
is invisible to a confined caller, and a `Last-Event-ID` naming a row they may
not see gets `snapshot-required`. An unconfined caller sees every row.

### Request context (audit L-2)

Besides a foreign `Origin`, a request with `Sec-Fetch-Site: cross-site` or
`Sec-Fetch-Mode: navigate` is refused with `403 ORIGIN_REFUSED` before any
work, on both stream routes (`push/stream` too). Absent headers are allowed.

### Cost bounds (audit M-2)

- The connection slot is taken right after the authorization decision and
  before any topic query: a `429` costs one guard chain and nothing else.
- Ticks run on their own work class, `realtime_stream` (3 concurrent, queue
  bounded by `DATABASE_WORK_CLASS_QUEUE_MULTIPLIER`), so open streams never take
  the slots of interactive requests. A full queue ends the stream with
  `stream-error` and the client backs off with jitter.
- Counts cover messages **created in the last 7 days** (`countWindowDays` in the
  snapshot), served by `awcms_whatsapp_messages_sender_window_idx`. Each read is
  one statement; `tests/integration/whatsapp-sender-progress-query-budget.integration.test.ts`
  holds the budget and checks the real statement never scans the table.

## Deploy

`sql/360` builds two indexes on `awcms_whatsapp_messages` **without
`CONCURRENTLY`**: the migration runner wraps each file in a transaction, where
`CREATE INDEX CONCURRENTLY` is impossible (the same constraint `sql/143`
records). A plain `CREATE INDEX` holds a SHARE lock, so enqueues and dispatcher
finalisations **wait** until both builds finish. On a large queue run the
migration in a quiet window, or stop `whatsapp:dispatch` for its duration. Both
indexes are partial (`sender_account_id IS NOT NULL`); a deployment that never
routes through a named sender builds them over zero rows.

## Configuration

All optional. Unset or invalid falls back to the default; `bun run
config:validate` refuses a malformed value.

| Variable                                    | Default  | Meaning                                                 |
| ------------------------------------------- | -------- | ------------------------------------------------------- |
| `REALTIME_SSE_MAX_CONNECTIONS_PER_ACTOR`    | `4`      | Open streams one person may hold on one instance.       |
| `REALTIME_SSE_MAX_CONNECTIONS_PER_TENANT`   | `100`    | Open streams one tenant may hold on one instance.       |
| `REALTIME_SSE_MAX_CONNECTIONS_PER_INSTANCE` | `500`    | Open streams one instance holds, all tenants.           |
| `REALTIME_SSE_SLOW_CONSUMER_BYTES`          | `262144` | Unflushed bytes above which a client counts as behind.  |
| `REALTIME_SSE_SLOW_CONSUMER_GRACE_MS`       | `15000`  | How long a client may stay behind before it is evicted. |

**Every cap is per instance.** With N replicas a tenant can hold up to N times
the tenant cap. The caps bound memory and database load per process; they are
not a statement about the whole deployment.

Each open stream costs one guard chain and three indexed reads every 5 s. At the
per-instance default (500) that is about 100 short transactions per second at
the `interactive` work class; size `DATABASE_POOL_MAX` and the instance cap
together (`docs/awcms/database-capacity-runbook.md`).

## Reverse proxy

- Response buffering **off** for `/api/v1/**/stream` (the route already sends
  `X-Accel-Buffering: no` and `Cache-Control: no-transform`).
- Idle / read timeout **above 15 s** (the heartbeat). 60 s or more is
  comfortable. Measured on Bun 1.4.4: the `node:http` server the standalone entry
  uses did not close a stream that was silent for 25 s, so the heartbeat is for
  the proxy, not for Bun.
- HTTP/1.1 and HTTP/2 both work; no upgrade is involved.
- Do not cache: the response is `private, no-store`.

## Slow-consumer measurement

`@astrojs/node`'s `writeResponse` drains the route's stream eagerly and ignores
the socket's backpressure, so the web stream's `desiredSize` never moves.
Measured on Bun 1.4.4 with a client that stopped reading: the kernel absorbed
about 1 MB, then `ServerResponse.writableLength` grew without bound. The
standalone entry therefore runs every request inside an `AsyncLocalStorage`
scope carrying a probe over the response (`src/lib/server/response-pressure.ts`)
and the stream reads it. Under `astro dev` there is no probe: the buffer is
**unmeasured**, and only the bounded frame size, tick and lifetime limit it.

## Metrics

Tenant-aggregate only; `topic` is a code-defined constant and never a resource
id.

| Metric                             | Type      | Labels           |
| ---------------------------------- | --------- | ---------------- |
| `realtime_stream_open`             | gauge     | —                |
| `realtime_stream_opened_total`     | counter   | `topic`          |
| `realtime_stream_refused_total`    | counter   | `topic`,`reason` |
| `realtime_stream_closed_total`     | counter   | `topic`,`reason` |
| `realtime_stream_frames_total`     | counter   | `topic`,`kind`   |
| `realtime_stream_tick_duration_ms` | histogram | `topic`          |
| `realtime_stream_frame_lag_ms`     | histogram | `topic`          |

Refusal reasons: `origin`, `auth_denied`, `not_found`, `capped_actor`,
`capped_tenant`, `capped_instance`, `unavailable`. Close reasons: `revoked`,
`expired`, `slow_consumer`, `error`, `client`.

## Runbook

- **Many `capped_*` refusals:** check whether one person opened many tabs
  (`capped_actor`) or a tenant is genuinely busy (`capped_tenant`). Raise a cap
  only together with the pool size. The page keeps working on the snapshot
  either way.
- **Many `slow_consumer` closes:** usually a proxy buffering the response. Check
  buffering is off for the stream paths.
- **Many `error` closes:** the database refused (`DATABASE_BUSY` / circuit
  breaker). Treat it as a database capacity problem, not a stream problem.
- **A permission revoked but the user still sees progress:** the stream ends
  within one tick (5 s). A page left open shows "Access ended". If not, check
  `awcms_audit_events` for `realtime_stream.revoked`.
- **Existing tenants do not get the permission:** like every permission seed,
  `sql/360` extends the global catalogue only; run
  `bun run identity-access:permissions:backfill`.

## Adding a topic

1. Implement `ProgressTopic` (`src/modules/_shared/progress-sse-route.ts`) in the
   module that owns the rows, applying the same visibility rule as its REST read
   — to the ROWS, not only to the resource. Any memo or authorization cache it
   (or a helper) keeps must be keyed by `context.request`, which is a fresh
   object every tick; keyed any other way, a revocation never lands.
2. Add the topic to `src/modules/_shared/realtime-topics.ts`, its permission to
   the module descriptor and a seeding migration.
3. Add the snapshot route and a stream route built with
   `defineProgressSseRoute`, both in OpenAPI.
4. `tests/realtime-topics-registry.test.ts` checks the wiring; write the DB
   integration tests the ADR requires (two tenants, two scopes, revocation,
   cursors, caps).

WebSocket stays out until an ADR admits a bidirectional use case under
ADR-0154 section 4.
