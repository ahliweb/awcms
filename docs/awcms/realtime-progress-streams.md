🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](realtime-progress-streams.id.md)

# Realtime progress streams — operations

Issue [#1171](https://github.com/ahliweb/awcms/issues/1171), decided by
[ADR-0154](../adr/0154-realtime-progress-is-sse-first-on-the-existing-bun-process-reading-durable-state-websocket-not-admitted.md).

## What exists

- **Transport:** Server-Sent Events from the existing Bun process
  (`bun ./dist/standalone-entry.mjs`). No second listener, no second port, no
  WebSocket, no Socket.IO, no Node process.
- **Two admitted topics.** `whatsapp.sender.progress` is first; `inbox.status.progress` is below it.
- **Topic `whatsapp.sender.progress`:** — the delivery progress of
  one tenant-owned WhatsApp sender, projected from `awcms_whatsapp_messages`.
  - Stream: `GET /api/v1/whatsapp/senders/{id}/progress/stream`
  - Snapshot and polling fallback: `GET /api/v1/whatsapp/senders/{id}/progress`
  - Permission: `whatsapp_delivery.progress.read` (seeded by `sql/360`)
  - Screen: the progress panel on `/admin/channel-accounts/{id}` for a WhatsApp
    sender.
- **Topic `inbox.status.progress`:** the omnichannel inbox's live work counts
  (open, pending, awaiting a reply, unassigned, SLA breached), projected from
  `awcms_inbox_conversations`. It is a **hint**: per changed conversation only
  its id, status and time; the page re-fetches the list through the authorized
  REST read. No source reference, assignee, tag, body or customer identifier is
  streamed. Only ACTIVE work is counted (open or pending), so a tick costs what
  the work in progress costs, not what the retention window holds.
  - Stream: `GET /api/v1/omnichannel-inbox/progress/stream`
  - Snapshot and polling fallback: `GET /api/v1/omnichannel-inbox/progress`
  - Permission: `omnichannel_inbox.status.read` (seeded by `sql/413`, which also
    adds the keyset and active-work indexes on `awcms_inbox_conversations`)
  - Visibility is the conversation list's: a scope-confined caller sees only
    the business scopes they cover and never a tenant-wide conversation. The
    conversation ids in a frame are further limited to what the caller could
    list (`omnichannel_inbox.conversations.read`); a `status.read` holder
    without it gets counts only. The per-scope decisions of a tick write no
    decision-log row (one row per tick, not 1 + N). Off
    (`OMNICHANNEL_INBOX_ENABLED` unset) is `404`. There is no path parameter;
    the resource is always the caller's own view of their tenant's inbox.
  - No admin screen consumes it yet: the inbox screens render server-side and
    poll nothing today.
- **Not built:** a campaign topic (no campaign entity exists) and
  cross-channel per-message status. Each is added to
  `src/modules/_shared/realtime-topics.ts` in the change that builds its source
  rows. WebSocket stays outside ADR-0154 (a later ADR admits it).
- **Cross-instance wake-up hint (built, `sql/418`):** see
  [Cross-instance wake-up](#cross-instance-wake-up) below. It shortens the wait
  before a stream's next tick; it is never a source of truth.

A stream is a **projection of committed rows**. It never sends, enqueues or
changes a status. It is not a delivery receipt and it is not durable push: a
closed or backgrounded tab receives nothing (use Web Push for that, ADR-0074).

## Behaviour an operator can rely on

| Property                | Value / rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Re-authorization        | Every 5 s (the tick). A permission removed mid-stream, or an expired session, ends the stream with `authorization-revoked` on the next tick, and writes a `realtime_stream.revoked` audit row (severity `warning`). Where a topic's visibility is a set of rows (`inbox.status.progress`), a business-scope change does not end the stream and takes effect on the next tick: swapping to another scope narrows the frames to it, but removing the caller's LAST scope ends their confinement, so a tenant-wide role then sees the whole tenant (the conversation-list rule). To cut access, revoke the permission or role, which ends the stream. |
| Origin                  | A present `Origin` that is not the request's own origin or `APP_URL`'s origin is refused with `403 ORIGIN_REFUSED` before any work. Applies to `push/stream` too.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Not visible = not found | An unknown, malformed, cross-tenant or hidden sender id answers `404` and opens no stream.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Cursor and resume       | Every data event has `id: <cursor>` (a `(updated_at, id)` keyset position computed by PostgreSQL). `EventSource` sends it back as `Last-Event-ID`. A malformed, foreign or purged cursor, or more than 50 changes at once, gives `snapshot-required` and the client re-reads the snapshot.                                                                                                                                                                                                                                                                                                                                                         |
| Lifetime                | 10 minutes, then `stream-expired`; the browser reconnects with its cursor and loses nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Heartbeat               | A `: hb` comment after 15 s without a frame.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Database refusal        | The stream ends with `stream-error`; the client backs off with jitter. There is no per-connection retry loop.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Caps                    | Per actor, per tenant and per instance; over a cap the answer is `429 STREAM_CAPACITY_REACHED` with `Retry-After: 30`, never a queued stream.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Slow consumers          | A client whose unflushed bytes stay above the threshold for the grace period is sent `slow-consumer` and its connection is dropped. While it is behind, no frame is written and no read is made.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

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

`sql/413` builds two indexes on `awcms_inbox_conversations`, also without
`CONCURRENTLY` and with the same SHARE lock. That table holds one row per
customer conversation inside the retention window (thousands, not millions), so
the wait is short; a deployment with the inbox off builds them over zero rows.

## Configuration

All optional. Unset or invalid falls back to the default; `bun run
config:validate` refuses a malformed value.

| Variable                                    | Default  | Meaning                                                                           |
| ------------------------------------------- | -------- | --------------------------------------------------------------------------------- |
| `REALTIME_SSE_MAX_CONNECTIONS_PER_ACTOR`    | `4`      | Open streams one person may hold on one instance.                                 |
| `REALTIME_SSE_MAX_CONNECTIONS_PER_TENANT`   | `100`    | Open streams one tenant may hold on one instance.                                 |
| `REALTIME_SSE_MAX_CONNECTIONS_PER_INSTANCE` | `500`    | Open streams one instance holds, all tenants.                                     |
| `REALTIME_SSE_SLOW_CONSUMER_BYTES`          | `262144` | Unflushed bytes above which a client counts as behind.                            |
| `REALTIME_SSE_SLOW_CONSUMER_GRACE_MS`       | `15000`  | How long a client may stay behind before it is evicted.                           |
| `REALTIME_WAKE_HINT_ENABLED`                | `false`  | `true` starts the LISTEN/NOTIFY wake-up hint (also needs the database switch).    |
| `REALTIME_LISTEN_DATABASE_URL`              | unset    | Optional direct connection string for the listener (PgBouncer). Secret; web only. |

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

## Cross-instance wake-up

**Off by default, on both sides.** Turn it on only after measuring in the target
environment (see "Measured cost" and "Turning it on").

A stream re-reads PostgreSQL on its own tick, so it is already correct on any
number of instances. What a replica cannot know is that **another instance** (or
a worker job) just committed a change. `sql/418` lets the writer say so, with no
new service (no Redis, no broker):

- Row triggers on `awcms_whatsapp_messages` (INSERT and a **status** change; a
  lease renewal or other bookkeeping update does not notify) and
  `awcms_inbox_conversations` (INSERT and a change to a column the counters
  read) call `pg_notify('awcms_realtime', '{"t":"<tenant id>","k":"<topic>"}')`.
  The payload is **only a tenant id and a topic name**: no row id, no field of
  the row, nothing personal, about 90 bytes against PostgreSQL's 8000-byte
  limit. The notification is delivered **at commit** (a woken stream reads
  visible data; a rolled-back write notifies nobody). Identical payloads inside
  **one** transaction collapse into one; **across transactions they do not**.
- Each process holds **one** `LISTEN` connection (not one per client), started
  on the first stream open, as the application role (or `REALTIME_LISTEN_DATABASE_URL`).
  It is not drawn from the request pool and it **refuses a SUPERUSER or
  BYPASSRLS login for good** (loud log,
  `realtime_wake_listener_events_total{state="refused"}`; streams keep polling).
  A second, pooled backend carries the liveness ping below.
- A hint wakes only the streams of **the same tenant and topic** on that
  instance; the woken stream runs its ordinary tick (fresh transaction,
  authorization, resource visibility, read from its cursor). The hint grants
  nothing; the tenant filter and authorization stay on the server, not in the
  payload.
- **Not a herd.** Waking N streams in one loop asks the `realtime_stream` work
  class (3 slots, queue 12) for N transactions at once, and a refusal used to
  end the stream (measured: 485 of 500 refused). So the hub releases each woken
  stream after its own random delay inside a window of 20 ms per extra stream,
  capped at 2 s (`wakeAll` after a reconnect spreads across **all** streams of
  the process), and a tick a hint asked for that the database refuses (queue
  full, pool, breaker) **degrades to the timer** instead of ending the stream. A
  refusal on the timer's own tick still ends it, as before.
- **Durability never depends on it.** If the connection drops, the listener
  closes the client, reconnects with exponential jittered backoff (500 ms up to
  30 s) and, once back, wakes every stream: each reads from the cursor it
  already holds (`Last-Event-ID` semantics), so a hint sent while it was down
  costs latency, not data. A lost, forged or duplicated hint costs latency or
  one redundant read.
- **Liveness.** A half-open socket delivers no close event. Every 15 s the
  process NOTIFYs itself on `awcms_realtime_ping` and expects to see
  notifications keep arriving; after 3 silent intervals it rebuilds the
  connection (`realtime_wake_listener_events_total{state="down"}`, log detail
  `liveness`), so `realtime_wake_listener_up` does not report a dead socket as
  up. The same ping samples `pg_notification_queue_usage()`.
- **Not attempted** when `REALTIME_WAKE_HINT_ENABLED` is not `true`, or under
  `DATABASE_PGBOUNCER=true` unless `REALTIME_LISTEN_DATABASE_URL` points at a
  **direct** (non-pooled) connection (a session `LISTEN` does not survive
  transaction pooling). Streams then poll; nothing else changes.

### It does NOT reduce load; it raises it, with a ceiling

Without a hint a stream ticks every `tickIntervalMs` (5 s for the shipped
routes: 0.2 ticks/s). With the hint, every commit that notifies can wake it, and
wakes are throttled to one per tenant and topic per 250 ms, so **a busy tenant's
streams can tick up to 4 times a second each** (20 times the polling rate), each
tick a tenant transaction with an authorization decision and the topic's reads.
The caps (default 100 streams per tenant per instance, 500 per instance) bound
that: at most about 100 x 4 = 400 ticks/s per busy tenant per instance, spread
over the `realtime_stream` class. Lengthening the polling tick while the hint is
healthy would cut the idle load, but it needs its own measurement and was not
done. Size the pool accordingly before turning the hint on for a busy tenant.

### Measured cost (one shared machine; indicative, repeat on yours)

Independent review on PostgreSQL 18.7, pgbench, 16 clients: a transaction that
commits a NOTIFY runs at about **2 000 to 3 000 commits/s** against **5 400 to
13 000** without, and the cost is paid with no listener at all (the commit
serialises on the notification queue lock). At a fixed 1 500 tx/s, mean latency
was about 202 ms with NOTIFY against 4 to 37 ms without. These numbers come from
one shared machine and are a ceiling to **re-measure in the target environment**,
not a promise. The triggers are therefore **off by default**, and the writer
cost with the hint off was measured at noise level (a few percent) because the
trigger's `WHEN` clause is evaluated before the function is entered; statement-
level triggers with transition tables were tried and cost about 39% more even
when off (PostgreSQL captures the transition tables regardless of the `WHEN`).

### Turning it on

1. Measure the writer path of the target database with and without
   `awcms.realtime_wake = 'on'` at the expected write rate.
2. `ALTER DATABASE <db> SET awcms.realtime_wake = 'on';` (new sessions only;
   `ALTER ROLE <role> SET ...` for one writer role; `RESET` switches it off, no
   deploy and no restart).
3. Set `REALTIME_WAKE_HINT_ENABLED=true` on the web instances (and, behind
   PgBouncer, `REALTIME_LISTEN_DATABASE_URL`).

Both sides must be on; either one off makes streams poll.

### Operations notes

- **A full NOTIFY queue FAILS WRITERS' COMMITS.** PostgreSQL stops accepting
  commits that notify when the queue (8 GB) is full, which happens when a
  listener stops consuming. `realtime_wake_queue_usage` samples
  `pg_notification_queue_usage()` with every ping and the process logs
  `realtime.wake.notify_queue_high` (at most once a minute) at 0.1. Alert on the
  gauge, find the stuck listening session (`pg_stat_activity`), and switch the
  GUC off if writers start failing.
- **Do not give non-application roles (BI, reporting) a login to this
  database.** Anyone who can `LISTEN` on `awcms_realtime` sees the tenant ids
  and topic names of every commit that notifies; a hint contains no row data, but
  the tenant id is an identifier.
- The channel is writable by any role that can run `pg_notify`, so the payload
  is parsed strictly and a forged one only costs a redundant read.

Tests: `tests/realtime-wake-hub.test.ts` (parse, isolation, throttle, spread)
and `tests/integration/realtime-wake-hint.integration.test.ts` (two listener
connections as two instances, the join race, tenant isolation, payload content,
rollback, default-off and the database switch, no notification for a lease
renewal, 100 streams with one hint and `wakeAll`, a herd released in one breath,
privileged-login refusal, kill-and-reconnect, half-open detection).

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

Wake-up hint metrics: `realtime_wake_hints_total{result}` (`delivered`,
`no_subscriber`, `malformed`), `realtime_wake_listener_up` (gauge, 1 while
listening), `realtime_wake_queue_usage` (gauge, 0 to 1, alert at 0.1) and
`realtime_wake_listener_events_total{state}` (`connecting`,
`down`, `refused`).

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
- **Updates arrive only at the tick, not instantly:** the hint is OFF by
  default (see "Turning it on"); if it was turned on, check
  `realtime_wake_listener_up` (0 means the listener is down or refused; look for
  `realtime.wake.listener` in the log). Streams are correct either way.
- **Existing tenants do not get the permission:** like every permission seed,
  `sql/360` and `sql/413` extend the global catalogue only; run
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
