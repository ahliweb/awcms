/**
 * The `whatsapp.sender.progress` realtime topic (Issue #1171, ADR-0154): live
 * delivery progress of ONE tenant-owned WhatsApp sender's lane, projected from
 * `awcms_whatsapp_messages` — the queue that already is the system of record.
 *
 * Nothing here writes, enqueues, or calls a provider (ADR-0148 I10, R2). A frame
 * is derived from committed rows; a row is never derived from a frame.
 *
 * ## Why a sender lane is the first topic
 *
 * It is the durable progress that exists today. There is no campaign entity in
 * this repository and no inbox (Issue #1164); a sender's lane — how many of its
 * messages are queued, retrying, sending, sent, failed, cancelled or expired —
 * is what a broadcast through that number looks like from the operator's seat.
 * A campaign module would add its own topic over its own rows
 * (`_shared/realtime-topics.ts`).
 *
 * ## Scope: the account, AND the rows (audit M-1)
 *
 * A sender IS a `channel_accounts` account, so who may see it is decided by
 * `loadSenderAccess().canUseAccount(..., "viewer")`: the account exists in this
 * tenant, the caller's assignment lets them in, and its business scope (brand)
 * is one the caller holds. An unknown id, another tenant's account and an
 * account the caller cannot see are one answer: `null`, which the route turns
 * into `404`. A failed import of the channel module is a denial.
 *
 * Seeing the account is not seeing every row through it. A TENANT-WIDE sender
 * (no business scope) carries messages of every brand, so a caller confined to
 * business scopes sees only the rows whose OWN scope they hold, in the counts,
 * the change list, the recent list and the cursor alike; an unscoped row is
 * invisible to them. An unconfined caller sees every row, as before.
 *
 * ## What a frame may carry (R7)
 *
 * Counts per status, and per changed message only its id, its status and when
 * it changed. Never the recipient (raw, masked or hashed), the body, the
 * variables, the template, the provider name or response, or an error text.
 *
 * ## The cursor
 *
 * `wsp1.<accountId>.<updated_at in epoch microseconds>.<message id>` — a
 * keyset position over `(updated_at, id)` for this sender, computed by
 * PostgreSQL (microsecond-exact; a JS `Date` would truncate to milliseconds and
 * re-send or skip rows at the boundary). It names its account, so a cursor from
 * another sender, another tenant (RLS hides the row), a row the caller may not
 * see, or a purged row fails `isCursorHonourable` and the client is told to
 * re-fetch the snapshot.
 *
 * ### The limit of a timestamp keyset, stated plainly
 *
 * `updated_at = now()` is the start of the WRITING transaction. A transaction
 * that began before a tick and commits after it lands BEHIND the cursor, and the
 * change list will not report that message. The counters are recomputed from
 * the table on every tick, so they are always right; the change list is a hint,
 * and the REST snapshot is the authority for an individual message. The
 * dispatcher's own transactions are short (no network I/O inside them), so the
 * window is the length of one finalise.
 */
import type {
  ProgressChangesPage,
  ProgressTopic,
  ProgressTopicContext
} from "../../_shared/progress-sse-route";
import { WHATSAPP_SENDER_PROGRESS_TOPIC } from "../../_shared/realtime-topics";
import {
  loadSenderAccess,
  type SenderAccessGuard
} from "../infrastructure/channel-account-access-loader";
import {
  WHATSAPP_MESSAGE_STATUSES,
  type WhatsappMessageStatusValue
} from "./whatsapp-diagnostics";

export const WHATSAPP_PROGRESS_GUARD = {
  moduleKey: "whatsapp_delivery",
  activityCode: "progress",
  action: "read"
} as const satisfies SenderAccessGuard;

/**
 * The counting window (audit M-2c): counters cover messages of this sender
 * CREATED in the last seven days, read from
 * `awcms_whatsapp_messages_sender_window_idx`. A broadcast lives inside it; an
 * all-time count would grow with the queue's whole retention and be paid on
 * every tick of every open stream.
 */
export const WHATSAPP_PROGRESS_COUNT_WINDOW_DAYS = 7;

export type WhatsappSenderProgressCounts = Record<
  WhatsappMessageStatusValue,
  number
>;

export type WhatsappSenderProgressChange = {
  id: string;
  status: WhatsappMessageStatusValue;
  updatedAt: string;
};

/**
 * A sender the caller may see, and WHICH OF ITS ROWS they may see.
 *
 * `scopeKeys` is `null` for a caller who is not confined to business scopes
 * (every row). For a confined caller it is the `type:id` list of the scopes
 * they hold; an empty list means "no row" (fail-closed).
 */
export type WhatsappSenderResource = {
  accountId: string;
  scopeKeys: string[] | null;
};

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_PATTERN = new RegExp(`^${UUID}$`);
const CURSOR_PATTERN = new RegExp(
  `^wsp1\\.(${UUID})\\.(0|[1-9][0-9]{0,17})\\.(${UUID})$`
);
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

export function parseSenderId(raw: string | undefined): string | null {
  const value = (raw ?? "").trim().toLowerCase();

  return UUID_PATTERN.test(value) ? value : null;
}

export type ParsedSenderCursor = {
  accountId: string;
  micros: string;
  messageId: string;
};

export function encodeSenderCursor(cursor: ParsedSenderCursor): string {
  return `wsp1.${cursor.accountId}.${cursor.micros}.${cursor.messageId}`;
}

export function parseSenderCursor(raw: string): ParsedSenderCursor | null {
  const match = CURSOR_PATTERN.exec(raw);

  if (!match) return null;

  return { accountId: match[1]!, micros: match[2]!, messageId: match[3]! };
}

/** The cursor of a sender with no visible messages yet: "nothing seen". */
export function zeroSenderCursor(accountId: string): string {
  return encodeSenderCursor({ accountId, micros: "0", messageId: NIL_UUID });
}

function isStatus(value: string): value is WhatsappMessageStatusValue {
  return (WHATSAPP_MESSAGE_STATUSES as readonly string[]).includes(value);
}

function emptyCounts(): WhatsappSenderProgressCounts {
  return Object.fromEntries(
    WHATSAPP_MESSAGE_STATUSES.map((status) => [status, 0])
  ) as WhatsappSenderProgressCounts;
}

/** Visibility of the account AND of its rows (see the module header). */
export async function resolveVisibleSender(
  context: ProgressTopicContext,
  accountId: string
): Promise<WhatsappSenderResource | null> {
  const access = await loadSenderAccess();

  if (!access) return null;

  const visible = await access.canUseAccount(
    context,
    WHATSAPP_PROGRESS_GUARD,
    accountId,
    "viewer"
  );

  if (!visible) return null;

  // Decided per call — per tick, on a fresh request identity — so a scope
  // gained or lost mid-stream changes the rows on the next tick.
  if (!(await access.isConfined(context))) {
    return { accountId, scopeKeys: null };
  }

  const covered = await access.coveredScopes(context, WHATSAPP_PROGRESS_GUARD);

  return {
    accountId,
    scopeKeys: covered.map((scope) => `${scope.type}:${scope.id}`)
  };
}

/**
 * The row filter every read below applies, as two bound values:
 * `unconfined` (every row) or `keys` (rows whose own `type:id` scope is
 * listed). A NULL scope concatenates to NULL and never matches, so an unscoped
 * row is invisible to a confined caller.
 */
function rowScope(tx: Bun.SQL, resource: WhatsappSenderResource) {
  return {
    unconfined: resource.scopeKeys === null,
    keys: tx.array(resource.scopeKeys ?? [], "text")
  };
}

export async function readSenderHead(
  tx: Bun.SQL,
  tenantId: string,
  resource: WhatsappSenderResource
): Promise<string> {
  const { accountId } = resource;
  const scope = rowScope(tx, resource);
  const rows = (await tx`
    SELECT ((extract(epoch FROM updated_at) * 1000000)::bigint)::text AS micros,
           id::text AS id
    FROM awcms_whatsapp_messages
    WHERE tenant_id = ${tenantId}
      AND sender_account_id = ${accountId}
      AND (${scope.unconfined}::boolean
           OR (business_scope_type || ':' || business_scope_id::text) = ANY(${scope.keys}))
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  `) as { micros: string; id: string }[];
  const row = rows[0];

  return row
    ? encodeSenderCursor({ accountId, micros: row.micros, messageId: row.id })
    : zeroSenderCursor(accountId);
}

export async function isSenderCursorHonourable(
  tx: Bun.SQL,
  tenantId: string,
  resource: WhatsappSenderResource,
  cursor: string
): Promise<boolean> {
  const { accountId } = resource;
  const parsed = parseSenderCursor(cursor);

  if (!parsed || parsed.accountId !== accountId) return false;
  if (parsed.micros === "0") return parsed.messageId === NIL_UUID;

  // The row must still exist, for THIS sender, in THIS tenant (RLS), be one
  // the caller may see, and not have been stamped earlier than the position
  // claims: a fabricated future position is refused rather than silently
  // skipping changes.
  const scope = rowScope(tx, resource);
  const rows = (await tx`
    SELECT 1 AS present
    FROM awcms_whatsapp_messages
    WHERE tenant_id = ${tenantId}
      AND sender_account_id = ${accountId}
      AND id = ${parsed.messageId}
      AND updated_at >= timestamptz 'epoch' + (${parsed.micros}::bigint * interval '1 microsecond')
      AND (${scope.unconfined}::boolean
           OR (business_scope_type || ':' || business_scope_id::text) = ANY(${scope.keys}))
    LIMIT 1
  `) as { present: number }[];

  return rows.length > 0;
}

export async function readSenderChangesSince(
  tx: Bun.SQL,
  tenantId: string,
  resource: WhatsappSenderResource,
  cursor: string,
  limit: number
): Promise<ProgressChangesPage<WhatsappSenderProgressChange>> {
  const { accountId } = resource;
  const parsed = parseSenderCursor(cursor);

  // Unreachable through the route (the cursor was validated or produced by the
  // server); answered as "too much to describe" rather than as "no changes".
  if (!parsed || parsed.accountId !== accountId)
    return { items: [], more: true };

  const scope = rowScope(tx, resource);
  const rows = (await tx`
    SELECT id::text AS id,
           status,
           updated_at,
           ((extract(epoch FROM updated_at) * 1000000)::bigint)::text AS micros
    FROM awcms_whatsapp_messages
    WHERE tenant_id = ${tenantId}
      AND sender_account_id = ${accountId}
      AND (updated_at, id) > (
        timestamptz 'epoch' + (${parsed.micros}::bigint * interval '1 microsecond'),
        ${parsed.messageId}::uuid
      )
      AND (${scope.unconfined}::boolean
           OR (business_scope_type || ':' || business_scope_id::text) = ANY(${scope.keys}))
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
            cursor: encodeSenderCursor({
              accountId,
              micros: row.micros,
              messageId: row.id
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
 * Counts per status over the counting window, with the caller's row filter.
 * ONE statement with every value bound exactly as the stream binds it, so the
 * query-budget test measures the plan the stream runs.
 */
export async function readSenderCounts(
  tx: Bun.SQL,
  tenantId: string,
  resource: WhatsappSenderResource
): Promise<WhatsappSenderProgressCounts> {
  const scope = rowScope(tx, resource);
  const rows = (await tx`
    SELECT status, count(*)::int AS n
    FROM awcms_whatsapp_messages
    WHERE tenant_id = ${tenantId}
      AND sender_account_id = ${resource.accountId}
      AND created_at >= now() - make_interval(days => ${WHATSAPP_PROGRESS_COUNT_WINDOW_DAYS}::int)
      AND (${scope.unconfined}::boolean
           OR (business_scope_type || ':' || business_scope_id::text) = ANY(${scope.keys}))
    GROUP BY status
  `) as { status: string; n: number }[];
  const counts = emptyCounts();

  for (const row of rows) {
    if (isStatus(row.status)) counts[row.status] = Number(row.n);
  }

  return counts;
}

/** The cursor's commit-time in ms, for the frame-lag metric. */
export function senderCursorTimestampMs(cursor: string): number | null {
  const parsed = parseSenderCursor(cursor);

  if (!parsed || parsed.micros === "0") return null;

  return Math.floor(Number(parsed.micros) / 1000);
}

export const whatsappSenderProgressTopic: ProgressTopic<
  WhatsappSenderResource,
  WhatsappSenderProgressCounts,
  WhatsappSenderProgressChange
> = {
  topic: WHATSAPP_SENDER_PROGRESS_TOPIC,
  moduleKey: "whatsapp_delivery",
  authorize: WHATSAPP_PROGRESS_GUARD,
  parseResourceId: parseSenderId,
  resolveResource: (context, resourceId) =>
    resolveVisibleSender(context, resourceId),
  readHead: (context, resource) =>
    readSenderHead(context.tx, context.tenantId, resource),
  isCursorHonourable: (context, resource, cursor) =>
    isSenderCursorHonourable(context.tx, context.tenantId, resource, cursor),
  readChangesSince: (context, resource, cursor, limit) =>
    readSenderChangesSince(
      context.tx,
      context.tenantId,
      resource,
      cursor,
      limit
    ),
  readCounts: (context, resource) =>
    readSenderCounts(context.tx, context.tenantId, resource),
  cursorTimestampMs: senderCursorTimestampMs
};

/** What the REST snapshot returns: the same projection the stream frames carry. */
export type WhatsappSenderProgressSnapshot = {
  v: 1;
  topic: string;
  resourceId: string;
  cursor: string;
  at: string;
  counts: WhatsappSenderProgressCounts;
  /** The counting window of `counts`, in days (messages created within it). */
  countWindowDays: number;
  /** The most recently changed messages the caller may see (id, status, when), newest first. */
  recent: WhatsappSenderProgressChange[];
};

export async function readSenderProgressSnapshot(
  context: ProgressTopicContext,
  resource: WhatsappSenderResource,
  recentLimit: number
): Promise<WhatsappSenderProgressSnapshot> {
  const { tx, tenantId } = context;
  // Head first, then counts: anything committed in between appears in the
  // counts and again later as a change, never the other way round.
  const cursor = await readSenderHead(tx, tenantId, resource);
  const counts = await readSenderCounts(tx, tenantId, resource);
  const scope = rowScope(tx, resource);
  const rows = (await tx`
    SELECT id::text AS id, status, updated_at
    FROM awcms_whatsapp_messages
    WHERE tenant_id = ${tenantId}
      AND sender_account_id = ${resource.accountId}
      AND (${scope.unconfined}::boolean
           OR (business_scope_type || ':' || business_scope_id::text) = ANY(${scope.keys}))
    ORDER BY updated_at DESC, id DESC
    LIMIT ${recentLimit}
  `) as { id: string; status: string; updated_at: Date | string }[];

  return {
    v: 1,
    topic: WHATSAPP_SENDER_PROGRESS_TOPIC,
    resourceId: resource.accountId,
    cursor,
    at: context.now.toISOString(),
    counts,
    countWindowDays: WHATSAPP_PROGRESS_COUNT_WINDOW_DAYS,
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
