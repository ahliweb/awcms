/**
 * Reads and staff writes over inbox conversations (Issue #1164, ADR-0160).
 *
 * Every read is filtered by the caller's VISIBILITY (`ConversationVisibility`):
 * unconfined callers see every conversation of the tenant; a scope-confined
 * caller sees only conversations whose business scope they cover, and never a
 * tenant-wide one. Callers decide visibility through `channel_accounts`' rules
 * (see `route-support.ts`); this file only applies it.
 *
 * Every write takes the conversation row lock and checks `expectedVersion`, so
 * two agents acting on the same conversation at once get exactly one success
 * and one `version_conflict` (never a silently lost update).
 */
import {
  MAX_ACTIVITY_ON_DETAIL,
  SETTLING_STATUSES,
  type ActivityKind,
  type ConversationStatus,
  type CustomerState,
  type DueKind,
  type SlaState,
  type SourceKind
} from "../domain/inbox-constants";
import type { ListConversationsQuery } from "../domain/inbox-validation";
import { isCheckViolation } from "./sql-errors";
import type { ScopeRef } from "./sla-policy-directory";

export type ConversationVisibility =
  { unconfined: true } | { unconfined: false; scopeKeys: string[] };

export function scopeKey(scope: ScopeRef): string {
  return `${scope.type}:${scope.id}`;
}

type ConversationRow = {
  id: string;
  source_kind: SourceKind;
  source_ref: string;
  channel_account_id: string | null;
  business_scope_type: string | null;
  business_scope_id: string | null;
  first_inbound_at: Date;
  last_inbound_at: Date;
  awaiting_since: Date | null;
  customer_state: CustomerState;
  status: ConversationStatus;
  assignee_tenant_user_id: string | null;
  assigned_at: Date | null;
  first_responded_at: Date | null;
  last_responded_at: Date | null;
  answered_through: Date | null;
  sla_policy_id: string | null;
  response_due_kind: DueKind | null;
  response_due_at: Date | null;
  sla_breached_at: Date | null;
  version: number;
};

export type ConversationView = {
  id: string;
  sourceKind: SourceKind;
  sourceRef: string;
  channelAccountId: string | null;
  businessScope: ScopeRef | null;
  status: ConversationStatus;
  customerState: CustomerState;
  assigneeTenantUserId: string | null;
  assignedAt: string | null;
  firstInboundAt: string;
  lastInboundAt: string;
  awaitingSince: string | null;
  firstRespondedAt: string | null;
  lastRespondedAt: string | null;
  sla: {
    state: SlaState;
    policyId: string | null;
    dueKind: DueKind | null;
    dueAt: string | null;
    breachedAt: string | null;
  };
  tagIds: string[];
  version: number;
};

export type ActivityView = {
  id: string;
  kind: ActivityKind;
  actorTenantUserId: string | null;
  subjectTenantUserId: string | null;
  detailCode: string | null;
  createdAt: string;
};

const iso = (value: Date | null): string | null =>
  value ? value.toISOString() : null;

export function slaStateOf(
  row: Pick<ConversationRow, "response_due_at" | "sla_breached_at">,
  now: Date
): SlaState {
  if (!row.response_due_at) return "none";

  return row.sla_breached_at || row.response_due_at <= now
    ? "breached"
    : "on_track";
}

function toView(
  row: ConversationRow,
  tagIds: string[],
  now: Date
): ConversationView {
  return {
    id: row.id,
    sourceKind: row.source_kind,
    sourceRef: row.source_ref,
    channelAccountId: row.channel_account_id,
    businessScope:
      row.business_scope_type && row.business_scope_id
        ? { type: row.business_scope_type, id: row.business_scope_id }
        : null,
    status: row.status,
    customerState: row.customer_state,
    assigneeTenantUserId: row.assignee_tenant_user_id,
    assignedAt: iso(row.assigned_at),
    firstInboundAt: row.first_inbound_at.toISOString(),
    lastInboundAt: row.last_inbound_at.toISOString(),
    awaitingSince: iso(row.awaiting_since),
    firstRespondedAt: iso(row.first_responded_at),
    lastRespondedAt: iso(row.last_responded_at),
    sla: {
      state: slaStateOf(row, now),
      policyId: row.sla_policy_id,
      dueKind: row.response_due_kind,
      dueAt: iso(row.response_due_at),
      breachedAt: iso(row.sla_breached_at)
    },
    tagIds,
    version: row.version
  };
}

export function encodeConversationCursor(lastInboundAt: Date, id: string) {
  return Buffer.from(
    JSON.stringify({ t: lastInboundAt.toISOString(), i: id })
  ).toString("base64url");
}

async function tagsOf(
  tx: Bun.SQL,
  tenantId: string,
  conversationIds: string[]
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();

  if (conversationIds.length === 0) return result;

  const rows = (await tx`
    SELECT conversation_id, tag_id FROM awcms_inbox_conversation_tags
    WHERE tenant_id = ${tenantId}
      AND conversation_id = ANY(${tx.array(conversationIds, "uuid")})
    ORDER BY created_at, tag_id
  `) as { conversation_id: string; tag_id: string }[];

  for (const row of rows) {
    const list = result.get(row.conversation_id) ?? [];
    list.push(row.tag_id);
    result.set(row.conversation_id, list);
  }

  return result;
}

export async function listConversations(
  tx: Bun.SQL,
  tenantId: string,
  visibility: ConversationVisibility,
  callerTenantUserId: string,
  query: ListConversationsQuery,
  now: Date
): Promise<{ items: ConversationView[]; nextCursor: string | null }> {
  const unconfined = visibility.unconfined;
  const keys = tx.array(
    visibility.unconfined ? [] : visibility.scopeKeys,
    "text"
  );
  const anyStatus = query.status === null;
  const status = query.status ?? "";
  const anyAssignee = query.assignee === null;
  const unassigned = query.assignee === "unassigned";
  const assigneeId =
    query.assignee === "me"
      ? callerTenantUserId
      : query.assignee && query.assignee !== "unassigned"
        ? query.assignee
        : null;
  const breachedOnly = query.slaState === "breached";
  const anyTag = query.tagId === null;
  const tagId = query.tagId;
  const anySource = query.sourceKind === null;
  const sourceKind = query.sourceKind ?? "";
  const hasCursor = query.cursor !== null;
  const cursorAt = query.cursor?.lastInboundAt ?? now;
  const cursorId = query.cursor?.id ?? "00000000-0000-0000-0000-000000000000";
  const rows = (await tx`
    SELECT c.id, c.source_kind, c.source_ref, c.channel_account_id,
           c.business_scope_type, c.business_scope_id, c.first_inbound_at,
           c.last_inbound_at, c.awaiting_since, c.customer_state, c.status,
           c.assignee_tenant_user_id, c.assigned_at, c.first_responded_at,
           c.last_responded_at, c.answered_through, c.sla_policy_id,
           c.response_due_kind, c.response_due_at, c.sla_breached_at, c.version
    FROM awcms_inbox_conversations c
    WHERE c.tenant_id = ${tenantId}
      AND (${unconfined}::boolean
           OR (c.business_scope_id IS NOT NULL
               AND (c.business_scope_type || ':' || c.business_scope_id::text) = ANY(${keys})))
      AND (${anyStatus}::boolean OR c.status = ${status})
      AND (${anyAssignee}::boolean
           OR (${unassigned}::boolean AND c.assignee_tenant_user_id IS NULL)
           OR (NOT ${unassigned}::boolean AND c.assignee_tenant_user_id = ${assigneeId}::uuid))
      AND (NOT ${breachedOnly}::boolean
           OR (c.response_due_at IS NOT NULL
               AND (c.sla_breached_at IS NOT NULL OR c.response_due_at <= ${now})))
      AND (${anySource}::boolean OR c.source_kind = ${sourceKind})
      AND (${anyTag}::boolean OR EXISTS (
            SELECT 1 FROM awcms_inbox_conversation_tags t
            WHERE t.tenant_id = c.tenant_id AND t.conversation_id = c.id
              AND t.tag_id = ${tagId}::uuid))
      AND (NOT ${hasCursor}::boolean
           OR (c.last_inbound_at, c.id) < (${cursorAt}::timestamptz, ${cursorId}::uuid))
    ORDER BY c.last_inbound_at DESC, c.id DESC
    LIMIT ${query.limit + 1}
  `) as ConversationRow[];
  const page = rows.slice(0, query.limit);
  const tags = await tagsOf(
    tx,
    tenantId,
    page.map((row) => row.id)
  );
  const last = page[page.length - 1];

  return {
    items: page.map((row) => toView(row, tags.get(row.id) ?? [], now)),
    nextCursor:
      rows.length > query.limit && last
        ? encodeConversationCursor(last.last_inbound_at, last.id)
        : null
  };
}

/** The row, if it exists in this tenant AND is visible to the caller; otherwise `null` (one answer, no IDOR oracle). */
async function fetchVisibleRow(
  tx: Bun.SQL,
  tenantId: string,
  id: string,
  visibility: ConversationVisibility,
  lock: boolean
): Promise<ConversationRow | null> {
  const unconfined = visibility.unconfined;
  const keys = tx.array(
    visibility.unconfined ? [] : visibility.scopeKeys,
    "text"
  );
  const rows = (
    lock
      ? await tx`
    SELECT id, source_kind, source_ref, channel_account_id, business_scope_type,
           business_scope_id, first_inbound_at, last_inbound_at, awaiting_since,
           customer_state, status, assignee_tenant_user_id, assigned_at,
           first_responded_at, last_responded_at, answered_through, sla_policy_id,
           response_due_kind, response_due_at, sla_breached_at, version
    FROM awcms_inbox_conversations
    WHERE tenant_id = ${tenantId} AND id = ${id}
      AND (${unconfined}::boolean
           OR (business_scope_id IS NOT NULL
               AND (business_scope_type || ':' || business_scope_id::text) = ANY(${keys})))
    FOR UPDATE
  `
      : await tx`
    SELECT id, source_kind, source_ref, channel_account_id, business_scope_type,
           business_scope_id, first_inbound_at, last_inbound_at, awaiting_since,
           customer_state, status, assignee_tenant_user_id, assigned_at,
           first_responded_at, last_responded_at, answered_through, sla_policy_id,
           response_due_kind, response_due_at, sla_breached_at, version
    FROM awcms_inbox_conversations
    WHERE tenant_id = ${tenantId} AND id = ${id}
      AND (${unconfined}::boolean
           OR (business_scope_id IS NOT NULL
               AND (business_scope_type || ':' || business_scope_id::text) = ANY(${keys})))
  `
  ) as ConversationRow[];

  return rows[0] ?? null;
}

export async function getConversation(
  tx: Bun.SQL,
  tenantId: string,
  id: string,
  visibility: ConversationVisibility,
  now: Date
): Promise<(ConversationView & { activity: ActivityView[] }) | null> {
  const row = await fetchVisibleRow(tx, tenantId, id, visibility, false);

  if (!row) return null;

  const tags = await tagsOf(tx, tenantId, [row.id]);
  const activity = (await tx`
    SELECT id, kind, actor_tenant_user_id, subject_tenant_user_id, detail_code,
           created_at
    FROM awcms_inbox_activity
    WHERE tenant_id = ${tenantId} AND conversation_id = ${row.id}
    ORDER BY created_at DESC, id DESC
    LIMIT ${MAX_ACTIVITY_ON_DETAIL}
  `) as {
    id: string;
    kind: ActivityKind;
    actor_tenant_user_id: string | null;
    subject_tenant_user_id: string | null;
    detail_code: string | null;
    created_at: Date;
  }[];

  return {
    ...toView(row, tags.get(row.id) ?? [], now),
    activity: activity.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      actorTenantUserId: entry.actor_tenant_user_id,
      subjectTenantUserId: entry.subject_tenant_user_id,
      detailCode: entry.detail_code,
      createdAt: entry.created_at.toISOString()
    }))
  };
}

async function recordActivity(
  tx: Bun.SQL,
  tenantId: string,
  conversationId: string,
  kind: ActivityKind,
  actorTenantUserId: string | null,
  subjectTenantUserId: string | null,
  detailCode: string | null
): Promise<void> {
  await tx`
    INSERT INTO awcms_inbox_activity
      (tenant_id, conversation_id, kind, actor_tenant_user_id,
       subject_tenant_user_id, detail_code)
    VALUES (${tenantId}, ${conversationId}, ${kind}, ${actorTenantUserId},
            ${subjectTenantUserId}, ${detailCode})
  `;
}

export type WriteRefusal =
  | { outcome: "not_found" }
  | { outcome: "version_conflict"; currentVersion: number }
  | { outcome: "customer_unreachable" };

type Locked =
  { ok: true; row: ConversationRow } | { ok: false; refusal: WriteRefusal };

async function lockForWrite(
  tx: Bun.SQL,
  tenantId: string,
  id: string,
  visibility: ConversationVisibility,
  expectedVersion: number
): Promise<Locked> {
  const row = await fetchVisibleRow(tx, tenantId, id, visibility, true);

  if (!row) return { ok: false, refusal: { outcome: "not_found" } };

  if (row.version !== expectedVersion) {
    return {
      ok: false,
      refusal: { outcome: "version_conflict", currentVersion: row.version }
    };
  }

  return { ok: true, row };
}

async function reread(
  tx: Bun.SQL,
  tenantId: string,
  id: string,
  now: Date
): Promise<ConversationView> {
  const row = await fetchVisibleRow(
    tx,
    tenantId,
    id,
    { unconfined: true },
    false
  );
  const tags = await tagsOf(tx, tenantId, [id]);

  return toView(row!, tags.get(id) ?? [], now);
}

export async function changeStatus(
  tx: Bun.SQL,
  tenantId: string,
  id: string,
  visibility: ConversationVisibility,
  actorTenantUserId: string,
  input: { status: ConversationStatus; expectedVersion: number },
  now: Date
): Promise<
  | { outcome: "changed" | "unchanged"; conversation: ConversationView }
  | WriteRefusal
> {
  const locked = await lockForWrite(
    tx,
    tenantId,
    id,
    visibility,
    input.expectedVersion
  );

  if (!locked.ok) return locked.refusal;

  const { row } = locked;

  if (row.status === input.status) {
    return {
      outcome: "unchanged",
      conversation: await reread(tx, tenantId, id, now)
    };
  }

  if (
    row.customer_state === "withdrawn" &&
    !SETTLING_STATUSES.includes(input.status)
  ) {
    return { outcome: "customer_unreachable" };
  }

  const settles = SETTLING_STATUSES.includes(input.status);

  await tx`
    UPDATE awcms_inbox_conversations
    SET status = ${input.status},
        answered_through = CASE WHEN ${settles}::boolean
          THEN GREATEST(COALESCE(answered_through, last_inbound_at), last_inbound_at)
          ELSE answered_through END,
        awaiting_since = CASE WHEN ${settles}::boolean THEN NULL ELSE awaiting_since END,
        response_due_kind = CASE WHEN ${settles}::boolean THEN NULL ELSE response_due_kind END,
        response_due_at = CASE WHEN ${settles}::boolean THEN NULL ELSE response_due_at END,
        version = version + 1,
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id}
  `;
  await recordActivity(
    tx,
    tenantId,
    id,
    "status_changed",
    actorTenantUserId,
    null,
    input.status
  );

  return {
    outcome: "changed",
    conversation: await reread(tx, tenantId, id, now)
  };
}

/**
 * Records that a staff member answered (through the arrival channel's own
 * route; the inbox sends nothing). Settles everything received up to now and
 * stops the SLA clock.
 */
export async function recordResponse(
  tx: Bun.SQL,
  tenantId: string,
  id: string,
  visibility: ConversationVisibility,
  actorTenantUserId: string,
  input: { expectedVersion: number },
  now: Date
): Promise<
  { outcome: "recorded"; conversation: ConversationView } | WriteRefusal
> {
  const locked = await lockForWrite(
    tx,
    tenantId,
    id,
    visibility,
    input.expectedVersion
  );

  if (!locked.ok) return locked.refusal;

  if (locked.row.customer_state !== "active") {
    return { outcome: "customer_unreachable" };
  }

  const dueKind = locked.row.response_due_kind ?? "none";

  await tx`
    UPDATE awcms_inbox_conversations
    SET first_responded_at = COALESCE(first_responded_at, ${now}),
        last_responded_at = ${now},
        answered_through = GREATEST(COALESCE(answered_through, ${now}), ${now}),
        awaiting_since = NULL,
        response_due_kind = NULL,
        response_due_at = NULL,
        sla_breached_at = NULL,
        version = version + 1,
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id}
  `;
  await recordActivity(
    tx,
    tenantId,
    id,
    "response_recorded",
    actorTenantUserId,
    null,
    dueKind
  );

  return {
    outcome: "recorded",
    conversation: await reread(tx, tenantId, id, now)
  };
}

export async function setConversationTags(
  tx: Bun.TransactionSQL,
  tenantId: string,
  id: string,
  visibility: ConversationVisibility,
  actorTenantUserId: string,
  input: { tagIds: string[]; expectedVersion: number },
  now: Date
): Promise<
  | { outcome: "changed" | "unchanged"; conversation: ConversationView }
  | WriteRefusal
  | { outcome: "tag_unknown" }
> {
  const locked = await lockForWrite(
    tx,
    tenantId,
    id,
    visibility,
    input.expectedVersion
  );

  if (!locked.ok) return locked.refusal;

  const current = (await tagsOf(tx, tenantId, [id])).get(id) ?? [];
  const wanted = [...new Set(input.tagIds)];
  const added = wanted.filter((tag) => !current.includes(tag));
  const removed = current.filter((tag) => !wanted.includes(tag));

  if (added.length === 0 && removed.length === 0) {
    return {
      outcome: "unchanged",
      conversation: await reread(tx, tenantId, id, now)
    };
  }

  if (added.length > 0) {
    const live = (await tx`
      SELECT id FROM awcms_inbox_tags
      WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
        AND id = ANY(${tx.array(added, "uuid")})
    `) as { id: string }[];

    if (live.length !== added.length) return { outcome: "tag_unknown" };
  }

  // Every write in ONE savepoint: a tag deleted between the check above and
  // the insert (the guard trigger, sql/384) rolls back the whole change, and
  // the request's transaction stays healthy for the refusal.
  try {
    await tx.savepoint(async (sp) => {
      for (const tag of removed) {
        await sp`
          DELETE FROM awcms_inbox_conversation_tags
          WHERE tenant_id = ${tenantId} AND conversation_id = ${id} AND tag_id = ${tag}
        `;
        await recordActivity(
          sp,
          tenantId,
          id,
          "tag_removed",
          actorTenantUserId,
          null,
          tag
        );
      }

      for (const tag of added) {
        await sp`
          INSERT INTO awcms_inbox_conversation_tags
            (tenant_id, conversation_id, tag_id, created_by)
          VALUES (${tenantId}, ${id}, ${tag}, ${actorTenantUserId})
        `;
        await recordActivity(
          sp,
          tenantId,
          id,
          "tag_added",
          actorTenantUserId,
          null,
          tag
        );
      }

      await sp`
        UPDATE awcms_inbox_conversations
        SET version = version + 1, updated_at = now()
        WHERE tenant_id = ${tenantId} AND id = ${id}
      `;
    });
  } catch (error) {
    // The savepoint already rolled the whole change back.
    if (isCheckViolation(error)) return { outcome: "tag_unknown" };

    throw error;
  }

  return {
    outcome: "changed",
    conversation: await reread(tx, tenantId, id, now)
  };
}

export type AssignOutcome =
  | {
      outcome: "assigned" | "unassigned" | "unchanged";
      previousAssignee: string | null;
      conversation: ConversationView;
    }
  | WriteRefusal
  | { outcome: "assignee_not_eligible"; reason: string };

export async function assignConversation(
  tx: Bun.SQL,
  tenantId: string,
  id: string,
  visibility: ConversationVisibility,
  actorTenantUserId: string,
  input: { assigneeTenantUserId: string | null; expectedVersion: number },
  now: Date,
  checkEligible: (
    assigneeId: string,
    scope: ScopeRef | null
  ) => Promise<{ eligible: boolean; reason?: string }>
): Promise<AssignOutcome> {
  const locked = await lockForWrite(
    tx,
    tenantId,
    id,
    visibility,
    input.expectedVersion
  );

  if (!locked.ok) return locked.refusal;

  const { row } = locked;
  const previous = row.assignee_tenant_user_id;

  if (previous === input.assigneeTenantUserId) {
    return {
      outcome: "unchanged",
      previousAssignee: previous,
      conversation: await reread(tx, tenantId, id, now)
    };
  }

  if (input.assigneeTenantUserId) {
    const scope =
      row.business_scope_type && row.business_scope_id
        ? { type: row.business_scope_type, id: row.business_scope_id }
        : null;
    const eligibility = await checkEligible(input.assigneeTenantUserId, scope);

    if (!eligibility.eligible) {
      return {
        outcome: "assignee_not_eligible",
        reason: eligibility.reason ?? "not_eligible"
      };
    }
  }

  await tx`
    UPDATE awcms_inbox_conversations
    SET assignee_tenant_user_id = ${input.assigneeTenantUserId},
        assigned_at = ${input.assigneeTenantUserId ? now : null},
        -- Eligibility was just proven (or there is nobody to check).
        assignee_checked_at = ${input.assigneeTenantUserId ? now : null},
        version = version + 1,
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id}
  `;

  if (input.assigneeTenantUserId) {
    await recordActivity(
      tx,
      tenantId,
      id,
      "assigned",
      actorTenantUserId,
      input.assigneeTenantUserId,
      previous ? "reassigned" : null
    );
  } else {
    await recordActivity(
      tx,
      tenantId,
      id,
      "unassigned",
      actorTenantUserId,
      previous,
      null
    );
  }

  return {
    outcome: input.assigneeTenantUserId ? "assigned" : "unassigned",
    previousAssignee: previous,
    conversation: await reread(tx, tenantId, id, now)
  };
}
