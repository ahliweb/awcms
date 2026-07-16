# Domain Event Runtime

Transactional, versioned domain-event **outbox** and **dispatcher**.
Provider-neutral, generic, multi-consumer infrastructure: one published
event can fan out to **many** registered consumers, with explicit
per-aggregate/order-key ordering (never a global total order), exponential
backoff, dead-letter handling, and operator-safe replay.

Ported from the proven `domain-event-runtime` module in awcms-mini and
adapted to this repo's `awcms_` prefix convention and available foundation
modules.

## What it provides

- **Outbox producer** — `application/append-domain-event.ts`'s
  `appendDomainEvent(tx, tenantId, input)`: a producer calls this **inside
  its own business transaction** (ADR-0006 compliant — plain DB writes only,
  no external I/O), so the event row and its per-consumer delivery rows
  commit atomically with the source state change. A rolled-back source
  transaction produces no dispatchable event by construction.
- **Versioned event-type registry** — `domain/event-type-registry.ts`:
  `appendDomainEvent` refuses to persist an event whose
  `(eventType, eventVersion)` is not listed here, stopping silent drift from
  the published AsyncAPI contract.
- **Static consumer registry** — `infrastructure/consumer-registry.ts`: a
  plain array of `DomainEventConsumerDefinition`, so the full fan-out for any
  event type is knowable from source code alone. Fan-out is decided at
  **publish** time.
- **Dispatcher** — `application/dispatch-domain-events.ts`
  (`bun run domain-events:dispatch`, built on the shared worker runner
  `src/lib/jobs/job-runner.ts`): claims, executes, and finalizes due
  deliveries per registered consumer, per tenant, with head-of-line ordering
  per `order_key`, exponential backoff, and dead-letter transitions.
- **Idempotent consumers** — `application/consumer-effect.ts`'s
  `applyConsumerEffectOnce` guarantees a consumer's side effect runs at most
  once per `(consumer, event)` even under legitimate redelivery
  (at-least-once, never exactly-once).
- **Operator-safe replay** — `application/delivery-replay.ts`:
  permission-gated, reason-required, `Idempotency-Key`-guarded, audited, and
  refuses to replay against an incompatible consumer schema.
- **Pause/resume** — `application/consumer-state-directory.ts`: per
  `(tenant, consumer)` pause flag, checked by the dispatcher before claiming.
- **Optional broker adapter port** — `infrastructure/broker-adapter-port.ts`:
  a seam for future out-of-process delivery. No external broker is required
  or registered by default; PostgreSQL/in-process dispatch is the only
  implemented path, so offline/LAN deployments are unaffected.

## Reference event and consumers

This foundation module ships exactly **one** self-contained reference event
type, `awcms.domain-event-runtime.sample.recorded`, and **two**
representative consumers, to exercise the full mechanism end-to-end:

1. `logging.sample_event_audit_projector` — a same-process cross-module
   consumer that projects the event into the `logging` module's audit trail
   via `recordAuditEvent`.
2. `domain_event_runtime.activity_rollup_projector` — a self-contained
   read-model projection maintaining the per-tenant/day/event-type rollup
   table `awcms_domain_event_activity_daily`.

> Port note: awcms-mini's registry additionally carries later-wave consumers
> that project into its `reporting` and `integration_hub` modules. Those
> modules do not exist in this repo, so those consumers are intentionally not
> ported (they would import absent modules). Both consumers above are fully
> self-contained.

## HTTP surface (`/api/v1/domain-events`)

| Method & path | Permission | Notes |
| --- | --- | --- |
| `GET /events` | `events.read` | Bounded list, redacted payload projections only. |
| `GET /events/{id}` | `events.read` | Redacted payload projection only. |
| `GET /deliveries` | `deliveries.read` | `status=dead_letter` is the DLQ view. |
| `GET /deliveries/{id}` | `deliveries.read` | Single-record DLQ inspection with joined event. |
| `POST /deliveries/{id}/replay` | `deliveries.replay` | Reason-required, `Idempotency-Key`, audited. |
| `GET /consumers` | `consumers.read` | Registry + pause state + backlog counts. |
| `POST /consumers/{name}/pause` | `consumers.manage` | Reason-required, audited (naturally idempotent). |
| `POST /consumers/{name}/resume` | `consumers.manage` | Audited (naturally idempotent). |

All endpoints are tenant-scoped, guarded by default-deny ABAC
(`authorizeInTransaction`), and run inside `withTenant` so RLS enforces
tenant isolation at the database layer.

## Data model (migration `009`)

Tenant-scoped, RLS tenant-isolated tables:

- `awcms_domain_events` — the append-only outbox.
- `awcms_domain_event_deliveries` — per-(event, consumer) retry/DLQ state.
- `awcms_domain_event_consumer_effects` — generic per-consumer idempotency
  marker.
- `awcms_domain_event_consumer_state` — per-(tenant, consumer) pause flag.
- `awcms_domain_event_replays` — append-only replay audit trail.
- `awcms_domain_event_activity_daily` — reference read-model rollup.

The same migration also introduces the generic `awcms_idempotency_keys`
store, since this module's replay endpoint is the first high-risk mutation in
this repo to require the standard `Idempotency-Key` wrapper.

## Dispatcher operations

`bun run domain-events:dispatch` — claim/execute/finalize due deliveries for
every active tenant and registered consumer. Recommended schedule: every
30–60 seconds via cron/systemd timer. Pure PostgreSQL/in-process operation
(no external network egress); safe in offline/LAN deployments. Supports
`--dry-run` (read-only backlog preview) and `--json-output=<path>`.
