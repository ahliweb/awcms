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
import { fetchActiveSubscriptionIdsForUsers } from "./subscription-directory";

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
 * One INSERT for the whole fan-out.
 *
 * `jsonb_to_recordset` rather than `INSERT ... SELECT unnest(...)` for the same
 * reason `recordAuditEvents` uses it: this table has four nullable columns and
 * a `jsonb` one, and a Bun.SQL array cannot carry NULL — it writes the literal
 * string `'null'` without throwing. JSON `null` maps to SQL NULL natively, and
 * `data` arrives as a jsonb object rather than a jsonb STRING.
 *
 * `ORDER BY entry.ordinal` makes the insert order deterministic. It is NOT a
 * promise about `RETURNING`: Postgres does not specify the order rows come back
 * in, and no caller may treat `messageIds` as positionally aligned with the
 * recipients — it is a set of receipts. The ordering is here so that two runs
 * of the same batch write rows in the same sequence, which is what makes the
 * `created_at` tiebreak in the dispatcher's claim stable.
 */
async function insertMessages(
  tx: Bun.TransactionSQL,
  rows: readonly Record<string, unknown>[]
): Promise<string[]> {
  const inserted = (await tx`
    INSERT INTO awcms_push_messages
      (tenant_id, correlation_id, category, subscription_id, priority,
       title, body, target_path, data, created_by)
    SELECT entry.tenant_id, entry.correlation_id, entry.category,
           entry.subscription_id, entry.priority, entry.title, entry.body,
           entry.target_path, entry.data, entry.created_by
    FROM jsonb_to_recordset(${rows}::jsonb) AS entry (
      ordinal integer,
      tenant_id uuid,
      correlation_id text,
      category text,
      subscription_id uuid,
      priority text,
      title text,
      body text,
      target_path text,
      data jsonb,
      created_by uuid
    )
    ORDER BY entry.ordinal
    RETURNING id
  `) as { id: string }[];

  return inserted.map((row) => row.id);
}

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
 *
 * ## Cost: 2 queries, whatever the fan-out
 *
 * It was `R + (R x S)` — one subscription lookup per recipient, then one INSERT
 * per device — inside a single transaction. The only caller today passes ONE
 * recipient, so nothing in production ever paid it; the shape is what mattered,
 * because the function's entire contract is "every recipient" and the first
 * caller that broadcasts would have inherited it. A notification to 500 users
 * with two devices each cost 1,500 round trips on one connection.
 *
 * Now: one batched lookup, one batched INSERT. Zero recipients costs zero
 * queries and every-recipient-skipped costs one, so the cheap cases did not get
 * more expensive to make the expensive case cheap. Pinned by an exact query
 * budget in `tests/integration/push-enqueue-budget.integration.test.ts`.
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

  const skippedRecipients: string[] = [];

  if (recipientTenantUserIds.length === 0) {
    return { messageIds: [], skippedRecipients };
  }

  const subscriptionsByUser = await fetchActiveSubscriptionIdsForUsers(
    tx,
    tenantId,
    recipientTenantUserIds
  );

  const rows: {
    ordinal: number;
    tenant_id: string;
    correlation_id: string | null;
    category: string;
    subscription_id: string;
    priority: string;
    title: string;
    body: string;
    target_path: string | null;
    data: Record<string, string> | null;
    created_by: string | null;
  }[] = [];

  // Walks the caller's list AS GIVEN rather than the map, which keeps two
  // things the per-recipient loop did: recipients are fanned out in the order
  // they were passed, and a caller that passes the same id twice still gets two
  // notifications. The second is arguably a caller bug, but changing it here
  // would be a silent behaviour change riding along with a performance fix.
  for (const tenantUserId of recipientTenantUserIds) {
    const subscriptionIds = subscriptionsByUser.get(tenantUserId);

    if (!subscriptionIds || subscriptionIds.length === 0) {
      skippedRecipients.push(tenantUserId);
      continue;
    }

    for (const subscriptionId of subscriptionIds) {
      rows.push({
        ordinal: rows.length,
        tenant_id: tenantId,
        correlation_id: input.correlationId ?? null,
        category: input.category,
        subscription_id: subscriptionId,
        priority: input.priority ?? "normal",
        title: input.title,
        body: input.body,
        target_path: targetPath,
        data: input.data ?? null,
        created_by: input.createdBy ?? null
      });
    }
  }

  // Every recipient skipped is a normal outcome and must not cost a write.
  const messageIds = rows.length === 0 ? [] : await insertMessages(tx, rows);

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
