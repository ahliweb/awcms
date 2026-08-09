/**
 * Retention for the object sync upload queue (Issue #468, ADR-0072). This
 * module's registered "delegated" adopter for the `dataLifecycle` descriptor in
 * `../module.ts`.
 *
 * ## Why delegated and not `generic`
 *
 * `HighVolumeTableDescriptor` carries a `cursorColumn` and NO status predicate,
 * so the generic executor deletes purely by age. Pointed at this queue it would
 * delete uploads that have not happened yet — and `sending` in particular,
 * which is a row claimed by a dispatcher pass whose lease (`next_retry_at`) is
 * the only thing that recovers it if that pass died. The DELETE below names the
 * two terminal statuses.
 *
 * ## The cursor is `created_at`, and that is forced rather than chosen
 *
 * The email and push queues sweep on `updated_at` — the moment a row stopped
 * moving. This table has no such column. `uploaded_at` looks like the right
 * substitute and is the wrong one: it is NULL for every `failed` row, so a
 * cursor on it would make failures immortal — the one class of row an operator
 * most wants bounded. So `created_at` it is, with the honest consequence that a
 * row which retried for a week is measured from before its last attempt. For a
 * 90-day window that is noise; it is written down because it is the kind of
 * thing a reader would otherwise assume was an oversight.
 */
import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import { recordAuditEvent } from "../../logging/application/audit-log";
import type { LegalHoldGuardPort } from "../../_shared/ports/legal-hold-guard-port";
import { OBJECT_SYNC_QUEUE_LIFECYCLE_KEY } from "../module";

/**
 * Longer than the email queue's, on purpose: a `failed` upload is the record of
 * a file that never reached object storage, and reconciling that against the
 * media library is not a same-week activity.
 */
export const OBJECT_QUEUE_DEFAULT_RETENTION_DAYS = 90;
export const OBJECT_QUEUE_PURGE_BATCH_LIMIT = 5000;

/**
 * Every status a row can hold once the dispatcher will not touch it again.
 *
 * `sending` is deliberately absent and is the one worth naming: it reads as
 * transient enough to ignore and is exactly the row that must survive, because
 * it may be mid-upload right now.
 */
export const OBJECT_QUEUE_TERMINAL_STATUSES = ["sent", "failed"] as const;

const MODULE_KEY = "sync_storage";

export function resolveObjectQueueRetentionCutoff(
  now: Date,
  retentionDays: number
): Date {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}

export type PurgeObjectSyncQueueOptions = {
  retentionDays?: number;
  batchLimit?: number;
  now?: Date;
  correlationId?: string;
};

export type PurgeObjectSyncQueueResult = { purgedRows: number };

type IdRow = { id: string };

export async function purgeObjectSyncQueue(
  sql: Bun.SQL,
  tenantId: string,
  legalHoldGuard: LegalHoldGuardPort,
  options: PurgeObjectSyncQueueOptions = {}
): Promise<PurgeObjectSyncQueueResult> {
  const now = options.now ?? new Date();
  const batchLimit = options.batchLimit ?? OBJECT_QUEUE_PURGE_BATCH_LIMIT;
  const cutoff = resolveObjectQueueRetentionCutoff(
    now,
    options.retentionDays ?? OBJECT_QUEUE_DEFAULT_RETENTION_DAYS
  );

  return withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      if (
        await legalHoldGuard.isDescriptorHeld(
          tx,
          tenantId,
          OBJECT_SYNC_QUEUE_LIFECYCLE_KEY
        )
      ) {
        return { purgedRows: 0 };
      }

      const deleted = (await tx`
        DELETE FROM awcms_object_sync_queue
        WHERE id IN (
          SELECT id FROM awcms_object_sync_queue
          WHERE tenant_id = ${tenantId}
            AND status IN ('sent', 'failed')
            AND created_at < ${cutoff}
          ORDER BY created_at ASC
          LIMIT ${batchLimit}
        )
        RETURNING id
      `) as IdRow[];

      if (deleted.length > 0) {
        await recordAuditEvent(tx, {
          tenantId,
          moduleKey: MODULE_KEY,
          action: "purge",
          resourceType: "object_sync_queue",
          severity: "info",
          message: `Object sync queue retention purge removed ${deleted.length} row(s).`,
          attributes: {
            purgedRows: deleted.length,
            cutoff: cutoff.toISOString(),
            ...(options.correlationId
              ? { correlationId: options.correlationId }
              : {})
          }
        });
      }

      return { purgedRows: deleted.length };
    },
    { workClass: "maintenance" }
  );
}
