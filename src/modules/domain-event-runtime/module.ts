import { defineModule } from "../_shared/module-contract";

/**
 * Lifecycle descriptor key (Issue #468). Exported so
 * `application/delivery-retention-purge.ts` names the same string the registry
 * does — a legal hold checked against a key nobody registered returns "not
 * held" forever and reads exactly like "no hold in place".
 */
export const DOMAIN_EVENT_DELIVERIES_LIFECYCLE_KEY =
  "domain_event_runtime.deliveries";

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
    openApiPath: "openapi/modules/domain-event-runtime.openapi.yaml",
    basePath: "/api/v1/domain-events"
  },
  // Gated on `consumers.read` rather than `events.read`: the consumer table is
  // the part an operator opens this page FOR — a stuck or paused consumer is
  // what makes an event never arrive — and it is the first panel rendered.
  navigation: [
    {
      labelKey: "admin.layout.nav_domain_events",
      path: "/admin/domain-events",
      order: 78,
      requiredPermission: "domain_event_runtime.consumers.read"
    }
  ],
  jobs: [
    {
      command: "bun run domain-events:dispatch",
      schedule: {
        mode: "cron",
        expression: "* * * * *",
        backlog: "review-before-first-run",
        backlogNote:
          "Drains the domain-event outbox. It has never run on this deployment, so the first pass delivers every event accumulated since the module landed — fanning out to every registered consumer at once. Dry-run and read the pending count first."
      },
      purpose:
        "Claim/execute/finalize due awcms_domain_event_deliveries rows for every active tenant and every registered consumer, applying per-order-key ordering, exponential backoff, and dead-letter transitions. A no-op tick when there is no due backlog.",
      recommendedSchedule: "Every 30-60 seconds via cron/systemd timer.",
      environmentNotes:
        "Pure PostgreSQL/in-process operation — no external network egress, no optional broker required. Safe in offline/LAN deployments.",
      safeInOfflineLan: true
    },
    {
      command: "bun run domain-events:deliveries:purge",
      schedule: {
        mode: "cron",
        expression: "25 3 * * *",
        backlog: "review-before-first-run",
        backlogNote:
          "Deletes delivery records past retention. Run it only AFTER `domain-events:dispatch` has drained the backlog — purging first destroys the record of what was never delivered."
      },
      purpose:
        "Delete settled (`delivered`/`skipped`) delivery rows past their retention window, never dead-lettered ones and never a row a replay still references (legal-hold gated, bounded batches).",
      recommendedSchedule: "Daily, off-peak.",
      environmentNotes:
        "Pure PostgreSQL — no network egress. Safe in offline/LAN deployments.",
      safeInOfflineLan: true
    }
  ],
  /**
   * Issue #468, ADR-0072. ONE descriptor for a module with six tables on
   * `TABLES_PREDATING_THE_RULE`, and the five that stay are a scope statement
   * rather than an oversight.
   *
   * `awcms_domain_events` — the parent, holding the payloads — is the larger
   * half of the disk problem and deliberately out of scope. Deleting deliveries
   * does not shrink it, and how long an event PAYLOAD is worth keeping is a
   * different question from how long a delivery RECEIPT is: the first is a
   * business record other things replay from, the second is transport
   * bookkeeping. Claiming both in one PR would answer the easy one and bury the
   * hard one.
   *
   * ## `dead_letter` is excluded, and it is the trap
   *
   * It LOOKS terminal — the dispatcher will never retry one on its own — and it
   * is precisely the row an operator opens the console to find and replay. A
   * window that swept it would delete the work AND its evidence, and the
   * deletion would be indistinguishable from the queue having drained cleanly.
   */
  /**
   * ADR-0094 wave 2 (Issue #557).
   *
   * `awcms_domain_events` is the only table in the base that reaches a person
   * BOTH ways — `actor_tenant_user_id` and `actor_profile_id` — which is
   * exactly the case `subjectColumns` being a list exists for.
   */
  subjectData: [
    {
      key: "domain_event_runtime.domain_events",
      tableName: "awcms_domain_events",
      ownerModuleKey: "domain_event_runtime",
      subjectColumns: [
        { column: "actor_tenant_user_id", references: "tenant_user" },
        { column: "actor_profile_id", references: "profile" }
      ],
      exportable: true,
      // The event log is the spine other modules replay from. Deleting rows
      // would rewrite history for every consumer, and anonymising the actor
      // stamps is unnecessary once the identity itself is anonymised.
      erasure: "severed_with_subject_row",
      rationale:
        "The append-only record of what happened in the tenant, with this person named as the actor behind it. `payload` is the business event and can be about somebody else entirely, so it is held back while the fact of their action is not.",
      redactedColumns: ["payload"]
    },
    {
      key: "domain_event_runtime.domain_event_replays",
      tableName: "awcms_domain_event_replays",
      ownerModuleKey: "domain_event_runtime",
      subjectColumns: [{ column: "requested_by", references: "tenant_user" }],
      exportable: true,
      erasure: "severed_with_subject_row",
      rationale:
        "Replays this person requested and the reason they gave. Re-delivering an event is an operational act with real effects, so who asked for one is worth answering for."
    },
    {
      key: "domain_event_runtime.domain_event_consumer_state",
      tableName: "awcms_domain_event_consumer_state",
      ownerModuleKey: "domain_event_runtime",
      subjectColumns: [
        { column: "paused_by", references: "tenant_user" },
        { column: "resumed_by", references: "tenant_user" }
      ],
      exportable: false,
      erasure: "severed_with_subject_row",
      rationale:
        "Whether a consumer is paused, and who paused or resumed it. Pipeline state about a consumer; the person is the operator who intervened."
    },
    {
      key: "domain_event_runtime.domain_event_deliveries",
      tableName: "awcms_domain_event_deliveries",
      ownerModuleKey: "domain_event_runtime",
      unreachableBySubject: true,
      subjectColumns: [],
      exportable: false,
      erasure: "retain_under_obligation",
      rationale:
        "One row per (event, consumer) attempt: status, retries, dead-letter reason. Delivery bookkeeping keyed by event rather than by person — the event itself answers above, and losing these rows would re-deliver or strand messages."
    },
    {
      key: "domain_event_runtime.domain_event_consumer_effects",
      tableName: "awcms_domain_event_consumer_effects",
      ownerModuleKey: "domain_event_runtime",
      unreachableBySubject: true,
      subjectColumns: [],
      exportable: false,
      erasure: "retain_under_obligation",
      rationale:
        "The idempotency record proving a consumer already applied an event. Three keys and a timestamp; removing a row would let the same effect be applied twice."
    },
    {
      key: "domain_event_runtime.domain_event_activity_daily",
      tableName: "awcms_domain_event_activity_daily",
      ownerModuleKey: "domain_event_runtime",
      unreachableBySubject: true,
      subjectColumns: [],
      exportable: false,
      erasure: "retain_under_obligation",
      rationale:
        "Daily event counts per type. An aggregate with no actor column, which is what survives when the events behind it are severed."
    }
  ],
  dataLifecycle: [
    {
      key: DOMAIN_EVENT_DELIVERIES_LIFECYCLE_KEY,
      tableName: "awcms_domain_event_deliveries",
      ownerModuleKey: "domain_event_runtime",
      scope: "tenant",
      cursorColumn: "updated_at",
      retentionClass: "operational_queue",
      retentionMinDays: 7,
      retentionMaxDays: 365,
      // Longer than the email queue's 90: a delivery receipt is what answers
      // "did consumer X ever see event Y", and that question is asked when a
      // downstream projection is found to disagree with its source — months
      // after the delivery.
      defaultRetentionDays: 120,
      partition: {
        eligible: true,
        granularity: "monthly",
        rationale:
          "One row per (event x consumer), so it grows as the product of event volume and consumer count — the fastest-growing table in this module. Monthly range partitions would turn each purge into a DROP PARTITION instead of a batched DELETE. Not automated here: declaring eligibility is a statement about the table, not a promise that partitioning exists."
      },
      archive: {
        archivable: false,
        rationale:
          "A settled delivery row records that a consumer was handed an event and said yes. The EVENT it refers to is retained separately and for longer, and the consumer's own effect ledger (awcms_domain_event_consumer_effects) records what it did. Archiving the receipt would preserve a third copy of a fact two other tables already hold."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "Only `delivered`/`skipped` rows are eligible. `pending` is work; `dead_letter` is work waiting for an operator, and it is the row a replay is issued FROM. Nothing to anonymize — the row carries no subject identifier, only consumer name and error text."
      },
      legalHold: {
        applicable: true,
        precedence: "overrides_retention"
      },
      requiredIndexes: [
        {
          columns: ["tenant_id", "updated_at"],
          purpose:
            "awcms_domain_event_deliveries_retention_idx (sql/097) — PARTIAL, on `status IN ('delivered','skipped')`. The closest existing index is (tenant_id, status) with no time column, so on a table whose whole problem is accumulated `delivered` rows it would mean reading every one of them to find the old ones. Partial because the dispatcher's hot path is `status = 'pending'`, which has no reason to churn through this index."
        }
      ],
      batchLimit: 5000,
      backupRestoreNotes:
        "Included in ordinary full-database backup/restore; no standalone archive artifact exists. Restoring a backup older than the window revives settled delivery rows — harmless, since the dispatcher only claims `pending` and the unique identity index (tenant_id, event_id, consumer_name) still prevents a second ORIGINAL delivery for the same pair.",
      executionMode: "delegated",
      existingAdopter: {
        jobCommand: "bun run domain-events:deliveries:purge",
        purgeFunctionRef:
          "src/modules/domain-event-runtime/application/delivery-retention-purge.ts#purgeSettledDeliveries",
        description:
          "Deletes `delivered`/`skipped` rows older than the cutoff in bounded batches, skipping any row a replay record or another delivery still references. Never touches `dead_letter`. Skips the whole step when a legal hold covers domain_event_runtime.deliveries."
      }
    }
  ]
});
