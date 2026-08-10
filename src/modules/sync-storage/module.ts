import { defineModule } from "../_shared/module-contract";

/**
 * Lifecycle descriptor key (Issue #468). Exported so
 * `application/object-queue-purge.ts` names the same string the registry does —
 * a legal hold checked against a key nobody registered returns "not held"
 * forever and reads exactly like "no hold in place".
 */
export const OBJECT_SYNC_QUEUE_LIFECYCLE_KEY = "sync_storage.object_sync_queue";

export const syncStorageModule = defineModule({
  key: "sync_storage",
  name: "Sync Storage",
  version: "1.0.0",
  status: "active",
  type: "system",
  description:
    "Offline-first sync nodes, outbox/inbox event exchange, HMAC-signed push/pull with anti-replay, optimistic-concurrency conflict tracking, and an object sync upload queue with an internal dispatcher. Node-to-node endpoints authenticate machine-to-machine via HMAC (X-AWCMS-Node-ID/Timestamp/Signature) gated by AWCMS_SYNC_ENABLED; the admin surfaces (nodes, conflicts, object-queue) are session-authenticated and ABAC-guarded. Ported from awcms-mini's proven `sync-storage` module. See `README.md` for full design rationale.",
  dependencies: ["tenant_admin"],
  permissions: [
    {
      activityCode: "node_management",
      action: "read",
      description: "Read sync node registrations"
    },
    {
      activityCode: "node_management",
      action: "update",
      description: "Activate/deactivate or rename a sync node"
    },
    {
      activityCode: "conflict_resolution",
      action: "read",
      description: "Read sync conflicts"
    },
    {
      activityCode: "conflict_resolution",
      action: "approve",
      description: "Resolve sync conflicts"
    },
    {
      activityCode: "object_queue",
      action: "read",
      description: "Read object sync queue entries"
    },
    {
      activityCode: "object_queue",
      action: "retry",
      description: "Manually retry a failed object sync queue entry"
    }
  ],
  api: {
    openApiPath: "openapi/modules/sync-storage.openapi.yaml",
    basePath: "/api/v1/sync"
  },
  // Gated on `node_management.read`: nodes are the first panel and the thing
  // an operator opens this page for. The push/pull/object protocol endpoints
  // have no entry and never will — those are called by a node with an HMAC
  // signature, not by an administrator with a session.
  navigation: [
    {
      labelKey: "admin.layout.nav_sync",
      path: "/admin/sync",
      order: 64,
      requiredPermission: "sync_storage.node_management.read"
    }
  ],
  jobs: [
    {
      command: "bun run sync:objects:dispatch",
      purpose:
        "Drain the due object sync upload queue (claim-lease, retry/backoff, circuit breaker) for every active tenant.",
      recommendedSchedule: "Every 1-2 minutes via cron/systemd timer.",
      environmentNotes:
        "No-op when R2 is disabled (STORAGE_DRIVER=local) — safe to schedule regardless of deployment profile.",
      safeInOfflineLan: true
    },
    {
      command: "bun run sync:objects:purge",
      purpose:
        "Delete terminal object sync queue rows past their retention window (legal-hold gated, bounded batches).",
      recommendedSchedule: "Daily, off-peak.",
      environmentNotes:
        "Runs regardless of STORAGE_DRIVER: a deployment that switched back to local storage still holds rows from when R2 was on, and those are exactly the ones nothing else will ever clean up.",
      safeInOfflineLan: true
    }
  ],
  /**
   * Issue #468, ADR-0072. ONE descriptor, because this module now owns one
   * high-volume table.
   *
   * It used to own two on paper. `awcms_sync_outbox` had **zero producers
   * repo-wide** — nothing INSERTed into it, so `POST /api/v1/sync/pull`, its
   * only reader, could never return anything but an empty list. A retention
   * descriptor for it would have been fiction twice over: a terminal-status
   * predicate that could never match, on a table that could not grow.
   * ADR-0077 answered the question that actually mattered — whether it should
   * exist at all — and retired it (`sql/099`); `/sync/pull` now reads
   * `awcms_domain_events`, this repo's one transactional outbox.
   *
   * ## Why `delegated`
   *
   * `HighVolumeTableDescriptor` carries a `cursorColumn` and no status
   * predicate, so the generic executor deletes purely by age. Pointed at this
   * queue it would delete uploads that have not happened yet — including rows
   * in `sending`, which are claimed by a dispatcher pass whose lease is the
   * only thing that recovers them.
   */
  dataLifecycle: [
    {
      key: OBJECT_SYNC_QUEUE_LIFECYCLE_KEY,
      tableName: "awcms_object_sync_queue",
      ownerModuleKey: "sync_storage",
      scope: "tenant",
      // `created_at`, unlike the email and push queues' `updated_at`, and the
      // difference is forced by the schema: this table has no `updated_at`
      // column. `uploaded_at` exists but is NULL for every `failed` row, so a
      // cursor on it would make failures immortal — the one class of row an
      // operator most wants bounded.
      cursorColumn: "created_at",
      retentionClass: "operational_queue",
      retentionMinDays: 7,
      retentionMaxDays: 365,
      // Longer than the email queue's window is short: a `failed` upload is the
      // record of a file that never reached object storage, and reconciling
      // that against the media library is not a same-week activity.
      defaultRetentionDays: 90,
      partition: {
        eligible: false,
        rationale:
          "Bounded by (uploads attempted), and drained continuously by the dispatcher — the live set is small and the historical tail is deleted rather than kept. The unique (tenant_id, node_id, object_key) upsert key also means a re-attempted upload reuses its row instead of adding one."
      },
      archive: {
        archivable: false,
        rationale:
          "The row describes a transfer, not a document: object key, checksum, byte size, and where it was read from. The OBJECT itself lives in R2 under its own lifecycle, and `media_library` holds the registry entry that gives it meaning. Archiving the queue row would preserve a local filesystem path long after the file behind it is gone."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "Only terminal rows (`sent`/`failed`) are eligible; `pending` and `sending` are work. Nothing to anonymize — `local_path` is a server-side path, not user data, and it is exactly what stops being meaningful once the row is history."
      },
      legalHold: {
        applicable: true,
        precedence: "overrides_retention"
      },
      requiredIndexes: [
        {
          columns: ["tenant_id", "status", "created_at"],
          purpose:
            "awcms_object_sync_queue_tenant_status_created_idx (sql/012) — declared DESC, which serves this purge's ascending scan without a sort because PostgreSQL reads a btree backwards. No new index is added: the one the admin listing already needed is exactly the purge's path."
        }
      ],
      batchLimit: 5000,
      backupRestoreNotes:
        "Included in ordinary full-database backup/restore; no standalone archive artifact exists. Restoring an old backup revives rows that were terminal at backup time — they stay terminal, because status is stored rather than recomputed. A row restored in `sending` is re-claimed by the next dispatcher pass once its lease (`next_retry_at`) is past, the same path a worker crash takes.",
      executionMode: "delegated",
      existingAdopter: {
        jobCommand: "bun run sync:objects:purge",
        purgeFunctionRef:
          "src/modules/sync-storage/application/object-queue-purge.ts#purgeObjectSyncQueue",
        description:
          "Deletes terminal (`sent`/`failed`) queue rows older than the cutoff in bounded batches. Skips the whole step when a legal hold covers sync_storage.object_sync_queue."
      }
    }
  ]
});
