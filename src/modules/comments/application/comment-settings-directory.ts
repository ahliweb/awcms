/**
 * Tenant comment-config data access (ADR-0041 §6, ported from
 * awcms-micro Issue #271) over `awcms_comments_settings` (`sql/066`). Every query runs inside a
 * caller-provided tenant transaction (`withTenant`, RLS FORCE'd), so tenant
 * isolation holds twice (explicit `tenant_id` filter + RLS).
 *
 * `updateCommentSettings` is the only writer and records an audit event on every
 * write via the injected `recordAudit` callback (the composition root wires
 * `recordAuditEvent`; tests pass a spy).
 */
import {
  DEFAULT_COMMENT_SETTINGS,
  type CommentSettings
} from "../domain/comment-settings";
import type { CommentPolicyMode } from "../domain/comment-policy";

type SettingsRow = {
  default_policy_mode: CommentPolicyMode;
  require_moderation: boolean;
  allow_anonymous: boolean;
  edit_window_seconds: number;
  max_depth: number;
  max_length: number;
  max_links_per_comment: number;
  min_submit_seconds: number;
  rate_limit_per_hour: number;
  blocked_terms: string[];
  turnstile_enabled: boolean;
  notify_on_reply: boolean;
};

const SETTINGS_COLUMNS =
  "default_policy_mode, require_moderation, allow_anonymous, edit_window_seconds, " +
  "max_depth, max_length, max_links_per_comment, min_submit_seconds, " +
  "rate_limit_per_hour, blocked_terms, turnstile_enabled, notify_on_reply";

function toSettings(row: SettingsRow): CommentSettings {
  return {
    defaultPolicyMode: row.default_policy_mode,
    requireModeration: row.require_moderation,
    allowAnonymous: row.allow_anonymous,
    editWindowSeconds: row.edit_window_seconds,
    maxDepth: row.max_depth,
    maxLength: row.max_length,
    maxLinksPerComment: row.max_links_per_comment,
    minSubmitSeconds: row.min_submit_seconds,
    rateLimitPerHour: row.rate_limit_per_hour,
    blockedTerms: row.blocked_terms ?? [],
    turnstileEnabled: row.turnstile_enabled,
    notifyOnReply: row.notify_on_reply
  };
}

/** Read this tenant's comment config, returning defaults when no row exists yet. */
export async function fetchCommentSettings(
  tx: Bun.SQL,
  tenantId: string
): Promise<CommentSettings> {
  const rows = (await tx`
    SELECT ${tx.unsafe(SETTINGS_COLUMNS)}
    FROM awcms_comments_settings
    WHERE tenant_id = ${tenantId}
  `) as SettingsRow[];

  return rows[0]
    ? toSettings(rows[0])
    : { ...DEFAULT_COMMENT_SETTINGS, blockedTerms: [] };
}

export type CommentSettingsAuditHook = (
  tx: Bun.SQL,
  detail: { previous: CommentSettings; next: CommentSettings }
) => Promise<void>;

/**
 * Upsert this tenant's comment config (full replace of the mutable fields — PUT
 * semantics), then record an audit event. Idempotent at the DB level.
 */
export async function updateCommentSettings(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  next: CommentSettings,
  recordAudit: CommentSettingsAuditHook
): Promise<CommentSettings> {
  const previous = await fetchCommentSettings(tx, tenantId);
  const blockedTermsParam = tx.array(next.blockedTerms, "text");

  const rows = (await tx`
    INSERT INTO awcms_comments_settings
      (tenant_id, default_policy_mode, require_moderation, allow_anonymous,
       edit_window_seconds, max_depth, max_length, max_links_per_comment,
       min_submit_seconds, rate_limit_per_hour, blocked_terms, turnstile_enabled,
       notify_on_reply, created_by, updated_by)
    VALUES (
      ${tenantId}, ${next.defaultPolicyMode}, ${next.requireModeration},
      ${next.allowAnonymous}, ${next.editWindowSeconds}, ${next.maxDepth},
      ${next.maxLength}, ${next.maxLinksPerComment}, ${next.minSubmitSeconds},
      ${next.rateLimitPerHour}, ${blockedTermsParam}, ${next.turnstileEnabled},
      ${next.notifyOnReply}, ${actorTenantUserId}, ${actorTenantUserId}
    )
    ON CONFLICT (tenant_id) DO UPDATE SET
      default_policy_mode = EXCLUDED.default_policy_mode,
      require_moderation = EXCLUDED.require_moderation,
      allow_anonymous = EXCLUDED.allow_anonymous,
      edit_window_seconds = EXCLUDED.edit_window_seconds,
      max_depth = EXCLUDED.max_depth,
      max_length = EXCLUDED.max_length,
      max_links_per_comment = EXCLUDED.max_links_per_comment,
      min_submit_seconds = EXCLUDED.min_submit_seconds,
      rate_limit_per_hour = EXCLUDED.rate_limit_per_hour,
      blocked_terms = EXCLUDED.blocked_terms,
      turnstile_enabled = EXCLUDED.turnstile_enabled,
      notify_on_reply = EXCLUDED.notify_on_reply,
      updated_by = EXCLUDED.updated_by,
      updated_at = now()
    RETURNING ${tx.unsafe(SETTINGS_COLUMNS)}
  `) as SettingsRow[];

  const saved = toSettings(rows[0]!);
  await recordAudit(tx, { previous, next: saved });
  return saved;
}
