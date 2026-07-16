import { defineModule } from "../_shared/module-contract";

export const domainEventRuntimeModule = defineModule({
  key: "domain_event_runtime",
  name: "Domain Event Runtime",
  version: "0.1.0",
  status: "active",
  description:
    "Transactional, versioned domain-event outbox and dispatcher. Provider-neutral, generic multi-consumer infrastructure — one event can fan out to MANY registered consumers, with explicit per-aggregate/order-key ordering (never a global total order). Producers call `application/append-domain-event.ts`'s `appendDomainEvent` inside their OWN business transaction (same-commit outbox write, ADR-0006 compliant: no external call happens there). A static, reviewed-source-code consumer registry (`infrastructure/consumer-registry.ts`) decides fan-out at publish time; `application/dispatch-domain-events.ts` (`bun run domain-events:dispatch`, built on the shared worker runner `src/lib/jobs/job-runner.ts`) claims/executes/finalizes deliveries with per-order-key ordering, exponential backoff, and dead-letter handling. Dead-lettered deliveries can be replayed by a permission-gated, reason-required, audited, idempotent admin action (`application/delivery-replay.ts`). Ships exactly one self-contained reference event type (`sample.recorded`, `domain/event-type-registry.ts`) and two representative consumers (a same-process cross-module audit projector, and a self-contained reporting/read-model activity-rollup projection) to exercise the full mechanism end-to-end — real producer/consumer wiring for domain modules is intentionally deferred to follow-up work. An optional broker adapter port (`infrastructure/broker-adapter-port.ts`) is defined for future out-of-process delivery; no external broker is required or registered by default — PostgreSQL/in-process dispatch is the only implemented path, so offline/LAN deployments are unaffected. Ported from awcms-mini's proven `domain-event-runtime` module. See `README.md` for full design rationale.",
  dependencies: ["tenant_admin", "identity_access", "logging"],
  type: "system",
  events: {
    asyncApiPath: "asyncapi/awcms-domain-events.asyncapi.yaml",
    publishes: ["awcms.domain-event-runtime.sample.recorded"],
    subscribes: ["awcms.domain-event-runtime.sample.recorded"]
  },
  // No `navigation` entries yet — an admin UI for deliveries/consumers
  // (src/pages/admin/domain-events/*.astro) does not exist in this
  // foundation module; declaring a nav entry with no matching page would be
  // a real 404. Add navigation once that UI ships (follow-up), matching the
  // convention every other module's nav entry already follows (a real page
  // always exists first).
  permissions: [
    {
      activityCode: "events",
      action: "read",
      description:
        "Read domain event outbox entries (redacted payload projections only)"
    },
    {
      activityCode: "deliveries",
      action: "read",
      description:
        "Read domain event consumer delivery/attempt status, including dead-lettered deliveries"
    },
    {
      activityCode: "deliveries",
      action: "replay",
      description:
        "Replay a dead-lettered domain event delivery to a registered consumer"
    },
    {
      activityCode: "consumers",
      action: "read",
      description: "Read the domain event consumer registry and pause state"
    },
    {
      activityCode: "consumers",
      action: "manage",
      description: "Pause or resume a domain event consumer"
    }
  ],
  api: {
    openApiPath: "openapi/awcms-public-api.openapi.yaml",
    basePath: "/api/v1/domain-events"
  },
  jobs: [
    {
      command: "bun run domain-events:dispatch",
      purpose:
        "Claim/execute/finalize due awcms_domain_event_deliveries rows for every active tenant and every registered consumer, applying per-order-key ordering, exponential backoff, and dead-letter transitions. A no-op tick when there is no due backlog.",
      recommendedSchedule: "Every 30-60 seconds via cron/systemd timer.",
      environmentNotes:
        "Pure PostgreSQL/in-process operation — no external network egress, no optional broker required. Safe in offline/LAN deployments.",
      safeInOfflineLan: true
    }
  ]
});
