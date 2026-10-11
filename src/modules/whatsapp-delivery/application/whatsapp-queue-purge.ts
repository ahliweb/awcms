/**
 * Retention for the WhatsApp tables (Issue #963). This module's registered
 * "delegated" adopter for the `dataLifecycle` descriptors in `../module.ts`, in
 * the shape `push-delivery/application/push-queue-purge.ts` uses: bounded
 * batches, legal-hold gated, self-auditing.
 *
 * ## Why delegated and not `generic`
 *
 * The generic executor deletes by age with no status predicate. Pointed at a
 * QUEUE that deletes rows still waiting for delivery: a message stuck behind a
 * provider outage (or a reminder scheduled days ahead) for longer than the
 * retention window would be silently dropped, and look like housekeeping. Every
 * DELETE here names the TERMINAL statuses explicitly, and the cursor is
 * `updated_at` (the moment a row stopped moving), never age alone.
 *
 * ## It also EXPIRES stale messages (audit F5)
 *
 * A `security` message past its `expires_at` that nobody claims (the flag was
 * turned off, the breaker is open, the tenant is not being dispatched) would sit
 * in the queue with its OTP in `body` and `variables` indefinitely. This job
 * runs regardless of the flag, the breaker and the tenant's dispatch state, so
 * it is the backstop: any non-terminal row past its expiry becomes `expired` and
 * a secret-bearing one is cleared. It never deletes a waiting row.
 *
 * Attempts are purged before messages (FK order). Consents and suppressions are
 * NOT purged: they are privacy decisions, and deleting a suppression would
 * silently resume sending to someone who asked to stop.
 */
import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import { recordAuditEvent } from "../../logging/application/audit-log";
import { WHATSAPP_MESSAGE_EXPIRED_EVENT_TYPE } from "../domain/whatsapp-events";
import { emitWhatsappMessageEvent } from "./whatsapp-event-emit";
import type { LegalHoldGuardPort } from "../../_shared/ports/legal-hold-guard-port";
import {
  WHATSAPP_ATTEMPTS_LIFECYCLE_KEY,
  WHATSAPP_MESSAGES_LIFECYCLE_KEY
} from "../domain/whatsapp-lifecycle-keys";

export const WHATSAPP_MESSAGE_DEFAULT_RETENTION_DAYS = 30;
export const WHATSAPP_ATTEMPT_DEFAULT_RETENTION_DAYS = 30;
export const WHATSAPP_PURGE_BATCH_LIMIT = 5000;

const MODULE_KEY = "whatsapp_delivery";

export function resolveWhatsappRetentionCutoff(
  now: Date,
  retentionDays: number
): Date {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}

export type PurgeWhatsappQueueOptions = {
  messageRetentionDays?: number;
  attemptRetentionDays?: number;
  batchLimit?: number;
  now?: Date;
  correlationId?: string;
};

export type PurgeWhatsappQueueResult = {
  purgedAttempts: number;
  purgedMessages: number;
  /** Non-terminal rows past their expiry that were marked `expired` (secrets cleared). */
  expiredMessages: number;
};

type IdRow = { id: string };

export async function purgeWhatsappQueue(
  sql: Bun.SQL,
  tenantId: string,
  legalHoldGuard: LegalHoldGuardPort,
  options: PurgeWhatsappQueueOptions = {}
): Promise<PurgeWhatsappQueueResult> {
  const now = options.now ?? new Date();
  const batchLimit = options.batchLimit ?? WHATSAPP_PURGE_BATCH_LIMIT;
  const messageCutoff = resolveWhatsappRetentionCutoff(
    now,
    options.messageRetentionDays ?? WHATSAPP_MESSAGE_DEFAULT_RETENTION_DAYS
  );
  const attemptCutoff = resolveWhatsappRetentionCutoff(
    now,
    options.attemptRetentionDays ?? WHATSAPP_ATTEMPT_DEFAULT_RETENTION_DAYS
  );

  return withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      const result: PurgeWhatsappQueueResult = {
        purgedAttempts: 0,
        purgedMessages: 0,
        expiredMessages: 0
      };

      // Not legal-hold gated: this changes a row's state and clears a secret, it
      // deletes nothing.
      const expired = (await tx`
        UPDATE awcms_whatsapp_messages
        SET status = 'expired', next_attempt_at = NULL, failure_code = 'expired',
            last_error = 'Message passed its expiry before it was sent.',
            body = CASE WHEN contains_secret THEN '' ELSE body END,
            variables = CASE WHEN contains_secret THEN '{}'::jsonb
                             ELSE variables END,
            updated_at = now()
        WHERE id IN (
          SELECT id FROM awcms_whatsapp_messages
          WHERE tenant_id = ${tenantId} AND expires_at IS NOT NULL
            AND expires_at <= ${now}
            AND (status IN ('queued', 'retry_wait')
                 OR (status = 'sending' AND next_attempt_at <= ${now}))
          ORDER BY expires_at ASC
          LIMIT ${batchLimit}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id, template_key, purpose, recipient_masked, correlation_id
      `) as {
        id: string;
        template_key: string;
        purpose: string;
        recipient_masked: string;
        correlation_id: string | null;
      }[];

      for (const row of expired) {
        await emitWhatsappMessageEvent(
          tx,
          tenantId,
          WHATSAPP_MESSAGE_EXPIRED_EVENT_TYPE,
          {
            messageId: row.id,
            templateKey: row.template_key,
            purpose: row.purpose,
            recipientMasked: row.recipient_masked,
            status: "expired",
            failureCode: "expired",
            correlationId: row.correlation_id
          }
        );
      }

      result.expiredMessages = expired.length;

      if (
        !(await legalHoldGuard.isDescriptorHeld(
          tx,
          tenantId,
          WHATSAPP_ATTEMPTS_LIFECYCLE_KEY
        ))
      ) {
        const deleted = (await tx`
          DELETE FROM awcms_whatsapp_delivery_attempts
          WHERE id IN (
            SELECT id FROM awcms_whatsapp_delivery_attempts
            WHERE tenant_id = ${tenantId} AND created_at < ${attemptCutoff}
            ORDER BY created_at ASC
            LIMIT ${batchLimit}
          )
          RETURNING id
        `) as IdRow[];

        result.purgedAttempts = deleted.length;
      }

      // TERMINAL only: `queued`/`retry_wait`/`sending` are work, not history,
      // however old they are.
      if (
        !(await legalHoldGuard.isDescriptorHeld(
          tx,
          tenantId,
          WHATSAPP_MESSAGES_LIFECYCLE_KEY
        ))
      ) {
        const deleted = (await tx`
          DELETE FROM awcms_whatsapp_messages
          WHERE id IN (
            SELECT m.id FROM awcms_whatsapp_messages m
            WHERE m.tenant_id = ${tenantId}
              AND m.status IN ('sent', 'failed', 'cancelled', 'expired')
              AND m.updated_at < ${messageCutoff}
              AND NOT EXISTS (
                SELECT 1 FROM awcms_whatsapp_delivery_attempts a
                WHERE a.tenant_id = m.tenant_id AND a.message_id = m.id
              )
            ORDER BY m.updated_at ASC
            LIMIT ${batchLimit}
          )
          RETURNING id
        `) as IdRow[];

        result.purgedMessages = deleted.length;
      }

      const total =
        result.purgedAttempts + result.purgedMessages + result.expiredMessages;

      if (total > 0) {
        await recordAuditEvent(tx, {
          tenantId,
          moduleKey: MODULE_KEY,
          action: "purge",
          resourceType: "whatsapp_queue",
          severity: "warning",
          message: `Expired or purged ${total} WhatsApp delivery row(s) past expiry or retention.`,
          attributes: {
            purgedAttempts: result.purgedAttempts,
            purgedMessages: result.purgedMessages,
            expiredMessages: result.expiredMessages,
            messageCutoffIso: messageCutoff.toISOString(),
            attemptCutoffIso: attemptCutoff.toISOString()
          },
          correlationId: options.correlationId
        });
      }

      return result;
    },
    { workClass: "maintenance" }
  );
}
