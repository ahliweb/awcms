/**
 * Read-only projections of the Telegram queue for the operator surface (Issue
 * #965). Everything takes an already-open transaction so the admin screen reads
 * one snapshot. Nothing here writes.
 *
 * ## The chat, the body and the variables are not reachable from here
 *
 * No projection selects `body`, `variables`, `chat_ciphertext` or `chat_hash`. An
 * operator diagnosing a failure needs state, template, error code and counts,
 * which is what is returned. A message names its recipient by the staff
 * member's tenant user id, never by anything Telegram knows about them.
 */
import {
  TELEGRAM_MESSAGE_STATUSES,
  type TelegramMessageStatus
} from "../domain/telegram-constants";

export { TELEGRAM_MESSAGE_STATUSES };

export type TelegramQueueSummary = {
  countsByStatus: Record<TelegramMessageStatus, number>;
  oldestPendingAt: string | null;
  activeBindings: number;
  pendingBindings: number;
};

export type TelegramMessageView = {
  id: string;
  templateKey: string;
  status: TelegramMessageStatus;
  principalId: string;
  correlationId: string | null;
  retryCount: number;
  failureCode: string | null;
  lastError: string | null;
  expiresAt: string;
  nextAttemptAt: string | null;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
};

export type TelegramAttemptView = {
  id: string;
  messageId: string;
  attemptNo: number;
  outcome: "success" | "failure";
  providerName: string;
  providerResponseSnippet: string | null;
  errorMessage: string | null;
  createdAt: string;
};

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();
const isoOrNull = (value: Date | string | null): string | null =>
  value === null ? null : iso(value);

export function isTelegramMessageStatus(
  value: string
): value is TelegramMessageStatus {
  return (TELEGRAM_MESSAGE_STATUSES as readonly string[]).includes(value);
}

export async function summarizeTelegramQueue(
  tx: Bun.SQL,
  tenantId: string
): Promise<TelegramQueueSummary> {
  const counts = (await tx`
    SELECT status, count(*) AS count
    FROM awcms_telegram_messages WHERE tenant_id = ${tenantId}
    GROUP BY status
  `) as { status: string; count: string | number }[];

  const countsByStatus = Object.fromEntries(
    TELEGRAM_MESSAGE_STATUSES.map((status) => [status, 0])
  ) as Record<TelegramMessageStatus, number>;

  for (const row of counts) {
    if (isTelegramMessageStatus(row.status)) {
      countsByStatus[row.status] = Number(row.count);
    }
  }

  const other = (await tx`
    SELECT
      (SELECT min(created_at) FROM awcms_telegram_messages
        WHERE tenant_id = ${tenantId}
          AND status IN ('queued', 'retry_wait')) AS oldest_pending_at,
      (SELECT count(*) FROM awcms_telegram_bindings
        WHERE tenant_id = ${tenantId} AND status = 'active') AS active_bindings,
      (SELECT count(*) FROM awcms_telegram_bindings
        WHERE tenant_id = ${tenantId}
          AND status = 'pending_confirmation') AS pending_bindings
  `) as {
    oldest_pending_at: Date | string | null;
    active_bindings: string | number;
    pending_bindings: string | number;
  }[];

  return {
    countsByStatus,
    oldestPendingAt: isoOrNull(other[0]?.oldest_pending_at ?? null),
    activeBindings: Number(other[0]?.active_bindings ?? 0),
    pendingBindings: Number(other[0]?.pending_bindings ?? 0)
  };
}

type MessageRow = {
  id: string;
  template_key: string;
  status: TelegramMessageStatus;
  principal_id: string;
  correlation_id: string | null;
  retry_count: number | string;
  failure_code: string | null;
  last_error: string | null;
  expires_at: Date | string;
  next_attempt_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  sent_at: Date | string | null;
};

export async function listRecentTelegramMessages(
  tx: Bun.SQL,
  tenantId: string,
  options: { status?: TelegramMessageStatus; limit: number }
): Promise<{ messages: TelegramMessageView[]; hasMore: boolean }> {
  const status = options.status ?? null;
  const rows = (await tx`
    SELECT id, template_key, status, principal_id, correlation_id, retry_count,
           failure_code, last_error, expires_at, next_attempt_at, created_at,
           updated_at, sent_at
    FROM awcms_telegram_messages
    WHERE tenant_id = ${tenantId}
      AND (${status}::text IS NULL OR status = ${status})
    ORDER BY created_at DESC, id
    LIMIT ${options.limit + 1}
  `) as MessageRow[];

  return {
    messages: rows.slice(0, options.limit).map((row) => ({
      id: row.id,
      templateKey: row.template_key,
      status: row.status,
      principalId: row.principal_id,
      correlationId: row.correlation_id,
      retryCount: Number(row.retry_count),
      failureCode: row.failure_code,
      lastError: row.last_error,
      expiresAt: iso(row.expires_at),
      nextAttemptAt: isoOrNull(row.next_attempt_at),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      sentAt: isoOrNull(row.sent_at)
    })),
    hasMore: rows.length > options.limit
  };
}

type AttemptRow = {
  id: string;
  message_id: string;
  attempt_no: number | string;
  outcome: "success" | "failure";
  provider_name: string;
  provider_response_snippet: string | null;
  error_message: string | null;
  created_at: Date | string;
};

export async function listRecentTelegramAttempts(
  tx: Bun.SQL,
  tenantId: string,
  options: { limit: number }
): Promise<TelegramAttemptView[]> {
  const rows = (await tx`
    SELECT id, message_id, attempt_no, outcome, provider_name,
           provider_response_snippet, error_message, created_at
    FROM awcms_telegram_delivery_attempts
    WHERE tenant_id = ${tenantId}
    ORDER BY created_at DESC, id
    LIMIT ${options.limit}
  `) as AttemptRow[];

  return rows.map((row) => ({
    id: row.id,
    messageId: row.message_id,
    attemptNo: Number(row.attempt_no),
    outcome: row.outcome,
    providerName: row.provider_name,
    providerResponseSnippet: row.provider_response_snippet,
    errorMessage: row.error_message,
    createdAt: iso(row.created_at)
  }));
}
