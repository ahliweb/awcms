/**
 * Read-only projections of the push outbox for the operator surface
 * (Issue #466).
 *
 * Everything here takes an already-open transaction, like the rest of this
 * module, so the admin screen decides and reads against ONE snapshot
 * (`loadAdminScreen`). Nothing here writes.
 *
 * ## Why the queue summary is a GROUP BY and not six counts
 *
 * A status that has no rows must come back as `0`, not be missing — a console
 * that renders only the statuses present makes an empty `failed` bucket and a
 * `failed` bucket nobody asked about look identical. So the six statuses are
 * enumerated in code and the query fills them in.
 *
 * ## The raw endpoint is not reachable from here
 *
 * Every projection joins to `awcms_push_subscriptions` for `endpoint_masked`
 * and never for `endpoint`. That rule is kept by
 * `application/subscription-directory.ts` being the only file that names the
 * raw column; this file exists on the other side of that boundary and must stay
 * there, because its output is rendered into a page.
 */

/** Every value `awcms_push_messages_status_check` allows, in lifecycle order. */
export const PUSH_MESSAGE_STATUSES = [
  "queued",
  "retry_wait",
  "sending",
  "sent",
  "failed",
  "cancelled"
] as const;

export type PushMessageStatus = (typeof PUSH_MESSAGE_STATUSES)[number];

export type PushQueueSummary = {
  countsByStatus: Record<PushMessageStatus, number>;
  /** Oldest row still waiting to be sent — `null` when the queue is drained. */
  oldestPendingAt: Date | null;
  /** When the next `retry_wait` row becomes due; `null` when none is waiting. */
  nextAttemptAt: Date | null;
  activeSubscriptions: number;
  disabledSubscriptions: number;
};

export type PushMessageView = {
  id: string;
  category: string;
  status: PushMessageStatus;
  priority: "low" | "normal" | "high";
  title: string;
  targetPath: string | null;
  retryCount: number;
  lastError: string | null;
  providerName: string | null;
  createdAt: Date;
  updatedAt: Date;
  sentAt: Date | null;
  nextAttemptAt: Date | null;
  tenantUserId: string;
  endpointMasked: string;
  transport: "web_push" | "fcm";
};

export type PushAttemptView = {
  id: string;
  messageId: string;
  attemptNo: number;
  outcome: "success" | "failure";
  providerName: string;
  providerResponseSnippet: string | null;
  errorMessage: string | null;
  createdAt: Date;
};

function isKnownStatus(value: string): value is PushMessageStatus {
  return (PUSH_MESSAGE_STATUSES as readonly string[]).includes(value);
}

export async function summarizePushQueue(
  tx: Bun.TransactionSQL,
  tenantId: string
): Promise<PushQueueSummary> {
  const statusRows = (await tx`
    SELECT status, count(*)::int AS total
    FROM awcms_push_messages
    WHERE tenant_id = ${tenantId}
    GROUP BY status
  `) as { status: PushMessageStatus; total: number }[];

  const countsByStatus = Object.fromEntries(
    PUSH_MESSAGE_STATUSES.map((status) => [status, 0])
  ) as Record<PushMessageStatus, number>;

  for (const row of statusRows) {
    // A status the CHECK constraint does not allow cannot be here, but the map
    // is written defensively rather than indexed blindly: a future status added
    // in SQL and not here would otherwise create a key nothing enumerates and
    // silently vanish from the console.
    if (isKnownStatus(row.status)) countsByStatus[row.status] = row.total;
  }

  const pendingRows = (await tx`
    SELECT min(created_at) AS oldest_pending_at,
           min(next_attempt_at) FILTER (WHERE status = 'retry_wait')
             AS next_attempt_at
    FROM awcms_push_messages
    WHERE tenant_id = ${tenantId}
      AND status IN ('queued', 'retry_wait', 'sending')
  `) as { oldest_pending_at: Date | null; next_attempt_at: Date | null }[];

  const subscriptionRows = (await tx`
    SELECT status, count(*)::int AS total
    FROM awcms_push_subscriptions
    WHERE tenant_id = ${tenantId}
    GROUP BY status
  `) as { status: "active" | "disabled"; total: number }[];

  return {
    countsByStatus,
    oldestPendingAt: pendingRows[0]?.oldest_pending_at ?? null,
    nextAttemptAt: pendingRows[0]?.next_attempt_at ?? null,
    activeSubscriptions:
      subscriptionRows.find((row) => row.status === "active")?.total ?? 0,
    disabledSubscriptions:
      subscriptionRows.find((row) => row.status === "disabled")?.total ?? 0
  };
}

type MessageRow = {
  id: string;
  category: string;
  status: PushMessageStatus;
  priority: "low" | "normal" | "high";
  title: string;
  target_path: string | null;
  retry_count: number;
  last_error: string | null;
  provider_name: string | null;
  created_at: Date;
  updated_at: Date;
  sent_at: Date | null;
  next_attempt_at: Date | null;
  tenant_user_id: string;
  endpoint_masked: string;
  transport: "web_push" | "fcm";
};

/**
 * The most recent messages, newest first, optionally narrowed to one status.
 *
 * Bounded and cursorless on purpose: this is a console for "what is happening
 * now", and the historical tail is deleted by retention rather than browsed.
 * `body` is NOT projected — an operator diagnosing delivery needs the category,
 * the status and the error, and the notification text is the one field here
 * that can carry the user's own content.
 */
export async function listRecentPushMessages(
  tx: Bun.TransactionSQL,
  tenantId: string,
  options: { status?: PushMessageStatus; limit?: number } = {}
): Promise<PushMessageView[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const rows = options.status
    ? ((await tx`
        SELECT m.id, m.category, m.status, m.priority, m.title, m.target_path,
               m.retry_count, m.last_error, m.provider_name, m.created_at,
               m.updated_at, m.sent_at, m.next_attempt_at,
               s.tenant_user_id, s.endpoint_masked, s.transport
        FROM awcms_push_messages m
        JOIN awcms_push_subscriptions s
          ON s.tenant_id = m.tenant_id AND s.id = m.subscription_id
        WHERE m.tenant_id = ${tenantId} AND m.status = ${options.status}
        ORDER BY m.created_at DESC
        LIMIT ${limit}
      `) as MessageRow[])
    : ((await tx`
        SELECT m.id, m.category, m.status, m.priority, m.title, m.target_path,
               m.retry_count, m.last_error, m.provider_name, m.created_at,
               m.updated_at, m.sent_at, m.next_attempt_at,
               s.tenant_user_id, s.endpoint_masked, s.transport
        FROM awcms_push_messages m
        JOIN awcms_push_subscriptions s
          ON s.tenant_id = m.tenant_id AND s.id = m.subscription_id
        WHERE m.tenant_id = ${tenantId}
        ORDER BY m.created_at DESC
        LIMIT ${limit}
      `) as MessageRow[]);

  return rows.map((row) => ({
    id: row.id,
    category: row.category,
    status: row.status,
    priority: row.priority,
    title: row.title,
    targetPath: row.target_path,
    retryCount: row.retry_count,
    lastError: row.last_error,
    providerName: row.provider_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sentAt: row.sent_at,
    nextAttemptAt: row.next_attempt_at,
    tenantUserId: row.tenant_user_id,
    endpointMasked: row.endpoint_masked,
    transport: row.transport
  }));
}

type AttemptRow = {
  id: string;
  message_id: string;
  attempt_no: number;
  outcome: "success" | "failure";
  provider_name: string;
  provider_response_snippet: string | null;
  error_message: string | null;
  created_at: Date;
};

/**
 * The last N delivery attempts across the whole tenant.
 *
 * Deliberately not filtered to failures: a provider that started answering
 * slowly, or one that switched which of two endpoints it accepts, shows up as a
 * pattern across successes and failures together. A failures-only view answers
 * "what broke" and never "since when".
 */
export async function listRecentPushAttempts(
  tx: Bun.TransactionSQL,
  tenantId: string,
  options: { limit?: number } = {}
): Promise<PushAttemptView[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const rows = (await tx`
    SELECT id, message_id, attempt_no, outcome, provider_name,
           provider_response_snippet, error_message, created_at
    FROM awcms_push_delivery_attempts
    WHERE tenant_id = ${tenantId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `) as AttemptRow[];

  return rows.map((row) => ({
    id: row.id,
    messageId: row.message_id,
    attemptNo: row.attempt_no,
    outcome: row.outcome,
    providerName: row.provider_name,
    providerResponseSnippet: row.provider_response_snippet,
    errorMessage: row.error_message,
    createdAt: row.created_at
  }));
}
