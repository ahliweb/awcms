/**
 * Retention for the email outbox (Issue #468, ADR-0072). This module's
 * registered "delegated" adopter for both `dataLifecycle` descriptors in
 * `../module.ts`.
 *
 * Deliberately the same shape as `push-delivery/application/push-queue-purge.ts`
 * rather than a generalisation of it. The two queues have different terminal
 * status sets, different cursors, and different foreign keys, and a shared
 * helper parameterised over all three would be a place where one table's rule
 * could be applied to the other's data — which for a purge means deleting the
 * wrong rows, silently, on a schedule.
 *
 * ## Why delegated and not `generic`
 *
 * `HighVolumeTableDescriptor` carries a `cursorColumn` and NO status predicate,
 * so the generic executor deletes purely by age: `WHERE tenant_id = ? AND
 * <cursor> < ?`. Pointed at this table it deletes mail that has NOT been sent —
 * a message stuck behind a provider outage for longer than the retention window
 * would be dropped, and the drop would look exactly like successful
 * housekeeping. Every DELETE here names the terminal statuses explicitly.
 *
 * ## `suppressed` is terminal; `sending` is not
 *
 * The status list is easy to get wrong in both directions.
 * `suppressed` means the address was on the suppression list at dispatch time —
 * a final answer, and the row is history. `sending` looks transient enough to
 * skip past, and it is exactly the row that must never be deleted: it is
 * claimed by a dispatcher pass that may be mid-flight, and the claim lease is
 * what recovers it if that pass died.
 *
 * The two tables are purged in FK order — attempts, then messages — because
 * `awcms_email_delivery_attempts.message_id` references the other. Deleting a
 * message whose attempts still point at it fails on the foreign key, and a
 * purge that half-succeeds every night is worse than one that never runs: the
 * error is intermittent and the backlog still grows.
 */
import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import { recordAuditEvent } from "../../logging/application/audit-log";
import type { LegalHoldGuardPort } from "../../_shared/ports/legal-hold-guard-port";
import {
  EMAIL_ATTEMPTS_LIFECYCLE_KEY,
  EMAIL_MESSAGES_LIFECYCLE_KEY
} from "../module";

/**
 * Longer than the attempt ledger's, on purpose: this is the row an operator
 * names when a recipient says they never received something, and 90 days covers
 * a billing cycle's worth of "did you send my invoice".
 */
export const EMAIL_MESSAGE_DEFAULT_RETENTION_DAYS = 90;
export const EMAIL_ATTEMPT_DEFAULT_RETENTION_DAYS = 30;
export const EMAIL_PURGE_BATCH_LIMIT = 5000;

/**
 * Every status a row can hold once nothing further will happen to it.
 *
 * Exported and asserted against the migration's CHECK constraint by
 * `tests/email-queue-purge.test.ts`: a status added to the schema and not here
 * would accumulate forever with no error anywhere, and a status added HERE that
 * is not terminal would delete live work.
 */
export const EMAIL_TERMINAL_STATUSES = [
  "sent",
  "failed",
  "cancelled",
  "suppressed"
] as const;

const MODULE_KEY = "email";

export function resolveEmailRetentionCutoff(
  now: Date,
  retentionDays: number
): Date {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}

export type PurgeEmailQueueOptions = {
  messageRetentionDays?: number;
  attemptRetentionDays?: number;
  batchLimit?: number;
  now?: Date;
  correlationId?: string;
};

export type PurgeEmailQueueResult = {
  purgedAttempts: number;
  purgedMessages: number;
};

type IdRow = { id: string };

export async function purgeEmailQueue(
  sql: Bun.SQL,
  tenantId: string,
  legalHoldGuard: LegalHoldGuardPort,
  options: PurgeEmailQueueOptions = {}
): Promise<PurgeEmailQueueResult> {
  const now = options.now ?? new Date();
  const batchLimit = options.batchLimit ?? EMAIL_PURGE_BATCH_LIMIT;
  const messageCutoff = resolveEmailRetentionCutoff(
    now,
    options.messageRetentionDays ?? EMAIL_MESSAGE_DEFAULT_RETENTION_DAYS
  );
  const attemptCutoff = resolveEmailRetentionCutoff(
    now,
    options.attemptRetentionDays ?? EMAIL_ATTEMPT_DEFAULT_RETENTION_DAYS
  );

  return withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      const result: PurgeEmailQueueResult = {
        purgedAttempts: 0,
        purgedMessages: 0
      };

      // 1. Attempts. Gated on its OWN descriptor: a hold placed on the attempt
      //    ledger is a hold on the delivery evidence, which is the thing an
      //    investigation actually reads.
      if (
        !(await legalHoldGuard.isDescriptorHeld(
          tx,
          tenantId,
          EMAIL_ATTEMPTS_LIFECYCLE_KEY
        ))
      ) {
        const deleted = (await tx`
          DELETE FROM awcms_email_delivery_attempts
          WHERE id IN (
            SELECT id FROM awcms_email_delivery_attempts
            WHERE tenant_id = ${tenantId} AND attempted_at < ${attemptCutoff}
            ORDER BY attempted_at ASC
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
          EMAIL_MESSAGES_LIFECYCLE_KEY
        ))
      ) {
        const deleted = (await tx`
          DELETE FROM awcms_email_messages
          WHERE id IN (
            SELECT m.id FROM awcms_email_messages m
            WHERE m.tenant_id = ${tenantId}
              AND m.status IN ('sent', 'failed', 'cancelled', 'suppressed')
              AND m.updated_at < ${messageCutoff}
              -- An attempt row still pointing here means step 1 was bounded by
              -- its batch limit, not that this message may stay. Skipping it
              -- this pass is what keeps the FK intact without widening step 1.
              AND NOT EXISTS (
                SELECT 1 FROM awcms_email_delivery_attempts a
                WHERE a.tenant_id = m.tenant_id AND a.message_id = m.id
              )
            ORDER BY m.updated_at ASC
            LIMIT ${batchLimit}
          )
          RETURNING id
        `) as IdRow[];

        result.purgedMessages = deleted.length;
      }

      const total = result.purgedAttempts + result.purgedMessages;

      if (total > 0) {
        await recordAuditEvent(tx, {
          tenantId,
          moduleKey: MODULE_KEY,
          action: "purge",
          resourceType: "email_queue",
          severity: "info",
          message: `Email retention purge removed ${total} row(s).`,
          attributes: {
            purgedAttempts: result.purgedAttempts,
            purgedMessages: result.purgedMessages,
            messageCutoff: messageCutoff.toISOString(),
            attemptCutoff: attemptCutoff.toISOString(),
            ...(options.correlationId
              ? { correlationId: options.correlationId }
              : {})
          }
        });
      }

      return result;
    },
    { workClass: "maintenance" }
  );
}
