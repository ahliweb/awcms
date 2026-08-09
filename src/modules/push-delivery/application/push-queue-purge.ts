/**
 * Retention for the push tables (Issue #465). This module's registered
 * "delegated" adopter for all three `dataLifecycle` descriptors in
 * `../module.ts`, in the shape `form-drafts/application/form-draft-purge.ts`
 * and `logging/application/audit-purge.ts` already use: bounded batches,
 * legal-hold gated, self-auditing.
 *
 * ## Why delegated and not `generic`
 *
 * `HighVolumeTableDescriptor` carries a `cursorColumn` and NO status predicate,
 * so the generic executor deletes purely by age: `WHERE tenant_id = ? AND
 * <cursor> < ?`. Pointed at a QUEUE, that deletes rows that are still waiting
 * to be delivered — a message stuck behind a provider outage for longer than
 * the retention window would be silently dropped, and the drop would look
 * exactly like successful housekeeping. Every DELETE here therefore names the
 * TERMINAL statuses explicitly, and the cursor is `updated_at`, the moment a
 * row stopped moving, not `created_at`, which would make a long-retried message
 * look older than it is.
 *
 * The three tables are purged in FK order — attempts, then messages, then
 * subscriptions — because each is the child of the next. Deleting a message
 * whose attempts still reference it would fail on the foreign key, and a purge
 * that half-succeeds every night is worse than one that never runs, because the
 * error is intermittent and the backlog still grows.
 */
import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import { recordAuditEvent } from "../../logging/application/audit-log";
import type { LegalHoldGuardPort } from "../../_shared/ports/legal-hold-guard-port";
import {
  PUSH_ATTEMPTS_LIFECYCLE_KEY,
  PUSH_MESSAGES_LIFECYCLE_KEY,
  PUSH_SUBSCRIPTIONS_LIFECYCLE_KEY
} from "../module";

export const PUSH_MESSAGE_DEFAULT_RETENTION_DAYS = 30;
export const PUSH_ATTEMPT_DEFAULT_RETENTION_DAYS = 30;
/**
 * Longer than the queue's, on purpose. A disabled subscription is the evidence
 * that answers "why did this user stop receiving notifications", and that
 * question is asked weeks after the fact, not days.
 */
export const PUSH_SUBSCRIPTION_DEFAULT_RETENTION_DAYS = 180;
export const PUSH_PURGE_BATCH_LIMIT = 5000;

const MODULE_KEY = "push_delivery";

export function resolvePushRetentionCutoff(
  now: Date,
  retentionDays: number
): Date {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}

export type PurgePushQueueOptions = {
  messageRetentionDays?: number;
  attemptRetentionDays?: number;
  subscriptionRetentionDays?: number;
  batchLimit?: number;
  now?: Date;
  correlationId?: string;
};

export type PurgePushQueueResult = {
  purgedAttempts: number;
  purgedMessages: number;
  purgedSubscriptions: number;
};

type IdRow = { id: string };

export async function purgePushQueue(
  sql: Bun.SQL,
  tenantId: string,
  legalHoldGuard: LegalHoldGuardPort,
  options: PurgePushQueueOptions = {}
): Promise<PurgePushQueueResult> {
  const now = options.now ?? new Date();
  const batchLimit = options.batchLimit ?? PUSH_PURGE_BATCH_LIMIT;
  const messageCutoff = resolvePushRetentionCutoff(
    now,
    options.messageRetentionDays ?? PUSH_MESSAGE_DEFAULT_RETENTION_DAYS
  );
  const attemptCutoff = resolvePushRetentionCutoff(
    now,
    options.attemptRetentionDays ?? PUSH_ATTEMPT_DEFAULT_RETENTION_DAYS
  );
  const subscriptionCutoff = resolvePushRetentionCutoff(
    now,
    options.subscriptionRetentionDays ??
      PUSH_SUBSCRIPTION_DEFAULT_RETENTION_DAYS
  );

  return withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      const result: PurgePushQueueResult = {
        purgedAttempts: 0,
        purgedMessages: 0,
        purgedSubscriptions: 0
      };

      // 1. Attempts. Gated on its OWN descriptor: a hold placed on the attempt
      //    ledger is a hold on the delivery evidence, which is the thing an
      //    investigation actually reads.
      if (
        !(await legalHoldGuard.isDescriptorHeld(
          tx,
          tenantId,
          PUSH_ATTEMPTS_LIFECYCLE_KEY
        ))
      ) {
        const deleted = (await tx`
          DELETE FROM awcms_push_delivery_attempts
          WHERE id IN (
            SELECT id FROM awcms_push_delivery_attempts
            WHERE tenant_id = ${tenantId} AND created_at < ${attemptCutoff}
            ORDER BY created_at ASC
            LIMIT ${batchLimit}
          )
          RETURNING id
        `) as IdRow[];

        result.purgedAttempts = deleted.length;
      }

      // 2. Messages — TERMINAL only. `queued`/`retry_wait`/`sending` are work,
      //    not history, however old they are.
      if (
        !(await legalHoldGuard.isDescriptorHeld(
          tx,
          tenantId,
          PUSH_MESSAGES_LIFECYCLE_KEY
        ))
      ) {
        const deleted = (await tx`
          DELETE FROM awcms_push_messages
          WHERE id IN (
            SELECT m.id FROM awcms_push_messages m
            WHERE m.tenant_id = ${tenantId}
              AND m.status IN ('sent', 'failed', 'cancelled')
              AND m.updated_at < ${messageCutoff}
              -- An attempt row still pointing here means step 1 was bounded by
              -- its batch limit, not that this message may stay. Skipping it
              -- this pass is what keeps the FK intact without widening step 1.
              AND NOT EXISTS (
                SELECT 1 FROM awcms_push_delivery_attempts a
                WHERE a.tenant_id = m.tenant_id AND a.message_id = m.id
              )
            ORDER BY m.updated_at ASC
            LIMIT ${batchLimit}
          )
          RETURNING id
        `) as IdRow[];

        result.purgedMessages = deleted.length;
      }

      // 3. Subscriptions — DISABLED only, and only once nothing references them.
      //    An `active` subscription has no age at which it stops being valid;
      //    a browser that has not been opened in a year still gets its
      //    notification the moment it is.
      if (
        !(await legalHoldGuard.isDescriptorHeld(
          tx,
          tenantId,
          PUSH_SUBSCRIPTIONS_LIFECYCLE_KEY
        ))
      ) {
        const deleted = (await tx`
          DELETE FROM awcms_push_subscriptions
          WHERE id IN (
            SELECT s.id FROM awcms_push_subscriptions s
            WHERE s.tenant_id = ${tenantId}
              AND s.status = 'disabled'
              AND s.updated_at < ${subscriptionCutoff}
              AND NOT EXISTS (
                SELECT 1 FROM awcms_push_messages m
                WHERE m.tenant_id = s.tenant_id AND m.subscription_id = s.id
              )
            ORDER BY s.updated_at ASC
            LIMIT ${batchLimit}
          )
          RETURNING id
        `) as IdRow[];

        result.purgedSubscriptions = deleted.length;
      }

      const total =
        result.purgedAttempts +
        result.purgedMessages +
        result.purgedSubscriptions;

      if (total > 0) {
        await recordAuditEvent(tx, {
          tenantId,
          moduleKey: MODULE_KEY,
          action: "purge",
          resourceType: "push_queue",
          severity: "warning",
          message: `Purged ${total} push delivery row(s) past retention.`,
          attributes: {
            purgedAttempts: result.purgedAttempts,
            purgedMessages: result.purgedMessages,
            purgedSubscriptions: result.purgedSubscriptions,
            messageCutoffIso: messageCutoff.toISOString(),
            attemptCutoffIso: attemptCutoff.toISOString(),
            subscriptionCutoffIso: subscriptionCutoff.toISOString()
          },
          correlationId: options.correlationId
        });
      }

      return result;
    },
    { workClass: "maintenance" }
  );
}
