/**
 * Public comment flows (ADR-0041, ported from awcms-micro Issue #271): submit,
 * reply, list, edit-within-window, report, delete-request. Every query runs inside a caller-provided
 * tenant transaction (RLS FORCE'd). The public LIST path returns ONLY approved,
 * non-deleted comments and NEVER any moderation metadata (reason codes, actor,
 * ip/email hashes) — those live only on the admin surface.
 */
import {
  hashIdentifierValue,
  maskIdentifierValue,
  normalizeIdentifierValue
} from "../../profile-identity/domain/identifier";
import {
  computeContentFingerprint,
  evaluateAntiAbuse,
  type AntiAbuseReason
} from "../domain/anti-abuse";
import {
  decideCommentPolicy,
  type CommentAuthorKind,
  type CommentPolicyRejectionReason
} from "../domain/comment-policy";
import type { CommentSettings } from "../domain/comment-settings";
import {
  normalizeCommentBody,
  renderCommentHtml,
  type CommentBodyRejectionReason
} from "../domain/comment-sanitization";
import { resolveReplyDepth } from "../domain/comment-thread";
import {
  COMMENT_APPROVED_EVENT_TYPE,
  COMMENT_SUBMITTED_EVENT_TYPE,
  REPLY_CREATED_EVENT_TYPE
} from "../domain/comment-events";
import {
  adjustThreadCounters,
  type CommentThread
} from "./comment-thread-directory";
import { appendCommentEvent } from "./reply-notifications";
import type { ResolvedCommentableResource } from "./commentable-resource-engine";

/** A single public-facing comment — moderation metadata is intentionally absent. */
export type PublicCommentView = {
  id: string;
  parentId: string | null;
  depth: number;
  bodyHtml: string;
  authorDisplayName: string | null;
  authorKind: CommentAuthorKind;
  createdAt: string;
  editedAt: string | null;
};

export type SubmitCommentInput = {
  body: string;
  parentId: string | null;
  authorKind: CommentAuthorKind;
  authorUserId: string | null;
  authorDisplayName: string | null;
  /** Raw author email (optional) — normalized, hashed, masked here; never stored raw. */
  authorEmail: string | null;
  honeypot: string | null;
  elapsedMs: number | null;
  ipHash: string | null;
  userAgentHash: string | null;
};

export type SubmitCommentResult =
  | {
      accepted: true;
      commentId: string;
      status: "pending" | "approved";
      publiclyVisible: boolean;
    }
  | {
      accepted: false;
      reason:
        | CommentPolicyRejectionReason
        | CommentBodyRejectionReason
        | AntiAbuseReason
        | "depth_exceeded"
        | "duplicate";
    };

const DUPLICATE_WINDOW_SECONDS = 600;

/** Full-precision keyset cursor — see `listApprovedComments` on why this is text, not a Date. */
export type CommentCursor = { createdAt: string; id: string };

type CommentRow = {
  id: string;
  created_at_cursor: string;
  parent_id: string | null;
  depth: number;
  body_text: string;
  status: string;
  author_kind: CommentAuthorKind;
  author_display_name: string | null;
  author_user_id: string | null;
  author_ip_hash: string | null;
  edit_deadline_at: string | null;
  created_at: string;
  edited_at: string | null;
};

/**
 * Author binding: a registered author is bound by matching tenant_user id; an
 * anonymous author is bound by matching the stored IP hash. A caller can never
 * edit/delete a comment they did not author.
 */
function isBoundAuthor(
  comment: Pick<
    CommentRow,
    "author_kind" | "author_user_id" | "author_ip_hash"
  >,
  binding: { userId: string | null; ipHash: string | null }
): boolean {
  if (comment.author_kind === "registered") {
    return (
      comment.author_user_id !== null &&
      comment.author_user_id === binding.userId
    );
  }
  return (
    comment.author_ip_hash !== null && comment.author_ip_hash === binding.ipHash
  );
}

/** Record a minimized anti-abuse telemetry row (privacy-first — hashes + reason). */
export async function recordAbuseEvent(
  tx: Bun.SQL,
  tenantId: string,
  input: {
    ipHash: string | null;
    fingerprintHash: string | null;
    reason: string;
  }
): Promise<void> {
  await tx`
    INSERT INTO awcms_comments_abuse_events
      (tenant_id, ip_hash, fingerprint_hash, reason)
    VALUES (${tenantId}, ${input.ipHash}, ${input.fingerprintHash}, ${input.reason})
  `;
}

async function isDuplicate(
  tx: Bun.SQL,
  tenantId: string,
  threadId: string,
  fingerprint: string
): Promise<boolean> {
  const rows = (await tx`
    SELECT 1 FROM awcms_comments_comments
    WHERE tenant_id = ${tenantId}
      AND thread_id = ${threadId}
      AND content_fingerprint = ${fingerprint}
      AND created_at >= now() - make_interval(secs => ${DUPLICATE_WINDOW_SECONDS})
    LIMIT 1
  `) as unknown[];
  return rows.length > 0;
}

/**
 * Submit a new comment (top-level or reply). Enforces, in order: policy gate,
 * body normalization/bounds, anti-abuse (honeypot/timing/blocked-terms),
 * bounded reply depth, duplicate fingerprint. On acceptance it inserts the
 * comment, updates thread counters, and publishes the submitted (+approved when
 * auto-approved / reply.created) domain events through the outbox.
 */
export async function submitComment(
  tx: Bun.SQL,
  tenantId: string,
  resolved: ResolvedCommentableResource,
  thread: CommentThread,
  settings: CommentSettings,
  input: SubmitCommentInput,
  options: { correlationId?: string | null } = {}
): Promise<SubmitCommentResult> {
  const policy = decideCommentPolicy({
    policyMode: thread.policyMode,
    authorKind: input.authorKind,
    threadClosed: thread.isClosed,
    settings: {
      requireModeration: settings.requireModeration,
      allowAnonymous: settings.allowAnonymous
    }
  });
  if (!policy.accepted) {
    return { accepted: false, reason: policy.reason };
  }

  const normalized = normalizeCommentBody(input.body, {
    maxLength: settings.maxLength,
    maxLinks: settings.maxLinksPerComment
  });
  if (!normalized.ok) {
    return { accepted: false, reason: normalized.reason };
  }

  const abuse = evaluateAntiAbuse(
    {
      honeypotValue: input.honeypot,
      elapsedMs: input.elapsedMs,
      body: normalized.value
    },
    {
      minSubmitSeconds: settings.minSubmitSeconds,
      blockedTerms: settings.blockedTerms
    }
  );
  if (abuse.blocked) {
    await recordAbuseEvent(tx, tenantId, {
      ipHash: input.ipHash,
      fingerprintHash: null,
      reason: abuse.reason
    });
    return { accepted: false, reason: abuse.reason };
  }

  // Bounded reply depth.
  let depth = 0;
  if (input.parentId) {
    const parentRows = (await tx`
      SELECT depth FROM awcms_comments_comments
      WHERE tenant_id = ${tenantId} AND thread_id = ${thread.id} AND id = ${input.parentId}
    `) as { depth: number }[];
    const parentDepth = parentRows[0]?.depth ?? null;
    if (parentDepth === null) {
      return { accepted: false, reason: "depth_exceeded" };
    }
    try {
      depth = resolveReplyDepth(parentDepth, settings.maxDepth);
    } catch {
      return { accepted: false, reason: "depth_exceeded" };
    }
  }

  // Author identity minimization.
  const authorKey =
    input.authorUserId ??
    (input.authorEmail ? input.authorEmail : input.ipHash) ??
    "anon";
  const fingerprint = computeContentFingerprint({
    body: normalized.value,
    authorKey
  });
  if (await isDuplicate(tx, tenantId, thread.id, fingerprint)) {
    return { accepted: false, reason: "duplicate" };
  }

  let emailHash: string | null = null;
  let emailMasked: string | null = null;
  if (input.authorEmail) {
    const norm = normalizeIdentifierValue("email", input.authorEmail);
    emailHash = hashIdentifierValue(norm);
    emailMasked = maskIdentifierValue(norm, "email");
  }

  const editDeadline =
    settings.editWindowSeconds > 0
      ? new Date(Date.now() + settings.editWindowSeconds * 1000)
      : null;

  const rows = (await tx`
    INSERT INTO awcms_comments_comments
      (tenant_id, thread_id, parent_id, depth, body_text, status, author_kind,
       author_user_id, author_display_name, author_email_hash, author_email_masked,
       author_ip_hash, user_agent_hash, edit_deadline_at, content_fingerprint,
       published_at)
    VALUES (
      ${tenantId}, ${thread.id}, ${input.parentId}, ${depth}, ${normalized.value},
      ${policy.initialStatus}, ${input.authorKind}, ${input.authorUserId},
      ${input.authorDisplayName}, ${emailHash}, ${emailMasked}, ${input.ipHash},
      ${input.userAgentHash}, ${editDeadline}, ${fingerprint},
      ${policy.initialStatus === "approved" ? new Date() : null}
    )
    RETURNING id
  `) as { id: string }[];
  const commentId = rows[0]!.id;

  await adjustThreadCounters(tx, tenantId, thread.id, {
    comment: 1,
    approved: policy.initialStatus === "approved" ? 1 : 0
  });

  const eventBase = {
    commentId,
    threadId: thread.id,
    parentCommentId: input.parentId,
    resourceType: resolved.resourceType,
    resourceUrl: resolved.url,
    correlationId: options.correlationId ?? null,
    actorTenantUserId: input.authorUserId
  };
  await appendCommentEvent(tx, tenantId, {
    ...eventBase,
    eventType: COMMENT_SUBMITTED_EVENT_TYPE,
    status: policy.initialStatus
  });
  if (input.parentId) {
    await appendCommentEvent(tx, tenantId, {
      ...eventBase,
      eventType: REPLY_CREATED_EVENT_TYPE,
      status: policy.initialStatus
    });
  }
  if (policy.initialStatus === "approved") {
    await appendCommentEvent(tx, tenantId, {
      ...eventBase,
      eventType: COMMENT_APPROVED_EVENT_TYPE,
      status: "approved"
    });
  }

  return {
    accepted: true,
    commentId,
    status: policy.initialStatus,
    publiclyVisible: policy.initialStatus === "approved"
  };
}

/**
 * List approved, non-deleted comments for a thread. NO moderation metadata:
 * reason codes, actor ids, and the ip/email hashes never appear on this path,
 * only on the admin surface.
 *
 * ## Cursor precision (port-time fix)
 *
 * awcms-micro paged on the driver-materialized `created_at` value. `timestamptz`
 * carries MICROsecond precision while a JS `Date` carries milliseconds, and the
 * driver floors — so a cursor round-tripped through a `Date` lands slightly
 * BEFORE the row it came from, and `created_at < cursor` then skips every row
 * sharing that millisecond. Two comments posted in the same millisecond are not
 * exotic on a busy thread.
 *
 * This base already fixed that class of bug (Issue #158); the cursor here is a
 * full-precision `to_char(...)` TEXT column, inlined as a literal fragment the
 * same way `sod-conflict-evaluation-log.ts` and `email-message-directory.ts`
 * do. The tiebreak is `(created_at, id)` so even a genuine microsecond
 * collision advances deterministically.
 *
 * Never `tx.unsafe()` inside a tagged template — that builds a whole raw string
 * rather than composing as a fragment.
 */
export async function listApprovedComments(
  tx: Bun.SQL,
  tenantId: string,
  threadId: string,
  options: {
    limit?: number;
    beforeCreatedAt?: string | null;
    beforeId?: string | null;
  } = {}
): Promise<{ items: PublicCommentView[]; nextCursor: CommentCursor | null }> {
  const limit = Math.min(Math.max(1, options.limit ?? 50), 100);
  const before = options.beforeCreatedAt ?? null;
  const beforeId = options.beforeId ?? null;

  const rows = (await tx`
    SELECT id, parent_id, depth, body_text, author_kind, author_display_name,
           created_at, edited_at,
           to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"') AS created_at_cursor
    FROM awcms_comments_comments
    WHERE tenant_id = ${tenantId}
      AND thread_id = ${threadId}
      AND status = 'approved'
      AND (
        ${before}::timestamptz IS NULL
        OR (created_at, id) < (${before}::timestamptz, ${beforeId}::uuid)
      )
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit + 1}
  `) as CommentRow[];

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last
      ? { createdAt: last.created_at_cursor, id: last.id }
      : null;

  return {
    items: page.map((row) => ({
      id: row.id,
      parentId: row.parent_id,
      depth: row.depth,
      bodyHtml: renderCommentHtml(row.body_text),
      authorDisplayName: row.author_display_name,
      authorKind: row.author_kind,
      createdAt: row.created_at,
      editedAt: row.edited_at
    })),
    nextCursor
  };
}

export type EditCommentResult =
  | { ok: true; bodyHtml: string }
  | {
      ok: false;
      reason: "not_found" | "window_expired" | CommentBodyRejectionReason;
    };

/**
 * Edit a comment within its edit window. `authorKey` binds the edit to the
 * original author (a registered user id, or the anonymous author's ip hash) — a
 * caller can never edit someone else's comment.
 */
export async function editCommentWithinWindow(
  tx: Bun.SQL,
  tenantId: string,
  commentId: string,
  authorBinding: { userId: string | null; ipHash: string | null },
  newBody: string,
  settings: CommentSettings
): Promise<EditCommentResult> {
  const rows = (await tx`
    SELECT id, parent_id, depth, body_text, status, author_kind,
           author_display_name, author_user_id, author_ip_hash, edit_deadline_at,
           created_at, edited_at
    FROM awcms_comments_comments
    WHERE tenant_id = ${tenantId} AND id = ${commentId}
      AND status IN ('pending', 'approved')
  `) as CommentRow[];
  const comment = rows[0];
  if (!comment) return { ok: false, reason: "not_found" };

  if (!isBoundAuthor(comment, authorBinding)) {
    return { ok: false, reason: "not_found" };
  }

  if (
    !comment.edit_deadline_at ||
    new Date(comment.edit_deadline_at).getTime() < Date.now()
  ) {
    return { ok: false, reason: "window_expired" };
  }

  const normalized = normalizeCommentBody(newBody, {
    maxLength: settings.maxLength,
    maxLinks: settings.maxLinksPerComment
  });
  if (!normalized.ok) return { ok: false, reason: normalized.reason };

  await tx`
    UPDATE awcms_comments_comments
    SET body_text = ${normalized.value}, edited_at = now(), updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${commentId}
  `;
  return { ok: true, bodyHtml: renderCommentHtml(normalized.value) };
}

export type ReportReason = "spam" | "abuse" | "offensive" | "other";

/** File an abuse report (dedup-bounded by the DB unique index). */
export async function reportComment(
  tx: Bun.SQL,
  tenantId: string,
  commentId: string,
  input: {
    reporterIpHash: string;
    reporterEmailHash: string | null;
    reason: ReportReason;
    detail: string | null;
  }
): Promise<{ ok: boolean }> {
  // Only accept a report against an existing, publicly-visible-or-pending comment.
  const exists = (await tx`
    SELECT 1 FROM awcms_comments_comments
    WHERE tenant_id = ${tenantId} AND id = ${commentId}
      AND status IN ('pending', 'approved')
    LIMIT 1
  `) as unknown[];
  if (exists.length === 0) return { ok: false };

  await tx`
    INSERT INTO awcms_comments_reports
      (tenant_id, comment_id, reporter_email_hash, reporter_ip_hash, reason_code, detail)
    VALUES (${tenantId}, ${commentId}, ${input.reporterEmailHash},
            ${input.reporterIpHash}, ${input.reason}, ${input.detail})
    ON CONFLICT (tenant_id, comment_id, reporter_ip_hash, reason_code) DO NOTHING
  `;
  return { ok: true };
}

/**
 * Author-initiated delete request: soft-deletes the author's OWN comment when it
 * is still within the edit window (a light-touch self-service delete). Beyond the
 * window it records a report with reason `other` for moderator action instead —
 * so history/threading stays coherent.
 */
export async function requestCommentDeletion(
  tx: Bun.SQL,
  tenantId: string,
  commentId: string,
  authorBinding: { userId: string | null; ipHash: string | null }
): Promise<{ ok: boolean; softDeleted: boolean }> {
  const rows = (await tx`
    SELECT id, parent_id, depth, body_text, status, author_kind,
           author_display_name, author_user_id, author_ip_hash, edit_deadline_at,
           created_at, edited_at
    FROM awcms_comments_comments
    WHERE tenant_id = ${tenantId} AND id = ${commentId}
      AND status IN ('pending', 'approved')
  `) as CommentRow[];
  const comment = rows[0];
  if (!comment) return { ok: false, softDeleted: false };

  if (!isBoundAuthor(comment, authorBinding)) {
    return { ok: false, softDeleted: false };
  }

  const withinWindow =
    comment.edit_deadline_at !== null &&
    new Date(comment.edit_deadline_at).getTime() >= Date.now();

  if (withinWindow) {
    await tx`
      UPDATE awcms_comments_comments
      SET status = 'deleted', updated_at = now()
      WHERE tenant_id = ${tenantId} AND id = ${commentId}
    `;
    await tx`
      INSERT INTO awcms_comments_moderation_events
        (tenant_id, comment_id, action, actor_kind, note)
      VALUES (${tenantId}, ${commentId}, 'delete', 'author', 'Author self-delete within edit window')
    `;
    if (comment.status === "approved") {
      const threadRows = (await tx`
        SELECT thread_id FROM awcms_comments_comments
        WHERE tenant_id = ${tenantId} AND id = ${commentId}
      `) as { thread_id: string }[];
      if (threadRows[0]) {
        await adjustThreadCounters(tx, tenantId, threadRows[0].thread_id, {
          approved: -1
        });
      }
    }
    return { ok: true, softDeleted: true };
  }

  // Past the window: queue a report for a moderator to action.
  await tx`
    INSERT INTO awcms_comments_reports
      (tenant_id, comment_id, reporter_ip_hash, reason_code, detail)
    VALUES (${tenantId}, ${commentId}, ${authorBinding.ipHash ?? "author"}, 'other',
            'Author-requested deletion after edit window')
    ON CONFLICT (tenant_id, comment_id, reporter_ip_hash, reason_code) DO NOTHING
  `;
  return { ok: true, softDeleted: false };
}
