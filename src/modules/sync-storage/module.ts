import { defineModule } from "../_shared/module-contract";

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
    openApiPath: "openapi/awcms-public-api.openapi.yaml",
    basePath: "/api/v1/sync"
  },
  jobs: [
    {
      command: "bun run sync:objects:dispatch",
      purpose:
        "Drain the due object sync upload queue (claim-lease, retry/backoff, circuit breaker) for every active tenant.",
      recommendedSchedule: "Every 1-2 minutes via cron/systemd timer.",
      environmentNotes:
        "No-op when R2 is disabled (STORAGE_DRIVER=local) — safe to schedule regardless of deployment profile.",
      safeInOfflineLan: true
    }
  ]
});
