/**
 * Admin/moderation flows (ADR-0041, ported from awcms-micro Issue #271): the
 * moderation queue and the approve/reject/spam/archive/restore/delete
 * transitions.
 *
 * This sentence used to end "(single + bulk)", and that was wrong in a way
 * worth recording: `delete` had no route at all until ADR-0058 §B, and bulk
 * moderation still only passes approve/reject — deliberately, since a bulk
 * control for the one irreversible action turns a single mistake into a page
 * of the queue. A header describing a surface that does not exist is how the
 * gap survived review: readers saw confirmation instead of a question.
 *
 * The queue is the ONLY surface that exposes moderation metadata (reason codes,
 * masked email, report counts). Every transition is validated by the pure
 * `applyModerationAction` state machine, writes an append-only moderation-event
 * row, adjusts thread counters, publishes the `comment.approved` event when
 * approving, and is audited by the caller-supplied hook.
 */
import {
  applyModerationAction,
  IllegalCommentTransitionError,
  type CommentStatus,
  type ModerationAction
} from "../domain/comment-status";
import { COMMENT_APPROVED_EVENT_TYPE } from "../domain/comment-events";
import { appendCommentEvent } from "./reply-notifications";

export type ModerationQueueItem = {
  id: string;
  threadId: string;
  resourceType: string;
  resourceUrl: string;
  parentId: string | null;
  depth: number;
  bodyText: string;
  status: CommentStatus;
  authorKind: string;
  authorDisplayName: string | null;
  authorEmailMasked: string | null;
  moderationReasonCode: string | null;
  reportCount: number;
  createdAt: string;
};

/** Full-precision keyset cursor — see `listModerationQueue`. */
export type ModerationCursor = { createdAt: string; id: string };

type QueueRow = {
  id: string;
  created_at_cursor: string;
  thread_id: string;
  resource_type: string;
  resource_url: string;
  parent_id: string | null;
  depth: number;
  body_text: string;
  status: CommentStatus;
  author_kind: string;
  author_display_name: string | null;
  author_email_masked: string | null;
  moderation_reason_code: string | null;
  report_count: number;
  created_at: string;
};

const QUEUE_STATUSES: readonly CommentStatus[] = [
  "pending",
  "approved",
  "rejected",
  "spam",
  "deleted"
];

/**
 * Moderation queue — status-filtered, keyset-paginated on `(created_at, id)`.
 *
 * The cursor is a full-precision `to_char(...)` TEXT column for the same reason
 * `listApprovedComments` uses one: `timestamptz` is microsecond-precision, a JS
 * `Date` is millisecond-precision, and the driver floors — so a `Date`-shaped
 * cursor silently skips every row sharing its millisecond (Issue #158).
 */
export async function listModerationQueue(
  tx: Bun.SQL,
  tenantId: string,
  options: {
    status?: CommentStatus | null;
    limit?: number;
    beforeCreatedAt?: string | null;
    beforeId?: string | null;
  } = {}
): Promise<{
  items: ModerationQueueItem[];
  nextCursor: ModerationCursor | null;
}> {
  const limit = Math.min(Math.max(1, options.limit ?? 25), 100);
  const status =
    options.status && QUEUE_STATUSES.includes(options.status)
      ? options.status
      : null;
  const before = options.beforeCreatedAt ?? null;
  const beforeId = options.beforeId ?? null;

  const rows = (await tx`
    SELECT c.id, c.thread_id, t.resource_type, t.url AS resource_url, c.parent_id,
           c.depth, c.body_text, c.status, c.author_kind, c.author_display_name,
           c.author_email_masked, c.moderation_reason_code, c.created_at,
           to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"') AS created_at_cursor,
           (SELECT count(*) FROM awcms_comments_reports r
              WHERE r.tenant_id = c.tenant_id AND r.comment_id = c.id
                AND r.status = 'open')::int AS report_count
    FROM awcms_comments_comments c
    JOIN awcms_comments_threads t
      ON t.tenant_id = c.tenant_id AND t.id = c.thread_id
    WHERE c.tenant_id = ${tenantId}
      AND (${status}::text IS NULL OR c.status = ${status}::text)
      AND (
        ${before}::timestamptz IS NULL
        OR (c.created_at, c.id) < (${before}::timestamptz, ${beforeId}::uuid)
      )
    ORDER BY c.created_at DESC, c.id DESC
    LIMIT ${limit + 1}
  `) as QueueRow[];

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last
      ? { createdAt: last.created_at_cursor, id: last.id }
      : null;

  return {
    items: page.map((row) => ({
      id: row.id,
      threadId: row.thread_id,
      resourceType: row.resource_type,
      resourceUrl: row.resource_url,
      parentId: row.parent_id,
      depth: row.depth,
      bodyText: row.body_text,
      status: row.status,
      authorKind: row.author_kind,
      authorDisplayName: row.author_display_name,
      authorEmailMasked: row.author_email_masked,
      moderationReasonCode: row.moderation_reason_code,
      reportCount: row.report_count,
      createdAt: row.created_at
    })),
    nextCursor
  };
}

export type ModerationAuditHook = (
  tx: Bun.SQL,
  detail: {
    commentId: string;
    action: ModerationAction;
    fromStatus: CommentStatus;
    toStatus: CommentStatus;
    reasonCode: string | null;
  }
) => Promise<void>;

export type ModerateResult =
  | { ok: true; toStatus: CommentStatus }
  | { ok: false; reason: "not_found" | "illegal_transition" };

/**
 * Apply one moderation action to one comment. Reason code is required for
 * reject/spam; the archive action stamps its own reserved reason. Publishes the
 * `comment.approved` outbox event on an approve.
 */
export async function moderateComment(
  tx: Bun.SQL,
  tenantId: string,
  commentId: string,
  action: ModerationAction,
  input: {
    reasonCode: string | null;
    actorUserId: string;
    note: string | null;
    correlationId?: string | null;
  },
  recordAudit: ModerationAuditHook
): Promise<ModerateResult> {
  const rows = (await tx`
    SELECT c.status, c.thread_id, t.resource_type, t.url AS resource_url, c.parent_id
    FROM awcms_comments_comments c
    JOIN awcms_comments_threads t
      ON t.tenant_id = c.tenant_id AND t.id = c.thread_id
    WHERE c.tenant_id = ${tenantId} AND c.id = ${commentId}
  `) as {
    status: CommentStatus;
    thread_id: string;
    resource_type: string;
    resource_url: string;
    parent_id: string | null;
  }[];
  const row = rows[0];
  if (!row) return { ok: false, reason: "not_found" };

  let outcome;
  try {
    outcome = applyModerationAction(row.status, action);
  } catch (error) {
    if (error instanceof IllegalCommentTransitionError) {
      return { ok: false, reason: "illegal_transition" };
    }
    throw error;
  }

  const reasonCode = input.reasonCode ?? outcome.impliedReasonCode;
  const wasApproved = row.status === "approved";
  const nowApproved = outcome.status === "approved";

  // `published_at` is stamped when a comment BECOMES publicly visible and is
  // never cleared afterwards. awcms-micro reset it to NULL on every
  // non-approving transition, which erased the record that an archived comment
  // had ever been published — contradicting archive's own "retain for history"
  // purpose. COALESCE keeps the first publication time; the append-only
  // moderation-event rows carry the withdrawal timestamp.
  await tx`
    UPDATE awcms_comments_comments
    SET status = ${outcome.status},
        moderation_reason_code = ${reasonCode},
        published_at = CASE
          WHEN ${nowApproved} THEN coalesce(published_at, now())
          ELSE published_at
        END,
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${commentId}
  `;

  await tx`
    INSERT INTO awcms_comments_moderation_events
      (tenant_id, comment_id, action, reason_code, actor_user_id, actor_kind, note)
    VALUES (${tenantId}, ${commentId}, ${action}, ${reasonCode},
            ${input.actorUserId}, 'moderator', ${input.note})
  `;

  // Resolve open reports when a decision is taken.
  //
  // `delete` joined this set with ADR-0058 §B, which gave moderators the action
  // at all. It belongs here for the reason the other three do, only more so: a
  // deleted comment is the most final decision available and cannot be acted on
  // again, so leaving its reports `open` would keep it counted in the queue's
  // `report_count` forever — reported content nobody can do anything about,
  // inflating every "reports needing attention" reading permanently.
  //
  // This touches no existing caller: `archive`/`restore` are unchanged, bulk
  // moderation only passes approve/reject, and the author self-delete path
  // (`requestCommentDeletion`) writes its row directly without coming through
  // here. Before §B no code path could reach this branch with `delete` at all.
  if (
    action === "reject" ||
    action === "spam" ||
    action === "approve" ||
    action === "delete"
  ) {
    await tx`
      UPDATE awcms_comments_reports
      SET status = 'reviewed'
      WHERE tenant_id = ${tenantId} AND comment_id = ${commentId} AND status = 'open'
    `;
  }

  // Thread approved-counter delta.
  const approvedDelta = (nowApproved ? 1 : 0) - (wasApproved ? 1 : 0);
  if (approvedDelta !== 0) {
    await tx`
      UPDATE awcms_comments_threads
      SET approved_count = GREATEST(0, approved_count + ${approvedDelta}), updated_at = now()
      WHERE tenant_id = ${tenantId} AND id = ${row.thread_id}
    `;
  }

  if (nowApproved && !wasApproved) {
    await appendCommentEvent(tx, tenantId, {
      eventType: COMMENT_APPROVED_EVENT_TYPE,
      commentId,
      threadId: row.thread_id,
      parentCommentId: row.parent_id,
      resourceType: row.resource_type,
      resourceUrl: row.resource_url,
      status: "approved",
      correlationId: input.correlationId ?? null,
      actorTenantUserId: input.actorUserId
    });
  }

  await recordAudit(tx, {
    commentId,
    action,
    fromStatus: row.status,
    toStatus: outcome.status,
    reasonCode
  });

  return { ok: true, toStatus: outcome.status };
}

export type BulkModerateResult = {
  applied: string[];
  skipped: { id: string; reason: "not_found" | "illegal_transition" }[];
};

/** Apply the same moderation action to many comments (tenant-bounded, per-item safe). */
export async function bulkModerateComments(
  tx: Bun.SQL,
  tenantId: string,
  commentIds: readonly string[],
  action: ModerationAction,
  input: {
    reasonCode: string | null;
    actorUserId: string;
    note: string | null;
    correlationId?: string | null;
  },
  recordAudit: ModerationAuditHook
): Promise<BulkModerateResult> {
  const applied: string[] = [];
  const skipped: BulkModerateResult["skipped"] = [];
  for (const id of commentIds) {
    const result = await moderateComment(
      tx,
      tenantId,
      id,
      action,
      input,
      recordAudit
    );
    if (result.ok) applied.push(id);
    else skipped.push({ id, reason: result.reason });
  }
  return { applied, skipped };
}
