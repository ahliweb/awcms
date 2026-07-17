/**
 * Admin/diagnostics read + cancel over `awcms_email_messages` (Issue
 * #499, epic #492) — the `email.message.{read,cancel}` permissions were
 * seeded back in migration 020/024 for exactly this endpoint, which lands
 * here rather than earlier because "queue health/failed messages/retry
 * backlog visible to authorized operators" is #499's own scope. Mirrors
 * `sync-storage/application/sync-directory.ts`'s `fetchObjectQueueEntries`
 * keyset-pagination shape. Never selects `to_address` — only
 * `to_address_masked` (doc 04 §Alur perlindungan data sensitif).
 */
import {
  encodeKeysetCursor,
  type KeysetCursor
} from "../../_shared/keyset-pagination";

export const EMAIL_MESSAGE_LIST_LIMIT = 100;

export type EmailMessageStatus =
  | "queued"
  | "sending"
  | "sent"
  | "failed"
  | "retry_wait"
  | "cancelled"
  | "suppressed";

export type EmailMessageEntry = {
  id: string;
  correlationId: string | null;
  category: string;
  status: EmailMessageStatus;
  priority: string;
  toAddressMasked: string;
  subject: string;
  retryCount: number;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
};

type EmailMessageRow = {
  id: string;
  correlation_id: string | null;
  category: string;
  status: EmailMessageStatus;
  priority: string;
  to_address_masked: string;
  subject: string;
  retry_count: number;
  last_error: string | null;
  created_at: Date;
  // Full-precision cursor text (Issue #158) — kept out of the response DTO;
  // see `_shared/keyset-pagination` for why a JS `Date` cannot carry it.
  created_at_cursor: string;
  sent_at: Date | null;
};

export type EmailMessageListPage = {
  messages: EmailMessageEntry[];
  nextCursor: string | null;
};

function toView(row: EmailMessageRow): EmailMessageEntry {
  return {
    id: row.id,
    correlationId: row.correlation_id,
    category: row.category,
    status: row.status,
    priority: row.priority,
    toAddressMasked: row.to_address_masked,
    subject: row.subject,
    retryCount: Number(row.retry_count),
    lastError: row.last_error,
    createdAt: row.created_at.toISOString(),
    sentAt: row.sent_at?.toISOString() ?? null
  };
}

/**
 * One keyset-paginated page of email messages, newest first.
 *
 * The cursor is generated HERE (not in the route) so the full microsecond
 * precision of `created_at` survives — a route that rebuilt the cursor from
 * the response DTO's `createdAt` (a JS `Date`/ISO-ms string) would floor the
 * microseconds and silently skip every message sharing that millisecond
 * across the page boundary (Issue #158). `created_at_cursor` carries the
 * full-precision text and never leaves this function.
 */
export async function fetchEmailMessageEntries(
  tx: Bun.SQL,
  tenantId: string,
  statusFilter?: EmailMessageStatus,
  cursor?: KeysetCursor
): Promise<EmailMessageListPage> {
  const cursorCreatedAt = cursor?.createdAt ?? null;
  const cursorId = cursor?.id ?? null;

  const rows = (
    statusFilter
      ? await tx`
        SELECT id, correlation_id, category, status, priority, to_address_masked,
               subject, retry_count, last_error, created_at,
               to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"') AS created_at_cursor,
               sent_at
        FROM awcms_email_messages
        WHERE tenant_id = ${tenantId} AND status = ${statusFilter}
          AND (
            ${cursorCreatedAt}::timestamptz IS NULL
            OR (created_at, id) < (${cursorCreatedAt}, ${cursorId})
          )
        ORDER BY created_at DESC, id DESC
        LIMIT ${EMAIL_MESSAGE_LIST_LIMIT}
      `
      : await tx`
        SELECT id, correlation_id, category, status, priority, to_address_masked,
               subject, retry_count, last_error, created_at,
               to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"') AS created_at_cursor,
               sent_at
        FROM awcms_email_messages
        WHERE tenant_id = ${tenantId}
          AND (
            ${cursorCreatedAt}::timestamptz IS NULL
            OR (created_at, id) < (${cursorCreatedAt}, ${cursorId})
          )
        ORDER BY created_at DESC, id DESC
        LIMIT ${EMAIL_MESSAGE_LIST_LIMIT}
      `
  ) as EmailMessageRow[];

  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === EMAIL_MESSAGE_LIST_LIMIT && last
      ? encodeKeysetCursor(last.created_at_cursor, last.id)
      : null;

  return { messages: rows.map(toView), nextCursor };
}

export type CancelEmailMessageResult =
  | { outcome: "cancelled"; entry: EmailMessageEntry }
  | { outcome: "not_found" }
  | { outcome: "not_cancellable"; currentStatus: EmailMessageStatus };

/** Only a still-queued message (`queued`/`retry_wait`) can be cancelled — a message already `sending`/`sent`/`failed`/`cancelled`/`suppressed` is a no-op, reported distinctly so the caller can show a clear reason (doc 10 §incident response "accidental bulk send"). */
export async function cancelEmailMessage(
  tx: Bun.SQL,
  tenantId: string,
  id: string
): Promise<CancelEmailMessageResult> {
  const existingRows = (await tx`
    SELECT status FROM awcms_email_messages
    WHERE tenant_id = ${tenantId} AND id = ${id}
  `) as { status: EmailMessageStatus }[];

  const existing = existingRows[0];

  if (!existing) {
    return { outcome: "not_found" };
  }

  if (existing.status !== "queued" && existing.status !== "retry_wait") {
    return { outcome: "not_cancellable", currentStatus: existing.status };
  }

  const rows = (await tx`
    UPDATE awcms_email_messages
    SET status = 'cancelled', next_attempt_at = null
    WHERE tenant_id = ${tenantId} AND id = ${id}
      AND status IN ('queued', 'retry_wait')
    RETURNING id, correlation_id, category, status, priority, to_address_masked,
              subject, retry_count, last_error, created_at, sent_at
  `) as EmailMessageRow[];

  if (rows.length === 0) {
    // Lost the race to the dispatcher claiming it between the SELECT above
    // and this UPDATE (FOR UPDATE SKIP LOCKED in the dispatcher can flip it
    // to 'sending' in between) — report the same "not cancellable" shape.
    return { outcome: "not_cancellable", currentStatus: "sending" };
  }

  return { outcome: "cancelled", entry: toView(rows[0]!) };
}
