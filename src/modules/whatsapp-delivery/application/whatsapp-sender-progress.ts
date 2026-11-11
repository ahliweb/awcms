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
 * ## Scope: the same rule as `GET /whatsapp/senders`
 *
 * A sender IS a `channel_accounts` account, so who may see it is decided by
 * `loadSenderAccess().canUseAccount(..., "viewer")`: the account exists in this
 * tenant, the caller's assignment lets them in, and its business scope (brand)
 * is one the caller holds. An unknown id, another tenant's account and an
 * account the caller cannot see are one answer: `null`, which the route turns
 * into `404`. A failed import of the channel module is a denial.
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
 * another sender, another tenant (RLS hides the row) or a purged row fails
 * `isCursorHonourable` and the client is told to re-fetch the snapshot.
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

export type WhatsappSenderProgressCounts = Record<
  WhatsappMessageStatusValue,
  number
>;

export type WhatsappSenderProgressChange = {
  id: string;
  status: WhatsappMessageStatusValue;
  updatedAt: string;
};

export type WhatsappSenderResource = { accountId: string };

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

/** The cursor of a sender with no messages yet: "nothing seen". */
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

/** Visibility, by the rules of `channel_accounts` (see the module header). */
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

  return visible ? { accountId } : null;
}

export async function readSenderHead(
  tx: Bun.SQL,
  tenantId: string,
  accountId: string
): Promise<string> {
  const rows = (await tx`
    SELECT ((extract(epoch FROM updated_at) * 1000000)::bigint)::text AS micros,
           id::text AS id
    FROM awcms_whatsapp_messages
    WHERE tenant_id = ${tenantId}
      AND sender_account_id = ${accountId}
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
  accountId: string,
  cursor: string
): Promise<boolean> {
  const parsed = parseSenderCursor(cursor);

  if (!parsed || parsed.accountId !== accountId) return false;
  if (parsed.micros === "0") return parsed.messageId === NIL_UUID;

  // The row must still exist, for THIS sender, in THIS tenant (RLS), and must
  // not have been stamped earlier than the position claims: a fabricated
  // future position is refused rather than silently skipping changes.
  const rows = (await tx`
    SELECT 1 AS present
    FROM awcms_whatsapp_messages
    WHERE tenant_id = ${tenantId}
      AND sender_account_id = ${accountId}
      AND id = ${parsed.messageId}
      AND updated_at >= timestamptz 'epoch' + (${parsed.micros}::bigint * interval '1 microsecond')
    LIMIT 1
  `) as { present: number }[];

  return rows.length > 0;
}

export async function readSenderChangesSince(
  tx: Bun.SQL,
  tenantId: string,
  accountId: string,
  cursor: string,
  limit: number
): Promise<ProgressChangesPage<WhatsappSenderProgressChange>> {
  const parsed = parseSenderCursor(cursor);

  // Unreachable through the route (the cursor was validated or produced by the
  // server); answered as "too much to describe" rather than as "no changes".
  if (!parsed || parsed.accountId !== accountId)
    return { items: [], more: true };

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

export async function readSenderCounts(
  tx: Bun.SQL,
  tenantId: string,
  accountId: string
): Promise<WhatsappSenderProgressCounts> {
  const rows = (await tx`
    SELECT status, count(*)::int AS n
    FROM awcms_whatsapp_messages
    WHERE tenant_id = ${tenantId}
      AND sender_account_id = ${accountId}
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
    readSenderHead(context.tx, context.tenantId, resource.accountId),
  isCursorHonourable: (context, resource, cursor) =>
    isSenderCursorHonourable(
      context.tx,
      context.tenantId,
      resource.accountId,
      cursor
    ),
  readChangesSince: (context, resource, cursor, limit) =>
    readSenderChangesSince(
      context.tx,
      context.tenantId,
      resource.accountId,
      cursor,
      limit
    ),
  readCounts: (context, resource) =>
    readSenderCounts(context.tx, context.tenantId, resource.accountId),
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
  /** The most recently changed messages of this sender (id, status, when), newest first. */
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
  const cursor = await readSenderHead(tx, tenantId, resource.accountId);
  const counts = await readSenderCounts(tx, tenantId, resource.accountId);
  const rows = (await tx`
    SELECT id::text AS id, status, updated_at
    FROM awcms_whatsapp_messages
    WHERE tenant_id = ${tenantId}
      AND sender_account_id = ${resource.accountId}
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
