/**
 * Internal object sync queue dispatcher (Issue #436). NOT a public HTTP
 * endpoint — `README.md`'s "Belum tersedia" section is explicit that only a
 * trusted internal worker may transition `awcms_object_sync_queue` rows
 * to `sent`/`failed`, never a node over HMAC. Invoked by
 * `scripts/object-sync-dispatch.ts` (a scheduled/cron-style CLI entrypoint),
 * one tenant at a time.
 *
 * Three-phase pattern, required by ADR-0006 ("Jangan memanggil provider
 * eksternal di dalam transaction"):
 *
 * 1. CLAIM — one short transaction flips eligible `pending` rows to a
 *    transient `sending` status (`FOR UPDATE SKIP LOCKED`, migration 018),
 *    reusing the existing `next_retry_at` column as a claim "lease expiry"
 *    (no new column). Commits immediately — no provider call happens here.
 * 2. UPLOAD — for each claimed row, calls the resolved `ObjectUploader`
 *    (`../infrastructure/object-storage-uploader.ts`) *outside* any
 *    transaction.
 * 3. FINALIZE — one short transaction per row flips `sending` to `sent`, or
 *    (on failure) back to `pending` with backoff via the existing, reused
 *    `evaluateObjectRetry` (`../domain/object-queue.ts` — not
 *    reimplemented), or to `failed` once retries are exhausted.
 *
 * Idempotent by construction: `sent`/`failed` rows are never re-claimed
 * (claim only matches `pending`/stale-`sending`), and the upload's
 * destination key (`objectKey`) is itself the natural dedup key — an S3/R2
 * PUT to the same key is an overwrite, not a duplicate, so a row uploaded
 * twice (e.g. a crash between UPLOAD and FINALIZE, followed by a stale-lease
 * reclaim) has no duplicated external effect.
 *
 * If the object-storage circuit breaker is open, upload-required
 * (`requires_upload = true`) rows are not claimed at all this pass (left
 * untouched, still `pending`) — `requires_upload = false` rows (provider
 * off / STORAGE_DRIVER=local) are claimed and dispatched regardless, since
 * they never touch the breaker's provider in the first place (doc 16:
 * "provider opsional... fitur off tidak menghentikan aplikasi").
 */
import { getProviderCircuitBreaker } from "../../../lib/database/circuit-breaker";
import { withTenant } from "../../../lib/database/tenant-context";
import { log } from "../../../lib/logging/logger";
import { evaluateObjectRetry } from "../domain/object-queue";
import {
  resolveObjectUploader,
  type ObjectUploader,
  type UploadResult
} from "../infrastructure/object-storage-uploader";

const MODULE_KEY = "sync_storage";
const PROVIDER_KEY = "object-storage";

export const OBJECT_DISPATCH_DEFAULT_LIMIT = 25;
export const OBJECT_DISPATCH_LEASE_MINUTES = 2;

type ClaimedRow = {
  id: string;
  object_key: string;
  local_path: string;
  checksum_sha256: string;
  requires_upload: boolean;
  retry_count: string | number;
};

export type DispatchObjectSyncQueueOptions = {
  limit?: number;
  now?: Date;
  correlationId?: string;
  resolveUploader?: (requiresUpload: boolean) => ObjectUploader;
};

export type DispatchObjectSyncQueueResult = {
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  uploadBreakerOpen: boolean;
};

async function claimEligibleEntries(
  sql: Bun.SQL,
  tenantId: string,
  now: Date,
  limit: number,
  uploadBreakerOpen: boolean
): Promise<ClaimedRow[]> {
  const leaseExpiry = new Date(
    now.getTime() + OBJECT_DISPATCH_LEASE_MINUTES * 60_000
  );

  return withTenant(
    sql,
    tenantId,
    async (tx) => {
      const rows = uploadBreakerOpen
        ? await tx`
            UPDATE awcms_object_sync_queue
            SET status = 'sending', next_retry_at = ${leaseExpiry}
            WHERE id IN (
              SELECT id FROM awcms_object_sync_queue
              WHERE tenant_id = ${tenantId}
                AND (
                  (status = 'pending' AND requires_upload = false
                    AND (next_retry_at IS NULL OR next_retry_at <= ${now}))
                  OR (status = 'sending' AND requires_upload = false
                    AND next_retry_at <= ${now})
                )
              ORDER BY created_at
              LIMIT ${limit}
              FOR UPDATE SKIP LOCKED
            )
            RETURNING id, object_key, local_path, checksum_sha256, requires_upload, retry_count
          `
        : await tx`
            UPDATE awcms_object_sync_queue
            SET status = 'sending', next_retry_at = ${leaseExpiry}
            WHERE id IN (
              SELECT id FROM awcms_object_sync_queue
              WHERE tenant_id = ${tenantId}
                AND (
                  (status = 'pending'
                    AND (next_retry_at IS NULL OR next_retry_at <= ${now}))
                  OR (status = 'sending' AND next_retry_at <= ${now})
                )
              ORDER BY created_at
              LIMIT ${limit}
              FOR UPDATE SKIP LOCKED
            )
            RETURNING id, object_key, local_path, checksum_sha256, requires_upload, retry_count
          `;

      return rows as unknown as ClaimedRow[];
    },
    { workClass: "background_sync" }
  );
}

async function finalizeSent(
  sql: Bun.SQL,
  tenantId: string,
  id: string
): Promise<void> {
  await withTenant(
    sql,
    tenantId,
    (tx) => tx`
      UPDATE awcms_object_sync_queue
      SET status = 'sent', uploaded_at = now(), next_retry_at = null
      WHERE tenant_id = ${tenantId} AND id = ${id} AND status = 'sending'
    `,
    { workClass: "background_sync" }
  );
}

async function finalizeFailure(
  sql: Bun.SQL,
  tenantId: string,
  id: string,
  currentRetryCount: number,
  now: Date,
  errorMessage: string
): Promise<{ eligible: boolean }> {
  const evaluation = evaluateObjectRetry(currentRetryCount, now);

  if (evaluation.eligible) {
    await withTenant(
      sql,
      tenantId,
      (tx) => tx`
        UPDATE awcms_object_sync_queue
        SET status = 'pending', retry_count = ${currentRetryCount + 1},
            next_retry_at = ${evaluation.nextRetryAt}, last_error = ${errorMessage}
        WHERE tenant_id = ${tenantId} AND id = ${id} AND status = 'sending'
      `,
      { workClass: "background_sync" }
    );

    return { eligible: true };
  }

  await withTenant(
    sql,
    tenantId,
    (tx) => tx`
      UPDATE awcms_object_sync_queue
      SET status = 'failed', retry_count = ${currentRetryCount + 1},
          next_retry_at = null, last_error = ${errorMessage}
      WHERE tenant_id = ${tenantId} AND id = ${id} AND status = 'sending'
    `,
    { workClass: "background_sync" }
  );

  return { eligible: false };
}

/**
 * Dispatches one batch (default `OBJECT_DISPATCH_DEFAULT_LIMIT` rows) of due
 * `awcms_object_sync_queue` entries for a single tenant. Safe to call
 * repeatedly/concurrently (claim-lease pattern); call again in a loop (the
 * CLI script does) to drain a larger backlog.
 */
export async function dispatchObjectSyncQueue(
  sql: Bun.SQL,
  tenantId: string,
  options: DispatchObjectSyncQueueOptions = {}
): Promise<DispatchObjectSyncQueueResult> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? OBJECT_DISPATCH_DEFAULT_LIMIT;
  const correlationId = options.correlationId ?? crypto.randomUUID();
  const resolveUploader = options.resolveUploader ?? resolveObjectUploader;
  const breaker = getProviderCircuitBreaker(PROVIDER_KEY);
  const uploadBreakerOpen = !breaker.canAttempt(now);

  const claimed = await claimEligibleEntries(
    sql,
    tenantId,
    now,
    limit,
    uploadBreakerOpen
  );

  const result: DispatchObjectSyncQueueResult = {
    claimed: claimed.length,
    sent: 0,
    retried: 0,
    failed: 0,
    uploadBreakerOpen
  };

  if (claimed.length === 0) {
    return result;
  }

  log("info", "sync_storage.object_dispatch.claimed", {
    correlationId,
    tenantId,
    moduleKey: MODULE_KEY,
    count: claimed.length,
    uploadBreakerOpen
  });

  for (const entry of claimed) {
    const requiresUpload = entry.requires_upload;
    const retryCount = Number(entry.retry_count);
    const uploader = resolveUploader(requiresUpload);

    let uploadResult: UploadResult;

    try {
      uploadResult = await uploader({
        objectKey: entry.object_key,
        localPath: entry.local_path,
        checksumSha256: entry.checksum_sha256
      });
    } catch (error) {
      uploadResult = {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }

    if (uploadResult.ok) {
      await finalizeSent(sql, tenantId, entry.id);
      result.sent += 1;
      log("info", "sync_storage.object_dispatch.sent", {
        correlationId,
        tenantId,
        moduleKey: MODULE_KEY,
        objectKey: entry.object_key,
        requiresUpload
      });
      continue;
    }

    const finalizeOutcome = await finalizeFailure(
      sql,
      tenantId,
      entry.id,
      retryCount,
      now,
      uploadResult.error
    );

    if (finalizeOutcome.eligible) {
      result.retried += 1;
      log("warning", "sync_storage.object_dispatch.retry_scheduled", {
        correlationId,
        tenantId,
        moduleKey: MODULE_KEY,
        objectKey: entry.object_key,
        retryCount: retryCount + 1,
        error: uploadResult.error
      });
    } else {
      result.failed += 1;
      log("error", "sync_storage.object_dispatch.failed", {
        correlationId,
        tenantId,
        moduleKey: MODULE_KEY,
        objectKey: entry.object_key,
        retryCount: retryCount + 1,
        error: uploadResult.error
      });
    }
  }

  return result;
}
