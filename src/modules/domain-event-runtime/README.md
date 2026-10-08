🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](README.id.md)

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
- **Descriptor-declared consumer registry** (ADR-0134) —
  `infrastructure/consumer-registry.ts` BUILDS the registry from every
  module's own `domainEventConsumers` (`ModuleDescriptor`, see
  "Declaring a consumer" below); it imports no consumer, so the owning
  module depends on the runtime and never the reverse. Still reviewed
  source code, never database state, so the full fan-out for any event
  type is knowable from source alone. Fan-out is decided at **publish**
  time. An invalid set (duplicate name, a subscription to an event no module
  publishes) makes the build throw and fails
  `bun run domain-events:consumers:check`.
- **Dispatcher** — `application/dispatch-domain-events.ts`
  (`bun run domain-events:dispatch`, built on the shared worker runner
  `src/lib/jobs/job-runner.ts`): claims, executes, and finalizes due
  deliveries per registered consumer, per tenant, with head-of-line ordering
  per `order_key`, exponential backoff, and dead-letter transitions.
- **Idempotent consumers** — `application/consumer-effect.ts`'s
  `applyConsumerEffectOnce` guarantees a consumer's side effect runs at most
  once per `(consumer, event)` even under legitimate redelivery
  (at-least-once, never exactly-once). The registry applies it for you
  (ADR-0134): a consumer's `handle` is the side effect, wrapped by default.
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

Both are declared in this module's own `module.ts`. A third,
`reporting.event_activity_projector`, is declared by `reporting`
(the same event, a projection into `awcms_reporting_projection_metrics`).
Their names key delivery rows and the effect ledger, so they are pinned by
`bun run domain-events:consumers:check` and must never be renamed.

## Declaring a consumer (ADR-0134)

In the module that OWNS the behaviour — never in this module:

```ts
// src/modules/<owner>/module.ts
dependencies: ["domain_event_runtime", /* ... */],
events: { /* the producer module lists its event in publishes */ },
domainEventConsumers: [
  {
    name: "<owner>.<role>",              // globally unique, durable: never rename
    description: "...",
    eventTypes: ["awcms.<ns>.<aggregate>.<action>"], // must be in some module's events.publishes
    eventVersions: ["1.0"],
    // idempotency defaults to "runtime_effect_once": `handle` IS the side effect
    handle: async (tx, event, ctx) => {
      const { apply } = await import("./application/my-projection"); // lazy: keep the descriptor import-light
      await apply(tx, ctx.tenantId, event);
    }
  }
]
```

- The event type must also be in `domain/event-type-registry.ts` (and the
  AsyncAPI channel) before anything can publish it; that catalogue is still a
  hand-written list in this module (a follow-up in ADR-0134).
- **Do not call `applyConsumerEffectOnce` in `handle`.** The registry already
  claims the `(tenant, name, event)` marker; a second claim finds it taken and
  silently skips your effect. The gate refuses the call anywhere else in `src/`.
- A consumer that owns its idempotency (a natural-key upsert, its own inbox
  table) declares `idempotency: "self_managed"` with a non-empty
  `idempotencyRationale`. Emitted-once is not handled-once: say why a redelivery
  cannot duplicate the effect.
- Every declared consumer runs, whatever its module's `status` and whatever a
  tenant's module toggle says (ADR-0134 §4): excluding any would strand
  pending deliveries and drop events.
- Tests that need a deliberately failing consumer use
  `registerDomainEventConsumerForTests` / `resetDomainEventConsumersForTests`.

## HTTP surface (`/api/v1/domain-events`)

| Method & path                   | Permission          | Notes                                            |
| ------------------------------- | ------------------- | ------------------------------------------------ |
| `GET /events`                   | `events.read`       | Bounded list, redacted payload projections only. |
| `GET /events/{id}`              | `events.read`       | Redacted payload projection only.                |
| `GET /deliveries`               | `deliveries.read`   | `status=dead_letter` is the DLQ view.            |
| `GET /deliveries/{id}`          | `deliveries.read`   | Single-record DLQ inspection with joined event.  |
| `POST /deliveries/{id}/replay`  | `deliveries.replay` | Reason-required, `Idempotency-Key`, audited.     |
| `GET /consumers`                | `consumers.read`    | Registry + pause state + backlog counts.         |
| `POST /consumers/{name}/pause`  | `consumers.manage`  | Reason-required, audited (naturally idempotent). |
| `POST /consumers/{name}/resume` | `consumers.manage`  | Audited (naturally idempotent).                  |

All endpoints are tenant-scoped, guarded by default-deny ABAC
(`authorizeInTransaction`), and run inside `withTenant` so RLS enforces
tenant isolation at the database layer.

## Admin UI (`/admin/domain-events`)

`src/pages/admin/domain-events.astro` (ADR-0051) — the operator console for
the table above: the consumer registry with pause state and backlog counts
(pause/resume), the delivery list filtered by status/consumer/event type with
replay on dead-lettered rows, and the outbox itself with a payload inspector.
All five permissions are driven from this one page. Reads go through this
module's own application functions inside one `withTenantOrThrow`; every
mutation posts to the endpoint above.

The idempotency split in the table is reproduced exactly by the screen, and
`tests/admin-domain-events-page-contract.test.ts` pins it: `replay` sends an
`Idempotency-Key` because each call does new work, while `pause` and `resume`
send none because they are naturally idempotent. Sending a key to `pause`
would imply a replay contract that endpoint does not have; omitting it on
`replay` would render a button that always fails.

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
