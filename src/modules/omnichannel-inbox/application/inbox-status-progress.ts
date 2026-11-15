/**
 * The `inbox.status.progress` realtime topic (Issue #1171, ADR-0154 task 3): the
 * inbox's live work counts and "which conversations changed", projected from
 * `awcms_inbox_conversations` — the staff work projection that already is the
 * system of record (Issue #1164, ADR-0160).
 *
 * Nothing here writes, enqueues, or calls a provider (ADR-0148 I10, R2). A frame
 * is derived from committed rows; a row is never derived from a frame.
 *
 * ## A hint, not a preview (ADR-0154 section 8)
 *
 * Counts of ACTIVE work (open, pending, awaiting a reply, unassigned, SLA
 * breached) and, per changed conversation, only its id, its status and when it
 * changed. Never a source reference, a channel account, an assignee, a tag, a
 * message body or any customer identifier: the page re-fetches the list through
 * the authorized REST read.
 *
 * ## Scope: the same as the list
 *
 * `visibilityFor` (`route-support.ts`) — `channel_accounts`' rules through the
 * chokepoint, decided per call (per tick, on a fresh request identity) so a
 * scope gained or lost mid-stream changes the rows on the next tick. The ids in
 * a frame are further limited to what the actor's `conversations.read` covers
 * (`InboxStatusVisibility`); the counts follow `status.read` alone. The per-scope
 * decisions write no decision-log row (`recordDecision: false`). A caller
 * who is not unconfined never sees a tenant-wide conversation (its scope is
 * NULL and never matches the key list). An empty scope list shows nothing.
 *
 * ## The cursor
 *
 * `inb1.<updated_at in epoch microseconds>.<conversation id>` — a keyset
 * position over `(updated_at, id)` computed by PostgreSQL (microsecond-exact).
 * A cursor naming a row that is gone (retention purge), not visible to the
 * caller, or stamped earlier than it claims fails `isCursorHonourable` and the
 * client re-fetches the snapshot.
 *
 * ### The limit of a timestamp keyset
 *
 * `updated_at = now()` is the start of the WRITING transaction, so a
 * transaction that began before a tick and commits after it lands behind the
 * cursor. The counts are recomputed from the table on every tick and are always
 * right; the change list is a hint and the REST snapshot / list is the
 * authority for an individual conversation.
 */
import type {
  ProgressChangesPage,
  ProgressTopic,
  ProgressTopicContext
} from "../../_shared/progress-sse-route";
import { evaluateFieldAccessInTransaction } from "../../identity-access/application/access-guard";
import { INBOX_STATUS_PROGRESS_TOPIC } from "../../_shared/realtime-topics";
import { isOmnichannelInboxEnabled } from "../domain/inbox-config";
import {
  OMNICHANNEL_INBOX_GUARDS,
  type ConversationStatus
} from "../domain/inbox-constants";
import type { ConversationVisibility } from "./conversation-directory";
import { visibilityFor } from "./route-support";

export const INBOX_STATUS_GUARD = OMNICHANNEL_INBOX_GUARDS.readStatus;
const INBOX_LIST_GUARD = OMNICHANNEL_INBOX_GUARDS.readConversations;

/**
 * What a status viewer may see, in two parts (Issue #1171 audit L-1):
 *
 * - `counts`: the rows the COUNTS are computed over — `status.read` and its
 *   business-scope coverage. Counts are aggregates, not rows.
 * - `rows`: the rows whose ID, status and time may be named in `changes` /
 *   `recent` — the INTERSECTION of the `status.read` coverage and the caller's
 *   `conversations.read` coverage, i.e. only conversations the same actor could
 *   list through the REST list (ADR-0154 R6). A holder of `status.read` without
 *   `conversations.read` gets counts only; an ABAC deny of `conversations.read`
 *   for a brand removes that brand's ids from the frame.
 */
export type InboxStatusVisibility = {
  counts: ConversationVisibility;
  rows: ConversationVisibility;
};

/** The rows both coverages allow: unconfined only when both are, else the intersection of the key lists. */
export function intersectVisibility(
  a: ConversationVisibility,
  b: ConversationVisibility
): ConversationVisibility {
  if (a.unconfined) return b;
  if (b.unconfined) return a;

  const allowed = new Set(b.scopeKeys);

  return {
    unconfined: false,
    scopeKeys: a.scopeKeys.filter((key) => allowed.has(key))
  };
}

/** The one resource of this topic: the caller's own view of the tenant's inbox. */
export const INBOX_STATUS_RESOURCE_ID = "inbox";

export type InboxStatusCounts = {
  open: number;
  pending: number;
  /** Active conversations with an unanswered inbound. */
  awaitingReply: number;
  /** Active conversations with no assignee. */
  unassigned: number;
  /** Active conversations past their response due time (or stamped breached). */
  slaBreached: number;
};

export type InboxStatusChange = {
  id: string;
  status: ConversationStatus;
  updatedAt: string;
};

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const CURSOR_PATTERN = new RegExp(`^inb1\\.(0|[1-9][0-9]{0,17})\\.(${UUID})$`);
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const STATUSES: readonly string[] = [
  "open",
  "pending",
  "resolved",
  "closed"
] satisfies ConversationStatus[];

/** The route has no path parameter; anything supplied is "not found". */
export function parseInboxResourceId(raw: string | undefined): string | null {
  return raw === undefined || raw === "" ? INBOX_STATUS_RESOURCE_ID : null;
}

export type ParsedInboxCursor = { micros: string; conversationId: string };

export function encodeInboxCursor(cursor: ParsedInboxCursor): string {
  return `inb1.${cursor.micros}.${cursor.conversationId}`;
}

export function parseInboxCursor(raw: string): ParsedInboxCursor | null {
  const match = CURSOR_PATTERN.exec(raw);

  return match ? { micros: match[1]!, conversationId: match[2]! } : null;
}

/** "Nothing seen yet". */
export function zeroInboxCursor(): string {
  return encodeInboxCursor({ micros: "0", conversationId: NIL_UUID });
}

function isStatus(value: string): value is ConversationStatus {
  return STATUSES.includes(value);
}

/**
 * Visibility of the inbox: the module's switch, then the list's rules. A
 * switched-off inbox is "not here" (`null`, the route answers `404`); a failed
 * load of the scope rules shows nothing, never everything (`visibilityFor`).
 *
 * The scope questions are decided WITHOUT a decision-log row each
 * (`recordDecision: false`, audit M-1): this runs on every tick, and one row per
 * candidate scope per tick would flood the append-only ledger. The tick's own
 * `status.read` decision (made by the stream factory through the chokepoint)
 * still logs exactly once, and every deny rule still applies.
 */
export async function resolveInboxStatusVisibility(
  context: ProgressTopicContext
): Promise<InboxStatusVisibility | null> {
  if (!isOmnichannelInboxEnabled()) return null;

  const quiet = { recordDecision: false };
  const counts = await visibilityFor(context, INBOX_STATUS_GUARD, quiet);

  // Nothing is countable, so nothing is listable: skip the second question.
  if (!counts.unconfined && counts.scopeKeys.length === 0) {
    return { counts, rows: counts };
  }

  // The list permission itself, through the ABAC evaluator (RBAC grant AND no
  // applicable deny) and without a log row: `visibilityFor` reads the raw grant
  // for a tenant-wide caller, which an ABAC deny of `conversations.read` would
  // not remove. No permission, or a deny, means counts only.
  const mayList = await evaluateFieldAccessInTransaction(
    context.tx,
    context.tenantId,
    context.auth.context,
    context.auth.grantedPermissionKeys,
    INBOX_LIST_GUARD,
    context.now
  );

  if (!mayList) {
    return { counts, rows: { unconfined: false, scopeKeys: [] } };
  }

  const listable = await visibilityFor(context, INBOX_LIST_GUARD, quiet);

  return { counts, rows: intersectVisibility(counts, listable) };
}

/**
 * The row filter every read below applies, as two bound values: `unconfined`
 * (every row) or `keys` (rows whose own `type:id` scope is listed). A NULL
 * scope never matches, so a tenant-wide conversation is invisible to a
 * confined caller — the same predicate the list uses.
 */
function rowScope(tx: Bun.SQL, visibility: ConversationVisibility) {
  return {
    unconfined: visibility.unconfined,
    keys: tx.array(visibility.unconfined ? [] : visibility.scopeKeys, "text")
  };
}

export async function readInboxHead(
  tx: Bun.SQL,
  tenantId: string,
  visibility: ConversationVisibility
): Promise<string> {
  const scope = rowScope(tx, visibility);
  const rows = (await tx`
    SELECT ((extract(epoch FROM updated_at) * 1000000)::bigint)::text AS micros,
           id::text AS id
    FROM awcms_inbox_conversations
    WHERE tenant_id = ${tenantId}
      AND (${scope.unconfined}::boolean
           OR (business_scope_id IS NOT NULL
               AND (business_scope_type || ':' || business_scope_id::text) = ANY(${scope.keys})))
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  `) as { micros: string; id: string }[];
  const row = rows[0];

  return row
    ? encodeInboxCursor({ micros: row.micros, conversationId: row.id })
    : zeroInboxCursor();
}

export async function isInboxCursorHonourable(
  tx: Bun.SQL,
  tenantId: string,
  visibility: ConversationVisibility,
  cursor: string
): Promise<boolean> {
  const parsed = parseInboxCursor(cursor);

  if (!parsed) return false;
  if (parsed.micros === "0") return parsed.conversationId === NIL_UUID;

  // The row must still exist in THIS tenant (RLS), be one the caller may see,
  // and not have been stamped earlier than the position claims: a fabricated
  // future position is refused rather than silently skipping changes.
  const scope = rowScope(tx, visibility);
  const rows = (await tx`
    SELECT 1 AS present
    FROM awcms_inbox_conversations
    WHERE tenant_id = ${tenantId}
      AND id = ${parsed.conversationId}
      AND updated_at >= timestamptz 'epoch' + (${parsed.micros}::bigint * interval '1 microsecond')
      AND (${scope.unconfined}::boolean
           OR (business_scope_id IS NOT NULL
               AND (business_scope_type || ':' || business_scope_id::text) = ANY(${scope.keys})))
    LIMIT 1
  `) as { present: number }[];

  return rows.length > 0;
}

export async function readInboxChangesSince(
  tx: Bun.SQL,
  tenantId: string,
  visibility: ConversationVisibility,
  cursor: string,
  limit: number
): Promise<ProgressChangesPage<InboxStatusChange>> {
  const parsed = parseInboxCursor(cursor);

  // Unreachable through the route (the cursor was validated or produced by the
  // server); answered as "too much to describe" rather than as "no changes".
  if (!parsed) return { items: [], more: true };

  const scope = rowScope(tx, visibility);
  const rows = (await tx`
    SELECT id::text AS id,
           status,
           updated_at,
           ((extract(epoch FROM updated_at) * 1000000)::bigint)::text AS micros
    FROM awcms_inbox_conversations
    WHERE tenant_id = ${tenantId}
      AND (updated_at, id) > (
        timestamptz 'epoch' + (${parsed.micros}::bigint * interval '1 microsecond'),
        ${parsed.conversationId}::uuid
      )
      AND (${scope.unconfined}::boolean
           OR (business_scope_id IS NOT NULL
               AND (business_scope_type || ':' || business_scope_id::text) = ANY(${scope.keys})))
    ORDER BY updated_at, id
    LIMIT ${limit + 1}
  `) as {
    id: string;
    status: string;
    updated_at: Date | string;
    micros: string;
  }[];

  const more = rows.length > limit;
  const items = rows.slice(0, limit).flatMap((row) =>
    isStatus(row.status)
      ? [
          {
            cursor: encodeInboxCursor({
              micros: row.micros,
              conversationId: row.id
            }),
            change: {
              id: row.id,
              status: row.status,
              updatedAt: new Date(row.updated_at).toISOString()
            }
          }
        ]
      : []
  );

  return { items, more };
}

/**
 * Counts of ACTIVE work with the caller's row filter, in ONE statement over the
 * partial index `awcms_inbox_conversations_active_work_idx` (sql/413) so the
 * cost follows the work in progress. `slaBreached` is the list's own reading
 * (`slaStateOf`): a due time that has passed, or a stamped breach.
 */
export async function readInboxCounts(
  tx: Bun.SQL,
  tenantId: string,
  visibility: ConversationVisibility,
  now: Date
): Promise<InboxStatusCounts> {
  const scope = rowScope(tx, visibility);
  const rows = (await tx`
    SELECT count(*) FILTER (WHERE status = 'open')::int AS open,
           count(*) FILTER (WHERE status = 'pending')::int AS pending,
           count(*) FILTER (WHERE awaiting_since IS NOT NULL)::int AS awaiting_reply,
           count(*) FILTER (WHERE assignee_tenant_user_id IS NULL)::int AS unassigned,
           count(*) FILTER (
             WHERE response_due_at IS NOT NULL
               AND (sla_breached_at IS NOT NULL OR response_due_at <= ${now}::timestamptz)
           )::int AS sla_breached
    FROM awcms_inbox_conversations
    WHERE tenant_id = ${tenantId}
      AND status IN ('open', 'pending')
      AND (${scope.unconfined}::boolean
           OR (business_scope_id IS NOT NULL
               AND (business_scope_type || ':' || business_scope_id::text) = ANY(${scope.keys})))
  `) as {
    open: number;
    pending: number;
    awaiting_reply: number;
    unassigned: number;
    sla_breached: number;
  }[];
  const row = rows[0];

  return {
    open: Number(row?.open ?? 0),
    pending: Number(row?.pending ?? 0),
    awaitingReply: Number(row?.awaiting_reply ?? 0),
    unassigned: Number(row?.unassigned ?? 0),
    slaBreached: Number(row?.sla_breached ?? 0)
  };
}

/** The cursor's commit-time in ms, for the frame-lag metric. */
export function inboxCursorTimestampMs(cursor: string): number | null {
  const parsed = parseInboxCursor(cursor);

  if (!parsed || parsed.micros === "0") return null;

  return Math.floor(Number(parsed.micros) / 1000);
}

export const inboxStatusProgressTopic: ProgressTopic<
  InboxStatusVisibility,
  InboxStatusCounts,
  InboxStatusChange
> = {
  topic: INBOX_STATUS_PROGRESS_TOPIC,
  moduleKey: "omnichannel_inbox",
  authorize: INBOX_STATUS_GUARD,
  parseResourceId: parseInboxResourceId,
  resolveResource: (context) => resolveInboxStatusVisibility(context),
  readHead: (context, visibility) =>
    readInboxHead(context.tx, context.tenantId, visibility.rows),
  isCursorHonourable: (context, visibility, cursor) =>
    isInboxCursorHonourable(
      context.tx,
      context.tenantId,
      visibility.rows,
      cursor
    ),
  readChangesSince: (context, visibility, cursor, limit) =>
    readInboxChangesSince(
      context.tx,
      context.tenantId,
      visibility.rows,
      cursor,
      limit
    ),
  readCounts: (context, visibility) =>
    readInboxCounts(
      context.tx,
      context.tenantId,
      visibility.counts,
      context.now
    ),
  cursorTimestampMs: inboxCursorTimestampMs
};

/** What the REST snapshot returns: the same projection the stream frames carry. */
export type InboxStatusSnapshot = {
  v: 1;
  topic: string;
  resourceId: string;
  cursor: string;
  at: string;
  counts: InboxStatusCounts;
  /** The most recently changed conversations the caller may see (id, status, when), newest first. */
  recent: InboxStatusChange[];
};

export async function readInboxStatusSnapshot(
  context: ProgressTopicContext,
  visibility: InboxStatusVisibility,
  recentLimit: number
): Promise<InboxStatusSnapshot> {
  const { tx, tenantId } = context;
  // Head first, then counts: anything committed in between appears in the
  // counts and again later as a change, never the other way round.
  const cursor = await readInboxHead(tx, tenantId, visibility.rows);
  const counts = await readInboxCounts(
    tx,
    tenantId,
    visibility.counts,
    context.now
  );
  const scope = rowScope(tx, visibility.rows);
  const rows = (await tx`
    SELECT id::text AS id, status, updated_at
    FROM awcms_inbox_conversations
    WHERE tenant_id = ${tenantId}
      AND (${scope.unconfined}::boolean
           OR (business_scope_id IS NOT NULL
               AND (business_scope_type || ':' || business_scope_id::text) = ANY(${scope.keys})))
    ORDER BY updated_at DESC, id DESC
    LIMIT ${recentLimit}
  `) as { id: string; status: string; updated_at: Date | string }[];

  return {
    v: 1,
    topic: INBOX_STATUS_PROGRESS_TOPIC,
    resourceId: INBOX_STATUS_RESOURCE_ID,
    cursor,
    at: context.now.toISOString(),
    counts,
    recent: rows.flatMap((row) =>
      isStatus(row.status)
        ? [
            {
              id: row.id,
              status: row.status,
              updatedAt: new Date(row.updated_at).toISOString()
            }
          ]
        : []
    )
  };
}
