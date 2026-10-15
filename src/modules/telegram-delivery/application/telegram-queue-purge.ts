/**
 * Retention and expiry for the Telegram tables (Issue #965, ADR-0140 sections 5.7
 * and 9). This module's registered "delegated" adopter for the `dataLifecycle`
 * descriptors in `../module.ts`, in the shape
 * `whatsapp-delivery/application/whatsapp-queue-purge.ts` uses: bounded batches,
 * legal-hold gated, self-auditing.
 *
 * ## Why delegated and not `generic`
 *
 * The generic executor deletes by age with no status predicate. Pointed at a
 * QUEUE that deletes rows still waiting for delivery. Every DELETE here names the
 * TERMINAL statuses explicitly, and the cursor is `updated_at` (the moment a row
 * stopped moving), never age alone.
 *
 * ## It also ENFORCES EXPIRY, independently of the dispatcher
 *
 * ADR-0140 section 5.7: expiry is enforced by the purge, not trusted to the
 * dispatcher. A message past its `expires_at` that nobody claims (the flag was
 * turned off, the breaker is open, the tenant is not being dispatched) would
 * otherwise sit queued indefinitely and then be sent late. This job runs
 * regardless of the flag, the breaker and the tenant's dispatch state, so any
 * non-terminal row past its expiry becomes `expired`. It never deletes a waiting
 * row.
 *
 * ## And it backstops the erasure of unconfirmed chats
 *
 * A pending binding whose confirmation window passed is ended here too (cause
 * `confirmation_expired`): ciphertext nulled, captured display name cleared. The
 * dispatcher does the same every pass; this covers a tenant it is not draining.
 *
 * Order, for the foreign keys: attempts, then messages, then bindings (a binding
 * is deleted only once nothing references it), then link codes.
 */
import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import { recordAuditEvent } from "../../logging/application/audit-log";
import type { LegalHoldGuardPort } from "../../_shared/ports/legal-hold-guard-port";
import {
  TELEGRAM_ATTEMPTS_LIFECYCLE_KEY,
  TELEGRAM_BINDINGS_LIFECYCLE_KEY,
  TELEGRAM_LINK_CODES_LIFECYCLE_KEY,
  TELEGRAM_MESSAGES_LIFECYCLE_KEY,
  TELEGRAM_MODULE_KEY
} from "../domain/telegram-constants";
import { sweepIneligibleBindings } from "./telegram-binding-sweep";

export const TELEGRAM_PURGE_BATCH_LIMIT = 5000;

export function resolveTelegramRetentionCutoff(
  now: Date,
  retentionDays: number
): Date {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}

export type PurgeTelegramQueueOptions = {
  messageRetentionDays?: number;
  attemptRetentionDays?: number;
  bindingRetentionDays?: number;
  linkCodeRetentionDays?: number;
  batchLimit?: number;
  now?: Date;
  correlationId?: string;
};

export type PurgeTelegramQueueResult = {
  /** Non-terminal rows past their expiry that were marked `expired`. */
  expiredMessages: number;
  /** Pending bindings past their confirmation window that were ended (ciphertext erased). */
  expiredBindings: number;
  /** Live bindings ended because the module or tenant switch is off, or the person left (ciphertext erased). */
  sweptBindings: number;
  purgedAttempts: number;
  purgedMessages: number;
  purgedBindings: number;
  purgedLinkCodes: number;
};

type IdRow = { id: string };

export async function purgeTelegramQueue(
  sql: Bun.SQL,
  tenantId: string,
  legalHoldGuard: LegalHoldGuardPort,
  options: PurgeTelegramQueueOptions = {}
): Promise<PurgeTelegramQueueResult> {
  const now = options.now ?? new Date();
  const batchLimit = options.batchLimit ?? TELEGRAM_PURGE_BATCH_LIMIT;
  const messageCutoff = resolveTelegramRetentionCutoff(
    now,
    options.messageRetentionDays ?? 14
  );
  const attemptCutoff = resolveTelegramRetentionCutoff(
    now,
    options.attemptRetentionDays ?? options.messageRetentionDays ?? 14
  );
  const bindingCutoff = resolveTelegramRetentionCutoff(
    now,
    options.bindingRetentionDays ?? 90
  );
  const linkCodeCutoff = resolveTelegramRetentionCutoff(
    now,
    options.linkCodeRetentionDays ?? 1
  );

  return withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      const result: PurgeTelegramQueueResult = {
        expiredMessages: 0,
        expiredBindings: 0,
        sweptBindings: 0,
        purgedAttempts: 0,
        purgedMessages: 0,
        purgedBindings: 0,
        purgedLinkCodes: 0
      };

      // Not legal-hold gated: this changes a row's state, it deletes nothing.
      const expired = (await tx`
        WITH due AS MATERIALIZED (
          SELECT id FROM awcms_telegram_messages
          WHERE tenant_id = ${tenantId} AND expires_at <= ${now}
            AND (status IN ('queued', 'retry_wait')
                 OR (status = 'sending' AND next_attempt_at <= ${now}))
          ORDER BY expires_at ASC
          LIMIT ${batchLimit}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE awcms_telegram_messages AS t
        SET status = 'expired', next_attempt_at = NULL, failure_code = 'expired',
            last_error = 'Message passed its expiry before it was sent.',
            body = '', variables = '{}'::jsonb, updated_at = now()
        FROM due
        WHERE t.id = due.id AND t.tenant_id = ${tenantId}
        RETURNING t.id
      `) as IdRow[];

      result.expiredMessages = expired.length;
      // Whether or not TELEGRAM_ENABLED is on and whether or not the module is on
      // for this tenant: it is what erases a stored chat id nobody else will.
      const swept = await sweepIneligibleBindings(tx, tenantId, now, {
        ...(options.correlationId
          ? { correlationId: options.correlationId }
          : {})
      });

      result.expiredBindings = swept.expiredPending;
      result.sweptBindings = swept.endedByGate + swept.endedByPrincipal;

      if (
        !(await legalHoldGuard.isDescriptorHeld(
          tx,
          tenantId,
          TELEGRAM_ATTEMPTS_LIFECYCLE_KEY
        ))
      ) {
        const deleted = (await tx`
          DELETE FROM awcms_telegram_delivery_attempts
          WHERE id IN (
            SELECT id FROM awcms_telegram_delivery_attempts
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
          TELEGRAM_MESSAGES_LIFECYCLE_KEY
        ))
      ) {
        const deleted = (await tx`
          DELETE FROM awcms_telegram_messages
          WHERE id IN (
            SELECT m.id FROM awcms_telegram_messages m
            WHERE m.tenant_id = ${tenantId}
              AND m.status IN ('sent', 'failed', 'cancelled', 'expired')
              AND m.updated_at < ${messageCutoff}
              AND NOT EXISTS (
                SELECT 1 FROM awcms_telegram_delivery_attempts a
                WHERE a.tenant_id = m.tenant_id AND a.message_id = m.id
              )
            ORDER BY m.updated_at ASC
            LIMIT ${batchLimit}
          )
          RETURNING id
        `) as IdRow[];

        result.purgedMessages = deleted.length;
      }

      // Revoked and suspended bindings only (their ciphertext was erased the
      // moment they ended), and only once no message row still references them.
      if (
        !(await legalHoldGuard.isDescriptorHeld(
          tx,
          tenantId,
          TELEGRAM_BINDINGS_LIFECYCLE_KEY
        ))
      ) {
        const deleted = (await tx`
          DELETE FROM awcms_telegram_bindings
          WHERE id IN (
            SELECT b.id FROM awcms_telegram_bindings b
            WHERE b.tenant_id = ${tenantId}
              AND b.status IN ('revoked', 'suspended')
              AND b.updated_at < ${bindingCutoff}
              AND NOT EXISTS (
                SELECT 1 FROM awcms_telegram_messages m
                WHERE m.tenant_id = b.tenant_id AND m.binding_id = b.id
              )
            ORDER BY b.updated_at ASC
            LIMIT ${batchLimit}
          )
          RETURNING id
        `) as IdRow[];

        result.purgedBindings = deleted.length;
      }

      if (
        !(await legalHoldGuard.isDescriptorHeld(
          tx,
          tenantId,
          TELEGRAM_LINK_CODES_LIFECYCLE_KEY
        ))
      ) {
        const deleted = (await tx`
          DELETE FROM awcms_telegram_link_codes
          WHERE id IN (
            SELECT id FROM awcms_telegram_link_codes
            WHERE tenant_id = ${tenantId} AND expires_at < ${linkCodeCutoff}
            ORDER BY expires_at ASC
            LIMIT ${batchLimit}
          )
          RETURNING id
        `) as IdRow[];

        result.purgedLinkCodes = deleted.length;
      }

      const total =
        result.expiredMessages +
        result.expiredBindings +
        result.sweptBindings +
        result.purgedAttempts +
        result.purgedMessages +
        result.purgedBindings +
        result.purgedLinkCodes;

      if (total > 0) {
        await recordAuditEvent(tx, {
          tenantId,
          moduleKey: TELEGRAM_MODULE_KEY,
          action: "purge",
          resourceType: "telegram_queue",
          severity: "warning",
          message: `Expired or purged ${total} Telegram delivery row(s) past expiry or retention.`,
          attributes: {
            ...result,
            messageCutoffIso: messageCutoff.toISOString(),
            bindingCutoffIso: bindingCutoff.toISOString(),
            linkCodeCutoffIso: linkCodeCutoff.toISOString()
          },
          ...(options.correlationId
            ? { correlationId: options.correlationId }
            : {})
        });
      }

      return result;
    },
    { workClass: "maintenance" }
  );
}
