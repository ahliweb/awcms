import { defineModule } from "../_shared/module-contract";

/**
 * Lifecycle descriptor keys. Exported so
 * `application/push-queue-purge.ts` names the same strings the registry does,
 * rather than repeating three literals that could drift apart silently — a
 * legal hold checked against a key nobody registered would return "not held"
 * forever, and read exactly like "no hold in place".
 */
export const PUSH_SUBSCRIPTIONS_LIFECYCLE_KEY = "push_delivery.subscriptions";
export const PUSH_MESSAGES_LIFECYCLE_KEY = "push_delivery.messages";
export const PUSH_ATTEMPTS_LIFECYCLE_KEY = "push_delivery.delivery_attempts";

export const pushDeliveryModule = defineModule({
  key: "push_delivery",
  name: "Push Delivery",
  version: "0.1.0",
  /**
   * `experimental`, not `active`, and the difference is enforced rather than
   * cosmetic: `tests/admin-media-page-contract.test.ts` requires every ACTIVE
   * module to declare an admin screen, with ZERO exceptions (ADR-0021 criterion
   * 1), and its own comment records what happened the last time somebody wrote
   * a carve-out instead — the excuse went stale and would have let a module
   * LOSE its screen unnoticed.
   *
   * So this module does not take the exception; it takes the honest status. It
   * ships a working queue and two workers, and it has no operator-facing
   * surface at all: an admin cannot see the queue without reading the database.
   * That is a real gap, not a formality, and it closes together with the real
   * adapters in #466 — at which point this becomes `active` and the assertion
   * above starts holding it to a screen.
   */
  status: "experimental",
  description:
    "Transactional outbox for device push notifications (epic #463, ADR-0074): a `PushProvider` port, a safe `log` adapter, the tenant-scoped schema/RLS (`sql/093`), and a claim/send/finalize dispatcher (`bun run push:dispatch`) with lease-based claiming, backoff, a circuit breaker, and a per-attempt ledger. It is a SECOND outbox on purpose — `domain-event-runtime` calls its consumers INSIDE the claim transaction by design, and ADR-0006 forbids the external HTTP call a push provider needs from inside a transaction. Generic infrastructure, analogous to `email`: it delivers a notification somebody else decided to send, and owns no notion of what is worth notifying about. Ships INERT — without PUSH_ENABLED=true the dispatcher claims nothing. The real FCM HTTP v1 and Web Push/VAPID adapters, and the HTTP surface for managing subscriptions, land in their own issues (#466).",
  dependencies: ["tenant_admin", "logging"],
  jobs: [
    {
      command: "bun run push:dispatch",
      purpose:
        "Drain the due push delivery queue (claim-lease, retry/backoff, circuit breaker, dead-subscription disabling) for every active tenant.",
      recommendedSchedule: "Every 1-2 minutes via cron/systemd timer.",
      environmentNotes:
        'No-op when PUSH_ENABLED is not "true" — safe to schedule regardless of deployment profile. On an offline/LAN deployment it stays a no-op forever, since no push service is reachable.',
      safeInOfflineLan: true
    },
    {
      command: "bun run push:queue:purge",
      purpose:
        "Delete terminal push queue rows, spent delivery attempts, and long-disabled subscriptions past their retention windows (legal-hold gated, bounded batches).",
      recommendedSchedule: "Daily, off-peak.",
      environmentNotes:
        "Runs regardless of PUSH_ENABLED: a deployment that turned push OFF still has rows from when it was on, and those are exactly the ones nothing else will ever clean up.",
      safeInOfflineLan: true
    }
  ],
  /**
   * All three tables carry a descriptor from the day they are created —
   * `TABLES_PREDATING_THE_RULE` is closed to new tables and `BOUNDED_BY_DESIGN`
   * is empty, so there was never an option to defer this. Issue #468 records
   * that the six EXISTING outbox tables in this repo do not have one; this
   * module is not allowed to join them.
   *
   * All three are `delegated`, not `generic`, and the reason is in
   * `application/push-queue-purge.ts`'s header: the generic executor deletes by
   * age with no status predicate, which pointed at a queue would silently drop
   * undelivered work and look like housekeeping while doing it.
   */
  dataLifecycle: [
    {
      key: PUSH_MESSAGES_LIFECYCLE_KEY,
      tableName: "awcms_push_messages",
      ownerModuleKey: "push_delivery",
      scope: "tenant",
      // `updated_at`, not `created_at`: it is the moment the row stopped
      // moving. A message that retried for a day would otherwise be measured
      // from before its last attempt.
      cursorColumn: "updated_at",
      retentionClass: "operational_queue",
      retentionMinDays: 7,
      retentionMaxDays: 365,
      defaultRetentionDays: 30,
      partition: {
        eligible: false,
        rationale:
          "Bounded by delivery throughput and drained continuously, so the live set is small and the historical tail is deleted rather than kept. Partitioning pays off for tables that retain a long history, which this one specifically does not."
      },
      archive: {
        archivable: false,
        rationale:
          "A delivered notification is a copy of information that already exists in the record it points at. Archiving the queue would preserve a second copy of admin-facing text with no independent evidential value, while extending how long its click target and recipient linkage are retained."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "Nothing to anonymize: the row's only identifying link is a subscription FK, and the subscription itself is governed by its own descriptor. Only terminal rows (`sent`/`failed`/`cancelled`) are eligible — non-terminal rows are pending work, not history."
      },
      legalHold: {
        applicable: true,
        precedence: "overrides_retention"
      },
      requiredIndexes: [
        {
          columns: ["tenant_id", "status", "updated_at"],
          purpose:
            "awcms_push_messages_retention_idx (sql/093) — the purge's own path (WHERE tenant_id = ? AND status IN (terminal) AND updated_at < ?), added by this table's migration specifically for it rather than reused from the dispatch index, whose status values are the opposite set."
        }
      ],
      batchLimit: 5000,
      backupRestoreNotes:
        "Included in ordinary full-database backup/restore; no standalone archive artifact exists. Restoring an old backup revives queue rows that were terminal at backup time — they stay terminal, because status is stored, not recomputed. A row restored in `sending` is re-claimed by the next pass once its lease is past, which is the same path a worker crash takes.",
      executionMode: "delegated",
      existingAdopter: {
        jobCommand: "bun run push:queue:purge",
        purgeFunctionRef:
          "src/modules/push-delivery/application/push-queue-purge.ts#purgePushQueue",
        description:
          "Deletes terminal (`sent`/`failed`/`cancelled`) messages older than the cutoff in bounded batches, skipping any that still have attempt rows so the foreign key holds. Skips the whole step when a legal hold covers push_delivery.messages."
      }
    },
    {
      key: PUSH_ATTEMPTS_LIFECYCLE_KEY,
      tableName: "awcms_push_delivery_attempts",
      ownerModuleKey: "push_delivery",
      scope: "tenant",
      cursorColumn: "created_at",
      retentionClass: "operational_queue",
      retentionMinDays: 7,
      retentionMaxDays: 365,
      defaultRetentionDays: 30,
      partition: {
        eligible: false,
        rationale:
          "Highest row count of the three — one row per ATTEMPT, so a message that exhausts its retries writes several — but the same continuously-drained profile as the queue it describes. The answer to its volume is a short retention window, which it has, not partitioning."
      },
      archive: {
        archivable: false,
        rationale:
          "A truncated provider reply is a debugging aid with a half-life of days. It is deliberately never allowed to contain the payload or the endpoint, so there is nothing in it worth preserving once the incident it belongs to is closed."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "Append-only diagnostic rows with no status to transition to and no identifying column to anonymize — the endpoint never appears here, only a message FK."
      },
      legalHold: {
        applicable: true,
        precedence: "overrides_retention"
      },
      requiredIndexes: [
        {
          columns: ["tenant_id", "created_at"],
          purpose:
            "awcms_push_delivery_attempts_created_idx (sql/093) — the purge's cursor path (WHERE tenant_id = ? AND created_at < ? ORDER BY created_at ASC)."
        }
      ],
      batchLimit: 5000,
      backupRestoreNotes:
        "Included in ordinary full-database backup/restore; no standalone archive artifact exists. The unique (message_id, attempt_no) constraint means a restore cannot produce duplicate attempt records for a message that is re-dispatched afterwards.",
      executionMode: "delegated",
      existingAdopter: {
        jobCommand: "bun run push:queue:purge",
        purgeFunctionRef:
          "src/modules/push-delivery/application/push-queue-purge.ts#purgePushQueue",
        description:
          "Deletes attempt rows older than the cutoff in bounded batches, before the messages step so the foreign key ordering holds. Skips the whole step when a legal hold covers push_delivery.delivery_attempts."
      }
    },
    {
      key: PUSH_SUBSCRIPTIONS_LIFECYCLE_KEY,
      tableName: "awcms_push_subscriptions",
      ownerModuleKey: "push_delivery",
      scope: "tenant",
      cursorColumn: "updated_at",
      retentionClass: "operational_queue",
      retentionMinDays: 30,
      retentionMaxDays: 1095,
      // Longer than the queue's 30 days on purpose: a disabled subscription is
      // the evidence that answers "why did this user stop getting
      // notifications", and that question is asked weeks later.
      defaultRetentionDays: 180,
      partition: {
        eligible: false,
        rationale:
          "Bounded by (users × devices), not by traffic — the only table of the three whose size does not grow with how much is sent. Partitioning a table of this cardinality would add operational surface for no benefit."
      },
      archive: {
        archivable: false,
        rationale:
          "The row's substance IS a credential-grade endpoint. Archiving it would copy a push credential into a second, longer-lived artifact — the opposite of what retention is for here."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "Only `disabled` rows are eligible, and only once no message references them. An `active` subscription has no age at which it stops being valid: a browser unopened for a year still receives its notification the moment it is opened."
      },
      legalHold: {
        applicable: true,
        precedence: "overrides_retention"
      },
      requiredIndexes: [
        {
          columns: ["tenant_id", "status", "updated_at"],
          purpose:
            "awcms_push_subscriptions_status_updated_idx (sql/093) — the purge's path (WHERE tenant_id = ? AND status = 'disabled' AND updated_at < ?)."
        }
      ],
      batchLimit: 5000,
      backupRestoreNotes:
        "Included in ordinary full-database backup/restore. Restoring an old backup can revive a subscription that was disabled after the backup was taken; the next delivery attempt re-disables it, because the push service answers the same 404/410 that disabled it the first time.",
      executionMode: "delegated",
      existingAdopter: {
        jobCommand: "bun run push:queue:purge",
        purgeFunctionRef:
          "src/modules/push-delivery/application/push-queue-purge.ts#purgePushQueue",
        description:
          "Deletes `disabled` subscriptions older than the cutoff in bounded batches, last of the three steps and only for rows no message still references. Skips the whole step when a legal hold covers push_delivery.subscriptions."
      }
    }
  ]
});
