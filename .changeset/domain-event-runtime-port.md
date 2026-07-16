---
"awcms": minor
---

Add the domain-event-runtime module: a transactional, versioned domain-event
outbox and dispatcher ported from awcms-mini. Provider-neutral, generic,
multi-consumer infrastructure — one published event fans out to many
registered consumers with explicit per-aggregate/order-key ordering,
exponential backoff, dead-letter handling, and operator-safe replay.

- New migration `009_awcms_domain_event_runtime_schema.sql`: adds
  `awcms_domain_events` (append-only outbox), `awcms_domain_event_deliveries`
  (per-(event, consumer) retry/DLQ state), `awcms_domain_event_consumer_effects`
  (generic per-consumer idempotency marker),
  `awcms_domain_event_consumer_state` (pause/resume),
  `awcms_domain_event_replays` (append-only replay audit trail), and
  `awcms_domain_event_activity_daily` (reference read-model rollup). Also
  introduces the generic `awcms_idempotency_keys` store (first high-risk
  mutation to need `Idempotency-Key`). All tenant-scoped tables have RLS
  tenant-isolation policies with FORCE.
- New REST endpoints under `/api/v1/domain-events` (events, deliveries,
  consumers, plus reason-required audited replay/pause/resume), all guarded
  by default-deny ABAC; replay is `Idempotency-Key`-guarded.
- New AsyncAPI channel `awcms.domain-event-runtime.sample.recorded` with
  publish/subscribe operations.
- New worker job `bun run domain-events:dispatch` (built on the shared job
  runner), safe in offline/LAN deployments.
- Ships one self-contained reference event type and two representative
  consumers (a cross-module audit projector and a self-contained read-model
  activity-rollup projection). Registered in `src/modules/index.ts`.
