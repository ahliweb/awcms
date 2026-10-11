/**
 * Read-only projections of the WhatsApp queue for the operator surface
 * (Issue #963). Everything takes an already-open transaction so the admin
 * screen reads one snapshot. Nothing here writes.
 *
 * ## The raw number and the body are not reachable from here
 *
 * No projection selects `recipient`, `body` or `variables`. The queue row's
 * rendered body can hold an OTP until it reaches a terminal state, and the
 * recipient is personal data; an operator diagnosing a failure needs state,
 * template, masked recipient and the error code, which is what is returned.
 */

/** Every value `awcms_whatsapp_messages_status_check` allows, in lifecycle order. */
export const WHATSAPP_MESSAGE_STATUSES = [
  "queued",
  "retry_wait",
  "sending",
  "sent",
  "failed",
  "cancelled",
  "expired"
] as const;

export type WhatsappMessageStatusValue =
  (typeof WHATSAPP_MESSAGE_STATUSES)[number];

export type WhatsappQueueSummary = {
  countsByStatus: Record<WhatsappMessageStatusValue, number>;
  oldestPendingAt: string | null;
  suppressions: number;
  grantedConsents: number;
};

export type WhatsappMessageView = {
  id: string;
  templateKey: string;
  purpose: "transactional" | "security" | "marketing";
  status: WhatsappMessageStatusValue;
  recipientMasked: string;
  correlationId: string | null;
  retryCount: number;
  failureCode: string | null;
  lastError: string | null;
  providerName: string | null;
  notBefore: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
};

export type WhatsappAttemptView = {
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

export function isWhatsappMessageStatus(
  value: string
): value is WhatsappMessageStatusValue {
  return (WHATSAPP_MESSAGE_STATUSES as readonly string[]).includes(value);
}

export async function summarizeWhatsappQueue(
  tx: Bun.SQL,
  tenantId: string
): Promise<WhatsappQueueSummary> {
  const counts = (await tx`
    SELECT status, count(*) AS count
    FROM awcms_whatsapp_messages WHERE tenant_id = ${tenantId}
    GROUP BY status
  `) as { status: string; count: string | number }[];

  const countsByStatus = Object.fromEntries(
    WHATSAPP_MESSAGE_STATUSES.map((status) => [status, 0])
  ) as Record<WhatsappMessageStatusValue, number>;

  for (const row of counts) {
    if (isWhatsappMessageStatus(row.status)) {
      countsByStatus[row.status] = Number(row.count);
    }
  }

  const other = (await tx`
    SELECT
      (SELECT min(created_at) FROM awcms_whatsapp_messages
        WHERE tenant_id = ${tenantId}
          AND status IN ('queued', 'retry_wait')) AS oldest_pending_at,
      (SELECT count(*) FROM awcms_whatsapp_suppressions
        WHERE tenant_id = ${tenantId}) AS suppressions,
      (SELECT count(*) FROM awcms_whatsapp_consents
        WHERE tenant_id = ${tenantId} AND status = 'granted') AS granted_consents
  `) as {
    oldest_pending_at: Date | string | null;
    suppressions: string | number;
    granted_consents: string | number;
  }[];

  return {
    countsByStatus,
    oldestPendingAt: isoOrNull(other[0]?.oldest_pending_at ?? null),
    suppressions: Number(other[0]?.suppressions ?? 0),
    grantedConsents: Number(other[0]?.granted_consents ?? 0)
  };
}

type MessageRow = {
  id: string;
  template_key: string;
  purpose: WhatsappMessageView["purpose"];
  status: WhatsappMessageStatusValue;
  recipient_masked: string;
  correlation_id: string | null;
  retry_count: number | string;
  failure_code: string | null;
  last_error: string | null;
  provider_name: string | null;
  not_before: Date | string | null;
  expires_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  sent_at: Date | string | null;
};

export async function listRecentWhatsappMessages(
  tx: Bun.SQL,
  tenantId: string,
  options: { status?: WhatsappMessageStatusValue; limit: number }
): Promise<{ messages: WhatsappMessageView[]; hasMore: boolean }> {
  const status = options.status ?? null;
  const rows = (await tx`
    SELECT id, template_key, purpose, status, recipient_masked, correlation_id,
           retry_count, failure_code, last_error, provider_name, not_before,
           expires_at, created_at, updated_at, sent_at
    FROM awcms_whatsapp_messages
    WHERE tenant_id = ${tenantId}
      AND (${status}::text IS NULL OR status = ${status})
    ORDER BY created_at DESC, id
    LIMIT ${options.limit + 1}
  `) as MessageRow[];

  return {
    messages: rows.slice(0, options.limit).map((row) => ({
      id: row.id,
      templateKey: row.template_key,
      purpose: row.purpose,
      status: row.status,
      recipientMasked: row.recipient_masked,
      correlationId: row.correlation_id,
      retryCount: Number(row.retry_count),
      failureCode: row.failure_code,
      lastError: row.last_error,
      providerName: row.provider_name,
      notBefore: isoOrNull(row.not_before),
      expiresAt: isoOrNull(row.expires_at),
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

export async function listRecentWhatsappAttempts(
  tx: Bun.SQL,
  tenantId: string,
  options: { limit: number }
): Promise<WhatsappAttemptView[]> {
  const rows = (await tx`
    SELECT id, message_id, attempt_no, outcome, provider_name,
           provider_response_snippet, error_message, created_at
    FROM awcms_whatsapp_delivery_attempts
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
