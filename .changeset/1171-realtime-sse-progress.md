---
"awcms": minor
---

feat(realtime): tenant-scoped SSE progress streams on the existing Bun process (Issue #1171, ADR-0154). **No WebSocket, no second listener, no Node or Socket.IO process, no second queue.**

**First admitted topic, `whatsapp.sender.progress`:** one WhatsApp sender's delivery progress, projected from `awcms_whatsapp_messages` (never a send path). `GET /api/v1/whatsapp/senders/{id}/progress` is the REST snapshot and polling fallback; `GET /api/v1/whatsapp/senders/{id}/progress/stream` is the `text/event-stream`. Both need the new, separately grantable permission `whatsapp_delivery.progress.read` (`sql/360`, which also adds the keyset index `(tenant_id, sender_account_id, updated_at, id)`), and the sender must be a `channel_accounts` account the caller may see (assignment, business scope): an unknown, malformed, cross-tenant or hidden id is one `404` and opens no stream. Frames carry counts per status and, per changed message, only its id, status and time — never a number, a body, a template, a provider response or an error text.

**Stream behaviour** (`_shared/progress-sse-route.ts`, `_shared/sse-progress.ts`): a present foreign `Origin` is refused (`403 ORIGIN_REFUSED`) before any work; every 5 s tick re-runs the chokepoint AND the account visibility in a fresh transaction, so a role, an assignment, a brand or a session removed mid-stream ends it with `authorization-revoked` and an audit row `realtime_stream.revoked`; every frame has `id: <cursor>` (a PostgreSQL keyset value) and `Last-Event-ID` resumes on any instance, while a foreign, malformed or purged cursor, or more than 50 changes at once, yields `snapshot-required`; counters are coalesced per tick and a quiet tick writes a heartbeat; per-actor, per-tenant and per-instance caps answer `429` with `Retry-After`; a client that stays behind is evicted with `slow-consumer`; the lifetime ends with `stream-expired`. Load shedding ends the stream with `stream-error`.

**Slow-consumer measurement:** measured on Bun 1.4.4, `@astrojs/node`'s `writeResponse` drains a route's stream eagerly, so `desiredSize` never moves while the response buffer grows without bound behind a client that stopped reading. The standalone entry now runs each request inside an `AsyncLocalStorage` scope carrying a probe over the response (`src/lib/server/response-pressure.ts`); behaviour of every other route is unchanged.

**Also changed for the existing `GET /api/v1/push/stream`:** a foreign `Origin` is now refused, and a per-tick abort listener that used to accumulate for the life of the connection is removed when its tick ends.

**Screen:** `/admin/channel-accounts/{id}` shows a delivery progress panel for a WhatsApp sender: server-rendered counts, a manual refresh, polling when the stream is unavailable, the connection state as text, and polite rate-limited announcements. It never calls progress delivery confirmation.

**Metrics** (tenant-aggregate, no identifiers as labels): `realtime_stream_open`, `_opened_total`, `_refused_total`, `_closed_total`, `_frames_total`, `_tick_duration_ms`, `_frame_lag_ms`.

Operator action: run `bun run db:migrate` (applies `sql/360`, forward-only) and `bun run identity-access:permissions:backfill` for tenants that already exist. New optional variables `REALTIME_SSE_MAX_CONNECTIONS_PER_ACTOR` (4), `_PER_TENANT` (100), `_PER_INSTANCE` (500), `REALTIME_SSE_SLOW_CONSUMER_BYTES` (262144) and `REALTIME_SSE_SLOW_CONSUMER_GRACE_MS` (15000); every cap is per instance. Reverse proxies must not buffer `/api/v1/**/stream` and need an idle timeout above 15 s. See `docs/awcms/realtime-progress-streams.md`.
