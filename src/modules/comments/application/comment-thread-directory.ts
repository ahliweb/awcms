/**
 * Comment-thread data access (ADR-0041, ported from awcms-micro Issue #271) over
 * `awcms_comments_threads` (`sql/066`). Get-or-create a thread for a resolved,
 * PUBLISHED commentable resource, and maintain its denormalized counters. Every
 * query runs inside a caller-provided tenant transaction (RLS FORCE'd).
 */
import type { CommentPolicyMode } from "../domain/comment-policy";
import type { CommentSettings } from "../domain/comment-settings";
import type { ResolvedCommentableResource } from "./commentable-resource-engine";

export type CommentThread = {
  id: string;
  resourceType: string;
  resourceId: string;
  locale: string;
  url: string;
  policyMode: CommentPolicyMode;
  isClosed: boolean;
  commentCount: number;
  approvedCount: number;
};

type ThreadRow = {
  id: string;
  resource_type: string;
  resource_id: string;
  locale: string;
  url: string;
  policy_mode: CommentPolicyMode;
  is_closed: boolean;
  comment_count: number;
  approved_count: number;
};

function toThread(row: ThreadRow): CommentThread {
  return {
    id: row.id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    locale: row.locale,
    url: row.url,
    policyMode: row.policy_mode,
    isClosed: row.is_closed,
    commentCount: row.comment_count,
    approvedCount: row.approved_count
  };
}

const THREAD_COLUMNS =
  "id, resource_type, resource_id, locale, url, policy_mode, is_closed, comment_count, approved_count";

/** Read an existing thread for a resource, or null. */
export async function findThread(
  tx: Bun.SQL,
  tenantId: string,
  input: { resourceType: string; resourceId: string; locale: string }
): Promise<CommentThread | null> {
  const rows = (await tx`
    SELECT ${tx.unsafe(THREAD_COLUMNS)}
    FROM awcms_comments_threads
    WHERE tenant_id = ${tenantId}
      AND resource_type = ${input.resourceType}
      AND resource_id = ${input.resourceId}
      AND locale = ${input.locale}
  `) as ThreadRow[];
  return rows[0] ? toThread(rows[0]) : null;
}

/**
 * Get-or-create the thread for a resolved commentable resource. The thread's
 * initial `policy_mode` comes from the tenant settings' default policy (falling
 * back to the descriptor's `defaultPolicy`). The URL is refreshed to the
 * server-derived value on every resolution (never a raw tenant-supplied URL).
 */
export async function getOrCreateThread(
  tx: Bun.SQL,
  tenantId: string,
  resolved: ResolvedCommentableResource,
  settings: CommentSettings
): Promise<CommentThread> {
  const policyMode: CommentPolicyMode =
    settings.defaultPolicyMode ?? resolved.descriptor.defaultPolicy;

  const rows = (await tx`
    INSERT INTO awcms_comments_threads
      (tenant_id, resource_type, resource_id, locale, url, policy_mode)
    VALUES (
      ${tenantId}, ${resolved.resourceType}, ${resolved.resourceId},
      ${resolved.locale}, ${resolved.url}, ${policyMode}
    )
    ON CONFLICT (tenant_id, resource_type, resource_id, locale) DO UPDATE SET
      url = EXCLUDED.url,
      updated_at = now()
    RETURNING ${tx.unsafe(THREAD_COLUMNS)}
  `) as ThreadRow[];

  return toThread(rows[0]!);
}

/** Resolve the thread that owns a given comment (tenant-scoped), or null. */
export async function findThreadByComment(
  tx: Bun.SQL,
  tenantId: string,
  commentId: string
): Promise<CommentThread | null> {
  const rows = (await tx`
    SELECT t.id, t.resource_type, t.resource_id, t.locale, t.url, t.policy_mode,
           t.is_closed, t.comment_count, t.approved_count
    FROM awcms_comments_comments c
    JOIN awcms_comments_threads t
      ON t.tenant_id = c.tenant_id AND t.id = c.thread_id
    WHERE c.tenant_id = ${tenantId} AND c.id = ${commentId}
  `) as ThreadRow[];
  return rows[0] ? toThread(rows[0]) : null;
}

/** Adjust the denormalized counters after an insert/moderation transition. */
export async function adjustThreadCounters(
  tx: Bun.SQL,
  tenantId: string,
  threadId: string,
  delta: { comment?: number; approved?: number }
): Promise<void> {
  const commentDelta = delta.comment ?? 0;
  const approvedDelta = delta.approved ?? 0;
  if (commentDelta === 0 && approvedDelta === 0) return;
  await tx`
    UPDATE awcms_comments_threads
    SET comment_count = GREATEST(0, comment_count + ${commentDelta}),
        approved_count = GREATEST(0, approved_count + ${approvedDelta}),
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${threadId}
  `;
}
