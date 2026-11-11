/**
 * The conversation projection (Issue #1164, ADR-0160 section 2): turns the
 * verified Telegram and website envelopes into conversation rows, idempotently
 * BY VALUE, so a redelivered event, a replay and a rebuild all converge on the
 * same row.
 *
 * - first/last inbound times are LEAST/GREATEST of what was seen;
 * - an inbound counts as UNANSWERED only if it was received after
 *   `answered_through` (the latest response or settle), so an old event can
 *   never reopen settled work, and starting an SLA clock happens once;
 * - a customer-state change applies only if its `event_sequence` is newer than
 *   the one that set the current state, and `withdrawn` is terminal (sql/384).
 *
 * A customer-state event may be delivered before the conversation exists (a
 * `/stop` racing the first message to a different consumer pass). It is not
 * dropped: when a conversation is CREATED, the aggregate's customer-state
 * events already in the log are applied to it, newest last. So the answer
 * never depends on delivery order, and a withdrawal is never lost.
 *
 * Staff work state (status, assignee, responses, tags) is never written here,
 * except that an unanswered inbound REOPENS a resolved/closed conversation.
 */
import { readEnvelope, type EnvelopeFact } from "../domain/envelope-reader";
import {
  CUSTOMER_STATE_EVENT_TYPES,
  DEFAULT_REBUILD_WINDOW_DAYS,
  PROJECTED_EVENT_TYPES,
  REBUILD_BATCH_LIMIT,
  SETTLING_STATUSES,
  TELEGRAM_CONTACT_AGGREGATE_TYPE,
  WEBSITE_SUBMISSION_AGGREGATE_TYPE,
  type ConversationStatus,
  type CustomerState,
  type SourceKind
} from "../domain/inbox-constants";
import { computeDueAt } from "../domain/sla-calendar";
import { resolveSlaPolicy, type ScopeRef } from "./sla-policy-directory";

export type ProjectableEvent = {
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
  /** When known (a rebuild reads it); otherwise looked up by id. */
  eventSequence?: bigint | number | string;
};

export type ProjectionOutcome =
  | "ignored"
  | "created"
  | "updated"
  | "state_applied"
  | "state_unchanged"
  | "no_conversation";

function aggregateTypeOf(kind: SourceKind): string {
  return kind === "telegram"
    ? TELEGRAM_CONTACT_AGGREGATE_TYPE
    : WEBSITE_SUBMISSION_AGGREGATE_TYPE;
}

async function sequenceOf(
  tx: Bun.SQL,
  tenantId: string,
  event: ProjectableEvent
): Promise<string> {
  if (event.eventSequence !== undefined) return String(event.eventSequence);

  const rows = (await tx`
    SELECT event_sequence::text AS seq FROM awcms_domain_events
    WHERE tenant_id = ${tenantId} AND id = ${event.id}
  `) as { seq: string }[];

  // An event the log does not hold cannot order anything: treat it as the
  // oldest possible, so it can never override a recorded state.
  return rows[0]?.seq ?? "0";
}

async function accountScope(
  tx: Bun.SQL,
  tenantId: string,
  accountId: string | null
): Promise<ScopeRef | null> {
  if (!accountId) return null;

  const rows = (await tx`
    SELECT business_scope_type, business_scope_id
    FROM awcms_channel_accounts
    WHERE tenant_id = ${tenantId} AND id = ${accountId}
  `) as {
    business_scope_type: string | null;
    business_scope_id: string | null;
  }[];
  const row = rows[0];

  return row?.business_scope_type && row.business_scope_id
    ? { type: row.business_scope_type, id: row.business_scope_id }
    : null;
}

type ConversationLockRow = {
  id: string;
  status: ConversationStatus;
  customer_state: CustomerState;
  awaiting_since: Date | null;
  answered_through: Date | null;
  first_responded_at: Date | null;
  sla_breached_at: Date | null;
  business_scope_type: string | null;
  business_scope_id: string | null;
};

/**
 * Applies one customer-state fact by sequence. A state other than `active`
 * owes nothing: the wait and its due time are cleared, and a withdrawal closes
 * the conversation (it can no longer be answered at all).
 */
async function applyCustomerState(
  tx: Bun.SQL,
  tenantId: string,
  sourceKind: SourceKind,
  sourceRef: string,
  state: CustomerState,
  sequence: string
): Promise<boolean> {
  const owesNothing = state !== "active";
  const closes = state === "withdrawn";
  const rows = (await tx`
    UPDATE awcms_inbox_conversations
    SET customer_state = ${state},
        customer_state_sequence = ${sequence}::bigint,
        awaiting_since = CASE WHEN ${owesNothing}::boolean THEN NULL ELSE awaiting_since END,
        response_due_kind = CASE WHEN ${owesNothing}::boolean THEN NULL ELSE response_due_kind END,
        response_due_at = CASE WHEN ${owesNothing}::boolean THEN NULL ELSE response_due_at END,
        status = CASE WHEN ${closes}::boolean THEN 'closed' ELSE status END,
        answered_through = CASE WHEN ${closes}::boolean
          THEN GREATEST(COALESCE(answered_through, last_inbound_at), last_inbound_at)
          ELSE answered_through END,
        version = version + 1,
        updated_at = now()
    WHERE tenant_id = ${tenantId}
      AND source_kind = ${sourceKind}
      AND source_ref = ${sourceRef}
      AND customer_state_sequence < ${sequence}::bigint
      AND customer_state <> 'withdrawn'
    RETURNING id
  `) as { id: string }[];

  return rows.length > 0;
}

/** Every customer-state event of this aggregate already in the log, oldest first. Bounded: a contact's consent history is a handful of rows. */
async function applyRecordedCustomerStates(
  tx: Bun.SQL,
  tenantId: string,
  sourceKind: SourceKind,
  sourceRef: string
): Promise<void> {
  const events = (await tx`
    SELECT event_type, payload, event_sequence::text AS seq
    FROM awcms_domain_events
    WHERE tenant_id = ${tenantId}
      AND aggregate_type = ${aggregateTypeOf(sourceKind)}
      AND aggregate_id = ${sourceRef}
      AND event_type = ANY(${tx.array([...CUSTOMER_STATE_EVENT_TYPES], "text")})
    ORDER BY event_sequence
    LIMIT 200
  `) as {
    event_type: string;
    payload: Record<string, unknown>;
    seq: string;
  }[];

  for (const event of events) {
    const fact = readEnvelope(event.event_type, event.payload);

    if (fact?.kind === "customer_state" && fact.sourceRef === sourceRef) {
      await applyCustomerState(
        tx,
        tenantId,
        sourceKind,
        sourceRef,
        fact.state,
        event.seq
      );
    }
  }
}

/** Starts (or moves earlier) the SLA wait for an unanswered inbound. */
async function startWait(
  tx: Bun.SQL,
  tenantId: string,
  row: ConversationLockRow,
  receivedAt: Date
): Promise<void> {
  if (row.customer_state !== "active") return;

  if (row.answered_through && receivedAt <= row.answered_through) return;

  if (row.awaiting_since && row.awaiting_since <= receivedAt) return;

  const scope: ScopeRef | null =
    row.business_scope_type && row.business_scope_id
      ? { type: row.business_scope_type, id: row.business_scope_id }
      : null;
  const policy = await resolveSlaPolicy(tx, tenantId, scope);
  const dueKind = row.first_responded_at ? "next" : "first";
  const dueMs = policy
    ? computeDueAt(
        receivedAt.getTime(),
        dueKind === "first"
          ? policy.firstResponseMinutes
          : policy.nextResponseMinutes,
        policy.calendar
      )
    : null;
  const due = dueMs === null ? null : new Date(dueMs);
  const reopen = SETTLING_STATUSES.includes(row.status);

  await tx`
    UPDATE awcms_inbox_conversations
    SET awaiting_since = ${receivedAt},
        sla_policy_id = ${due ? policy!.id : null},
        response_due_kind = ${due ? dueKind : null},
        response_due_at = ${due},
        sla_breached_at = CASE WHEN ${row.awaiting_since === null}::boolean
          THEN NULL ELSE sla_breached_at END,
        status = CASE WHEN ${reopen}::boolean THEN 'open' ELSE status END,
        version = version + 1,
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${row.id}
  `;

  if (reopen) {
    await tx`
      INSERT INTO awcms_inbox_activity
        (tenant_id, conversation_id, kind, detail_code)
      VALUES (${tenantId}, ${row.id}, 'status_changed', 'open')
    `;
  }
}

async function projectInbound(
  tx: Bun.SQL,
  tenantId: string,
  fact: Extract<EnvelopeFact, { kind: "inbound" }>
): Promise<ProjectionOutcome> {
  const scope = await accountScope(tx, tenantId, fact.channelAccountId);
  const upserted = (await tx`
    INSERT INTO awcms_inbox_conversations
      (tenant_id, source_kind, source_ref, channel_account_id,
       business_scope_type, business_scope_id, first_inbound_at, last_inbound_at)
    VALUES (${tenantId}, ${fact.sourceKind}, ${fact.sourceRef},
            ${fact.channelAccountId}, ${scope?.type ?? null}, ${scope?.id ?? null},
            ${fact.receivedAt}, ${fact.receivedAt})
    ON CONFLICT (tenant_id, source_kind, source_ref) DO UPDATE
    SET first_inbound_at = LEAST(awcms_inbox_conversations.first_inbound_at, EXCLUDED.first_inbound_at),
        last_inbound_at = GREATEST(awcms_inbox_conversations.last_inbound_at, EXCLUDED.last_inbound_at),
        business_scope_type = EXCLUDED.business_scope_type,
        business_scope_id = EXCLUDED.business_scope_id,
        updated_at = CASE
          WHEN awcms_inbox_conversations.last_inbound_at < EXCLUDED.last_inbound_at
            OR awcms_inbox_conversations.first_inbound_at > EXCLUDED.first_inbound_at
            OR awcms_inbox_conversations.business_scope_id IS DISTINCT FROM EXCLUDED.business_scope_id
          THEN now() ELSE awcms_inbox_conversations.updated_at END
    RETURNING id, (xmax = 0) AS inserted
  `) as { id: string; inserted: boolean }[];
  const created = upserted[0]!.inserted;

  if (created) {
    await applyRecordedCustomerStates(
      tx,
      tenantId,
      fact.sourceKind,
      fact.sourceRef
    );
  }

  const rows = (await tx`
    SELECT id, status, customer_state, awaiting_since, answered_through,
           first_responded_at, sla_breached_at, business_scope_type,
           business_scope_id
    FROM awcms_inbox_conversations
    WHERE tenant_id = ${tenantId} AND id = ${upserted[0]!.id}
    FOR UPDATE
  `) as ConversationLockRow[];

  await startWait(tx, tenantId, rows[0]!, fact.receivedAt);

  return created ? "created" : "updated";
}

/**
 * Projects one event. Returns what happened; never throws for an event the
 * inbox does not track or a malformed payload (it is `ignored`).
 */
export async function projectEvent(
  tx: Bun.SQL,
  tenantId: string,
  event: ProjectableEvent
): Promise<ProjectionOutcome> {
  const fact = readEnvelope(event.eventType, event.payload);

  if (!fact) return "ignored";

  if (fact.kind === "inbound") return projectInbound(tx, tenantId, fact);

  const exists = (await tx`
    SELECT 1 FROM awcms_inbox_conversations
    WHERE tenant_id = ${tenantId} AND source_kind = ${fact.sourceKind}
      AND source_ref = ${fact.sourceRef}
  `) as unknown[];

  // No conversation yet: the creation path will read this event from the log.
  if (exists.length === 0) return "no_conversation";

  const applied = await applyCustomerState(
    tx,
    tenantId,
    fact.sourceKind,
    fact.sourceRef,
    fact.state,
    await sequenceOf(tx, tenantId, event)
  );

  return applied ? "state_applied" : "state_unchanged";
}

export type RebuildResult = {
  processed: number;
  created: number;
  nextAfterSequence: string;
  complete: boolean;
};

/**
 * Replays the projected event types from the log into the projection, in
 * `event_sequence` order, one bounded batch per call (ADR-0160 section 2).
 * Only events recorded inside the window are read, so a rebuild never
 * resurrects a conversation the retention purge already removed. Staff work
 * state is never reset; the projection is idempotent by value, so replaying an
 * event the consumer already applied changes nothing.
 */
export async function rebuildProjection(
  tx: Bun.SQL,
  tenantId: string,
  options: {
    afterSequence?: string;
    windowDays?: number;
    limit?: number;
    now?: Date;
  } = {}
): Promise<RebuildResult> {
  const after = options.afterSequence ?? "0";
  const limit = Math.min(
    options.limit ?? REBUILD_BATCH_LIMIT,
    REBUILD_BATCH_LIMIT
  );
  const now = options.now ?? new Date();
  const since = new Date(
    now.getTime() -
      (options.windowDays ?? DEFAULT_REBUILD_WINDOW_DAYS) * 86_400_000
  );
  const events = (await tx`
    SELECT id, event_type, payload, event_sequence::text AS seq
    FROM awcms_domain_events
    WHERE tenant_id = ${tenantId}
      AND event_type = ANY(${tx.array([...PROJECTED_EVENT_TYPES], "text")})
      AND event_version = '1.0'
      AND event_sequence > ${after}::bigint
      AND recorded_at >= ${since}
    ORDER BY event_sequence
    LIMIT ${limit}
  `) as {
    id: string;
    event_type: string;
    payload: Record<string, unknown>;
    seq: string;
  }[];
  let created = 0;

  for (const event of events) {
    const outcome = await projectEvent(tx, tenantId, {
      id: event.id,
      eventType: event.event_type,
      payload: event.payload,
      eventSequence: event.seq
    });

    if (outcome === "created") created += 1;
  }

  return {
    processed: events.length,
    created,
    nextAfterSequence:
      events.length > 0 ? events[events.length - 1]!.seq : after,
    complete: events.length < limit
  };
}
