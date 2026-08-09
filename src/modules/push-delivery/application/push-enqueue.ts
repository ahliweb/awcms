/**
 * Enqueue side of the push outbox (Issue #465).
 *
 * Takes an already-open transaction so a caller can enqueue in the SAME
 * transaction that produced the thing worth notifying about. That is the whole
 * point of an outbox: the notification is committed with the fact, or neither
 * is. A caller that enqueued afterwards, in its own transaction, would send
 * notifications about work that later rolled back — the failure mode ADR-0006's
 * transactional-outbox rule exists to prevent.
 *
 * Nothing here touches a provider, and nothing here can: sending happens in
 * `./push-dispatch.ts`, outside any transaction.
 */
import { log } from "../../../lib/logging/logger";
import { validatePushTargetPath } from "../domain/push-target-path";
import { fetchActiveSubscriptionIds } from "./subscription-directory";

const MODULE_KEY = "push_delivery";

export type EnqueuePushInput = {
  category: string;
  title: string;
  body: string;
  /** Same-origin path only — see `../domain/push-target-path.ts`. */
  targetPath?: string;
  data?: Record<string, string>;
  priority?: "low" | "normal" | "high";
  correlationId?: string;
  createdBy?: string;
};

export type EnqueuePushResult = {
  /** One per subscription actually queued. Empty is a NORMAL outcome — the recipient has no active device. */
  messageIds: string[];
  /** Recipients that resolved to zero active subscriptions. Reported, never treated as an error. */
  skippedRecipients: string[];
};

export class PushTargetPathError extends Error {}

/**
 * Fans one notification out to every ACTIVE subscription of every recipient.
 *
 * One row per (message, subscription) — the "one row per delivery unit" shape
 * `awcms_email_messages` uses. A single row fanning out internally would make
 * partial failure unrepresentable: with three devices and one dead endpoint,
 * there is no honest single status to write.
 *
 * A recipient with no active subscription is NOT an error and does not throw.
 * Most users will never enable push, and a notification helper that throws for
 * the common case would push every caller into a try/catch that swallows real
 * failures too.
 */
export async function enqueuePushToRecipients(
  tx: Bun.TransactionSQL,
  tenantId: string,
  recipientTenantUserIds: readonly string[],
  input: EnqueuePushInput
): Promise<EnqueuePushResult> {
  let targetPath: string | null = null;

  if (input.targetPath !== undefined) {
    const validation = validatePushTargetPath(input.targetPath);

    if (!validation.valid) {
      // Thrown, not returned as a soft result: an invalid target path is a
      // programming error at the call site, and writing the row anyway would
      // put a click destination we refused to validate in front of a user.
      throw new PushTargetPathError(validation.reason);
    }

    targetPath = validation.path;
  }

  const messageIds: string[] = [];
  const skippedRecipients: string[] = [];

  for (const tenantUserId of recipientTenantUserIds) {
    const subscriptionIds = await fetchActiveSubscriptionIds(
      tx,
      tenantId,
      tenantUserId
    );

    if (subscriptionIds.length === 0) {
      skippedRecipients.push(tenantUserId);
      continue;
    }

    for (const subscriptionId of subscriptionIds) {
      const rows = (await tx`
        INSERT INTO awcms_push_messages
          (tenant_id, correlation_id, category, subscription_id, priority,
           title, body, target_path, data, created_by)
        VALUES (
          ${tenantId}, ${input.correlationId ?? null}, ${input.category},
          ${subscriptionId}, ${input.priority ?? "normal"}, ${input.title},
          ${input.body}, ${targetPath}, ${input.data ?? null},
          ${input.createdBy ?? null}
        )
        RETURNING id
      `) as { id: string }[];

      messageIds.push(rows[0]!.id);
    }
  }

  log("info", "push.enqueue.queued", {
    tenantId,
    moduleKey: MODULE_KEY,
    correlationId: input.correlationId,
    category: input.category,
    queuedCount: messageIds.length,
    skippedRecipientCount: skippedRecipients.length
  });

  return { messageIds, skippedRecipients };
}

/**
 * Cancels a still-queued message. Refuses `sending`, exactly as
 * `cancelEmailMessage` does: the row is claimed by a dispatcher pass that may
 * already have handed it to a provider, and a cancel that raced a send would
 * record a lie.
 */
export async function cancelPushMessage(
  tx: Bun.TransactionSQL,
  tenantId: string,
  messageId: string
): Promise<{ cancelled: boolean }> {
  const rows = (await tx`
    UPDATE awcms_push_messages
    SET status = 'cancelled', next_attempt_at = null, updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${messageId}
      AND status IN ('queued', 'retry_wait')
    RETURNING id
  `) as { id: string }[];

  return { cancelled: rows.length > 0 };
}
