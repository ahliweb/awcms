/**
 * Read-side queries shared by the admin sync endpoints
 * (`/api/v1/sync/nodes`, `/api/v1/sync/object-queue`) and the future
 * `/admin/sync` SSR page — same pattern as
 * `identity-access/application/user-directory.ts` being shared between the
 * Access & Users endpoints and `admin/access-users.astro`.
 */

import type { KeysetCursor } from "../../_shared/keyset-pagination";

export type SyncNodeSummary = {
  nodeId: string;
  nodeCode: string;
  nodeName: string;
  status: "active" | "inactive";
  lastPushedAt: string | null;
  lastPulledAt: string | null;
  lastPullSequence: number;
  createdAt: string;
};

type SyncNodeRow = {
  id: string;
  node_code: string;
  node_name: string;
  status: "active" | "inactive";
  last_pushed_at: Date | null;
  last_pulled_at: Date | null;
  last_pull_sequence: string | number;
  created_at: Date;
};

export async function fetchSyncNodes(
  tx: Bun.SQL,
  tenantId: string
): Promise<SyncNodeSummary[]> {
  const rows = (await tx`
    SELECT id, node_code, node_name, status, last_pushed_at, last_pulled_at,
           last_pull_sequence, created_at
    FROM awcms_sync_nodes
    WHERE tenant_id = ${tenantId}
    ORDER BY node_name ASC
  `) as SyncNodeRow[];

  return rows.map((row) => ({
    nodeId: row.id,
    nodeCode: row.node_code,
    nodeName: row.node_name,
    status: row.status,
    lastPushedAt: row.last_pushed_at?.toISOString() ?? null,
    lastPulledAt: row.last_pulled_at?.toISOString() ?? null,
    lastPullSequence: Number(row.last_pull_sequence),
    createdAt: row.created_at.toISOString()
  }));
}

export type ObjectQueueEntry = {
  objectQueueId: string;
  nodeId: string;
  nodeCode: string;
  objectKey: string;
  status: "pending" | "sent" | "failed";
  retryCount: number;
  nextRetryAt: string | null;
  lastError: string | null;
  byteSize: number;
  requiresUpload: boolean;
  uploadedAt: string | null;
  createdAt: string;
};

type ObjectQueueRow = {
  id: string;
  node_id: string;
  node_code: string;
  object_key: string;
  status: "pending" | "sent" | "failed";
  retry_count: string | number;
  next_retry_at: Date | null;
  last_error: string | null;
  byte_size: string | number;
  requires_upload: boolean;
  uploaded_at: Date | null;
  created_at: Date;
};

export const OBJECT_QUEUE_LIMIT = 200;

/**
 * Tenant-wide (all nodes) admin view of the object sync queue — distinct
 * from the node-scoped, HMAC-authenticated `GET /sync/objects/status` that
 * a single node polls for its own pending work.
 *
 * The `LIMIT` is applied inside the subquery, *before* the join to
 * `awcms_sync_nodes`, rather than sorting/limiting the joined result.
 * Measured during Issue #435's performance audit (EXPLAIN ANALYZE against a
 * 200k-row seeded queue, migration 017's new
 * `awcms_object_sync_queue_tenant_created_idx` /
 * `..._tenant_status_created_idx`): joining first made the planner
 * badly underestimate the join's row count, which made it prefer a
 * Seq Scan/Bitmap Heap Scan across every matching row + a full sort
 * (20-40ms) over the available `(tenant_id[, status], created_at DESC)`
 * index, even though that index makes the query trivially cheap
 * (order-matching index scan, stop at `LIMIT`). Limiting inside the
 * subquery removes that ambiguity — the planner has no choice but to
 * satisfy `ORDER BY ... LIMIT` off the index before ever touching the join
 * — and cut execution to well under 1ms in the same benchmark.
 *
 * `cursor` (optional, keyset `(created_at, id) < (cursor)`, doc: skill
 * `awcms-performance` §Pagination keyset) lets `GET
 * /api/v1/sync/object-queue` page past the first `OBJECT_QUEUE_LIMIT`
 * (200) rows without `OFFSET`. `admin/sync.astro`'s SSR call (only ever
 * `status: "failed"`, first page) omits it, so its existing
 * `Awaited<ReturnType<typeof fetchObjectQueueEntries>>`/array usage is
 * unaffected.
 */
export async function fetchObjectQueueEntries(
  tx: Bun.SQL,
  tenantId: string,
  statusFilter?: "pending" | "sent" | "failed",
  cursor?: KeysetCursor
): Promise<ObjectQueueEntry[]> {
  const cursorCreatedAt = cursor?.createdAt ?? null;
  const cursorId = cursor?.id ?? null;

  const rows = (
    statusFilter
      ? await tx`
        SELECT q.id, q.node_id, n.node_code, q.object_key, q.status, q.retry_count,
               q.next_retry_at, q.last_error, q.byte_size, q.requires_upload,
               q.uploaded_at, q.created_at
        FROM (
          SELECT id, node_id, object_key, status, retry_count, next_retry_at,
                 last_error, byte_size, requires_upload, uploaded_at, created_at,
                 tenant_id
          FROM awcms_object_sync_queue
          WHERE tenant_id = ${tenantId} AND status = ${statusFilter}
            AND (
              ${cursorCreatedAt}::timestamptz IS NULL
              OR (created_at, id) < (${cursorCreatedAt}, ${cursorId})
            )
          ORDER BY created_at DESC, id DESC
          LIMIT ${OBJECT_QUEUE_LIMIT}
        ) q
        JOIN awcms_sync_nodes n ON n.id = q.node_id AND n.tenant_id = q.tenant_id
        ORDER BY q.created_at DESC, q.id DESC
      `
      : await tx`
        SELECT q.id, q.node_id, n.node_code, q.object_key, q.status, q.retry_count,
               q.next_retry_at, q.last_error, q.byte_size, q.requires_upload,
               q.uploaded_at, q.created_at
        FROM (
          SELECT id, node_id, object_key, status, retry_count, next_retry_at,
                 last_error, byte_size, requires_upload, uploaded_at, created_at,
                 tenant_id
          FROM awcms_object_sync_queue
          WHERE tenant_id = ${tenantId}
            AND (
              ${cursorCreatedAt}::timestamptz IS NULL
              OR (created_at, id) < (${cursorCreatedAt}, ${cursorId})
            )
          ORDER BY created_at DESC, id DESC
          LIMIT ${OBJECT_QUEUE_LIMIT}
        ) q
        JOIN awcms_sync_nodes n ON n.id = q.node_id AND n.tenant_id = q.tenant_id
        ORDER BY q.created_at DESC, q.id DESC
      `
  ) as ObjectQueueRow[];

  return rows.map((row) => ({
    objectQueueId: row.id,
    nodeId: row.node_id,
    nodeCode: row.node_code,
    objectKey: row.object_key,
    status: row.status,
    retryCount: Number(row.retry_count),
    nextRetryAt: row.next_retry_at?.toISOString() ?? null,
    lastError: row.last_error,
    byteSize: Number(row.byte_size),
    requiresUpload: row.requires_upload,
    uploadedAt: row.uploaded_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString()
  }));
}
