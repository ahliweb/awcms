# Queue Topology

> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) → [AGENTS.md](../../AGENTS.md) → [docs/dev/edge-functions.md](../dev/edge-functions.md)

## Purpose

Define the Cloudflare Queues topology used by the AWCMS Edge Worker to offload asynchronous background work, decouple long-tail processing from the synchronous HTTP response path, and maintain Supabase as the canonical system of record.

## Audience

- Backend and integration developers
- Operators deploying or monitoring `awcms-edge/`

## Design Principles

1. **Queues are triggers, not authority.** A queue message carries a reference (e.g. `session_id`). The consumer re-reads authoritative state from Supabase before performing any write. The message content is never trusted as a data grant.
2. **Supabase remains canonical.** All tenant isolation, ABAC enforcement, and business data live in Supabase/PostgreSQL. Queue consumers use `SUPABASE_SECRET_KEY` for privileged reads/writes and must respect `tenant_id` and soft-delete (`deleted_at IS NULL`) semantics.
3. **Idempotency is mandatory.** Every message includes an `idempotency_key`. Consumers must check whether work has already been completed before writing.
4. **Additive topology.** Queues are added per capability. New queues are introduced only when a concrete synchronous flow is being offloaded.

## Runtime Boundary

Cloudflare Queues run entirely within the Cloudflare Workers runtime (`awcms-edge/`). No queue logic runs inside Supabase.

## Active Queues

| Queue Name | Binding Constant | Purpose | Status |
|---|---|---|---|
| `awcms-media-events` | `MEDIA_EVENTS_QUEUE` | Media upload finalization after R2 write | Active (Phase 3) |
| `awcms-notifications` | `NOTIFICATIONS_QUEUE` | Outbound site rebuild + email send fan-out | Active (Phase 4) |

## Planned Queues (Future Phases)

| Queue Name | Binding Constant | Purpose | Phase |
|---|---|---|---|
| `awcms-audit-export` | `AUDIT_EXPORT_QUEUE` | Batch audit log archival to R2 | Phase 6+ |

## Message Contract

All queue messages share a common envelope defined in `awcms-edge/src/queues/contracts.ts`.

### Required Envelope Fields

| Field | Type | Description |
|---|---|---|
| `schema_version` | `string` | Message schema version (e.g. `"1.0"`). Consumers must reject unknown versions. |
| `event_type` | `string` | Namespaced event name (e.g. `media.upload.finalize`). |
| `job_id` | `string` | UUID v4 generated at enqueue time. |
| `idempotency_key` | `string` | Deterministic key used to prevent double-processing. |
| `tenant_id` | `string` | UUID of the owning tenant. Used for logging and consumer scoping. |
| `resource_type` | `string` | The canonical resource type (e.g. `media_upload_session`). |
| `resource_id` | `string` | UUID of the specific resource the consumer must look up. |
| `occurred_at` | `string` | ISO 8601 timestamp of the originating event. |
| `trace_id` | `string` | Passed through from the originating request for distributed tracing. |
| `meta` | `Record<string, unknown>` | Optional non-authoritative context (e.g. file name hint, tenant slug). |

### `media.upload.finalize` Payload

```typescript
{
  schema_version: "1.0",
  event_type: "media.upload.finalize",
  job_id: "<uuid>",
  idempotency_key: "media-finalize:<session_id>",
  tenant_id: "<tenant_uuid>",
  resource_type: "media_upload_session",
  resource_id: "<session_id>",
  occurred_at: "<iso8601>",
  trace_id: "<request-id or cf-ray>",
  meta: {
    original_filename: "<string>",
    tenant_slug: "<string>"
  }
}
```

### `site.rebuild.requested` Payload

Enqueued by two producers:

- `POST /webhooks/public-rebuild/smandapbun` — GitHub repository dispatch backend
- `POST /api/public/rebuild` — Generic webhook backend (tenant-configurable deploy hook)

```typescript
// backend === "webhook"
{
  schema_version: "1.0",
  event_type: "site.rebuild.requested",
  job_id: "<uuid>",
  idempotency_key: "site-rebuild:<tenant_id>:<source>:<timestamp>",
  tenant_id: "<tenant_uuid>",
  resource_type: "site_rebuild",
  resource_id: "<tenant_uuid>",
  occurred_at: "<iso8601>",
  trace_id: "<request-id or cf-ray>",
  meta: {
    backend: "webhook",
    hook_url: "<resolved-at-enqueue-time>",
    source: "<string>",
    resource: "<string | null>",
    action: "<string>",
    actor_id: "<user_uuid | null>"
  }
}

// backend === "github_dispatch"
{
  schema_version: "1.0",
  event_type: "site.rebuild.requested",
  ...
  meta: {
    backend: "github_dispatch",
    github_owner: "<owner>",
    github_repo: "<repo>",
    github_event_type: "<event_type>",
    source: "smandapbun-webhook",
    tenant_slug: "<string | null>",
    table: "<string | null>",
    operation: "<string | null>"
  }
}
```

> **Note:** `hook_url` and GitHub config are resolved at enqueue time from Supabase settings or environment variables. The consumer (`notificationsConsumer.ts`) has no Supabase access and reads only from `meta` and Worker env bindings.

### `email.send.requested` Payload

Enqueued by: `POST /api/mailketing` (action === `"send"` only)

```typescript
{
  schema_version: "1.0",
  event_type: "email.send.requested",
  job_id: "<uuid>",
  idempotency_key: "email-send:<tenant_id>:<recipient>:<job_id>",
  tenant_id: "<tenant_uuid>",
  resource_type: "email_send",
  resource_id: "<job_id>",
  occurred_at: "<iso8601>",
  trace_id: "<request-id or cf-ray>",
  meta: {
    from_name: "<string>",
    from_email: "<string>",
    recipient: "<string>",
    subject: "<string>",
    content: "<string>",
    attach1?: "<url>",
    attach2?: "<url>",
    attach3?: "<url>"
  }
}
```

## Consumer Patterns

### `awcms-media-events` consumer

```
HTTP Request
    │
    ▼
Worker Route (sync)
    │  validates auth + session exists
    │  enqueues message
    │  returns 202 Accepted + job_id
    ▼
Cloudflare Queue (awcms-media-events)
    │
    ▼
queue.handler (async)
    │  re-reads media_upload_sessions from Supabase (SUPABASE_SECRET_KEY)
    │  checks idempotency_key (skips if already finalized)
    │  performs R2 HEAD object check
    │  upserts media_objects row
    │  marks session status = 'complete'
    ▼
Supabase (canonical state updated)
```

### `awcms-notifications` consumer

```
HTTP Request
    │
    ▼
Worker Route (sync)
    │  validates auth + permissions
    │  resolves hook_url / GitHub config from Supabase settings (at enqueue time)
    │  enqueues SiteRebuildMessage or EmailSendMessage
    │  returns 202 Accepted + job_id
    ▼
Cloudflare Queue (awcms-notifications)
    │
    ▼
notificationsQueueHandler (async)
    │  routes by event_type
    │  site.rebuild.requested:
    │    backend=webhook    → POST outbound hook_url from meta
    │    backend=github_dispatch → POST github.com/repos/.../dispatches
    │  email.send.requested:
    │    → POST mailketing API /send with meta fields
    │
    │  permanent failure (missing config, unknown backend) → ack()
    │  transient failure (network, 5xx) → retry()
    ▼
External service (deploy hook / GitHub / Mailketing)
```

## Wrangler Configuration

```jsonc
// awcms-edge/wrangler.jsonc (relevant queue section)
{
  "queues": {
    "producers": [
      { "queue": "awcms-media-events",  "binding": "MEDIA_EVENTS_QUEUE" },
      { "queue": "awcms-notifications", "binding": "NOTIFICATIONS_QUEUE" }
    ],
    "consumers": [
      {
        "queue": "awcms-media-events",
        "max_batch_size": 10,
        "max_batch_timeout": 5,
        "max_retries": 3,
        "dead_letter_queue": "awcms-media-events-dlq"
      },
      {
        "queue": "awcms-notifications",
        "max_batch_size": 10,
        "max_batch_timeout": 5,
        "max_retries": 3,
        "dead_letter_queue": "awcms-notifications-dlq"
      },
      {
        "queue": "awcms-media-events-dlq",
        "max_batch_size": 10,
        "max_batch_timeout": 5,
        "max_retries": 0
      },
      {
        "queue": "awcms-notifications-dlq",
        "max_batch_size": 10,
        "max_batch_timeout": 5,
        "max_retries": 0
      }
    ]
  }
}
```

> **Note:** All four queues (`awcms-media-events`, `awcms-media-events-dlq`, `awcms-notifications`, `awcms-notifications-dlq`) must be created before deployment.

## Local Development

Queues are not available in `wrangler dev` local mode by default. Use the `--remote` flag to test against the real Cloudflare infrastructure:

```bash
cd awcms-edge
npm run dev:remote   # requires a deployed queue
```

For local testing without a real queue, mock the queue binding in `vitest` or use integration-level tests against the finalize route directly.

## Operational Notes

- Create all queues before deploying:
  ```bash
  npx wrangler queues create awcms-media-events
  npx wrangler queues create awcms-media-events-dlq
  npx wrangler queues create awcms-notifications
  npx wrangler queues create awcms-notifications-dlq
  ```
- Monitor via Cloudflare dashboard → Workers & Pages → Queues.
- Consumer failures retry up to `max_retries` times before routing to the DLQ consumer.
- `idempotency_key` checks prevent double-finalization on delivery retry.
- Permanent failures (missing config, unknown backend, invalid payload) are acked immediately — they will not be retried or routed to DLQ.

## Phase 5: Observability, DLQ Processing, and Replay

### Structured Logging (`observability.ts`)

All queue consumers emit structured JSON log records via `awcms-edge/src/queues/observability.ts`. Log records are newline-delimited JSON, compatible with Cloudflare Workers Logs and Logpush.

**Log record fields:**

| Field | Type | Description |
|---|---|---|
| `ts` | `string` | ISO 8601 timestamp at emit time |
| `level` | `"info" \| "warn" \| "error"` | Log level |
| `queue` | `string` | Cloudflare Queue name the message was consumed from |
| `event_type` | `string` | `event_type` from the message envelope |
| `job_id` | `string` | `job_id` from the message envelope |
| `tenant_id` | `string` | `tenant_id` from the message envelope |
| `outcome` | `QueueOutcome` | Consumer decision: `ack`, `retry`, `permanent`, `dlq`, or `replay` |
| `durationMs` | `number?` | Elapsed processing time in milliseconds |
| `message` | `string?` | Human-readable context — error details, skip reasons |
| `extra` | `Record<string, unknown>?` | Additional structured context |

**`QueueOutcome` values:**

| Value | Meaning |
|---|---|
| `ack` | Message processed successfully |
| `retry` | Transient failure — runtime will retry |
| `permanent` | Permanent failure — acked to stop DLQ loop |
| `dlq` | Received on DLQ — logged to `queue_dead_letters` |
| `replay` | Re-enqueued from dead-letter store by an admin |

Convenience wrappers: `logAck`, `logRetry`, `logPermanent`, `logDlq`, `logReplay`. All bare `console.*` calls have been removed from queue consumers.

### Dead Letter Queue Consumer (`dlqConsumer.ts`)

When a message fails all `max_retries` attempts on a live queue, Cloudflare routes it to the configured `dead_letter_queue`. The DLQ queues (`awcms-media-events-dlq`, `awcms-notifications-dlq`) are wired as consumers with `max_retries: 0` so each message is processed exactly once.

The DLQ consumer (`awcms-edge/src/queues/dlqConsumer.ts`):

1. Receives failed message batches.
2. Inserts a row into the `queue_dead_letters` table (Supabase) for each failed message.
3. Acks all messages — DLQ processing is terminal; no further retries occur.
4. Emits a `logDlq` structured log record for each entry.

### `queue_dead_letters` Table

Defined in `supabase/migrations/20260319120000_create_queue_dead_letters.sql`.

| Column | Type | Description |
|---|---|---|
| `id` | `uuid` | Primary key |
| `queue_name` | `text` | Source DLQ name (e.g. `awcms-media-events-dlq`) |
| `job_id` | `text` | `job_id` from the original message envelope |
| `event_type` | `text` | `event_type` from the original message envelope |
| `tenant_id` | `uuid?` | `tenant_id` from the original message (nullable if envelope was malformed) |
| `resource_type` | `text?` | `resource_type` from the original message |
| `resource_id` | `text?` | `resource_id` from the original message |
| `trace_id` | `text?` | `trace_id` from the original message |
| `payload` | `jsonb` | Full original message body |
| `failure_reason` | `text?` | Human-readable reason (populated if available) |
| `failed_at` | `timestamptz` | When the DLQ consumer processed this entry |
| `replayed_at` | `timestamptz?` | When the message was replayed (null until replayed) |
| `replayed_by` | `uuid?` | Admin user ID who triggered the replay |
| `replayed_job_id` | `text?` | New `job_id` assigned to the replayed message |

RLS is enabled. The table is write-only for the service role (DLQ consumer via `SUPABASE_SECRET_KEY`) and read-only for platform admins via the admin API.

### Replay Route

**`POST /api/admin/queue/replay`** — Superadmin-only endpoint.

| Step | Action |
|---|---|
| 1 | Authenticate caller; require `isPlatformAdmin \|\| isFullAccess` |
| 2 | Accept `{ id: "<dead_letter_uuid>" }` in JSON body |
| 3 | Read the `queue_dead_letters` row by `id` |
| 4 | Return `409 Conflict` if `replayed_at` is already set |
| 5 | Determine target live queue from `queue_name` (strip `-dlq` suffix) |
| 6 | Re-enqueue the original `payload` onto the live queue with a new `job_id` |
| 7 | Update `replayed_at`, `replayed_by`, `replayed_job_id` on the dead-letter row |
| 8 | Emit a `logReplay` structured log record |
| 9 | Return `200 OK` with `{ ok: true, replayed_job_id }` |

Replay is idempotent in intent but not in effect — each replay produces a new live queue message. The `replayed_at` guard prevents double-replay via this route.

## References

- `awcms-edge/src/queues/contracts.ts` — TypeScript message contract types and builders
- `awcms-edge/src/queues/mediaConsumer.ts` — Media finalization consumer
- `awcms-edge/src/queues/notificationsConsumer.ts` — Site rebuild + email send consumer
- `awcms-edge/src/queues/observability.ts` — Structured JSON logger
- `awcms-edge/src/queues/dlqConsumer.ts` — Dead letter queue consumer
- `supabase/migrations/20260319120000_create_queue_dead_letters.sql` — Dead letter table schema
- `docs/dev/edge-functions.md` — Worker deployment and validation
- `docs/architecture/runtime-boundaries.md` — Runtime boundary definitions
- [Cloudflare Queues docs](https://developers.cloudflare.com/queues/)
