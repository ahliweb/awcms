/**
 * Comment retention / anonymization sweep (ADR-0041, ported from awcms-micro
 * Issue #271). Runs as the
 * least-privilege worker role (`bun run comments:retention`). Two bounded passes
 * per tenant:
 *
 *   1. `anonymizeAgedComments` — for comments older than the retention cutoff,
 *      NULLs the author identity fields (display name, email hash/mask, ip/ua
 *      hash, fingerprint) while RETAINING the row + body + moderation history —
 *      soft-privacy minimization, not deletion (append-only history stays
 *      coherent), and APPENDS an `anonymize` moderation event per affected comment
 *      so the history records why the identity fields went blank. SKIPPED
 *      entirely for a tenant whose comment content descriptor is under an
 *      active legal hold (legal hold overrides retention, ADR-0037).
 *   2. `purgeUnconfirmedReplySubscriptions` — deletes double-opt-in subscriptions
 *      never confirmed within the confirmation window (they can never be used to
 *      notify, so retaining a recipient reference serves no purpose).
 *
 * The `abuse_events` and confirmed-but-stale `reply_subscriptions` age-based
 * purge is handled by the `data_lifecycle` generic engine via the descriptors in
 * `module.ts` — this job owns only the anonymization + unconfirmed cleanup that
 * the generic engine cannot express.
 */
import type { LegalHoldGuardPort } from "../../_shared/ports/legal-hold-guard-port";
import { COMMENTS_CONTENT_LIFECYCLE_KEY } from "../module";

export const COMMENTS_DEFAULT_ANONYMIZE_DAYS = 365;

/**
 * The one place a retention cutoff is computed here, shared by the real sweeps
 * and by `--dry-run`'s preview, so a preview cannot drift from what a real run
 * treats as past retention (same reason `logging`'s
 * `resolveAuditRetentionCutoff` exists).
 */
export function resolveCommentsRetentionCutoff(
  now: Date,
  retentionDays: number
): Date {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}
export const COMMENTS_UNCONFIRMED_SUBSCRIPTION_DAYS = 7;

export type AnonymizeResult = {
  anonymizedCount: number;
  skippedForLegalHold: boolean;
  cutoff: Date;
};

/** Anonymize author identity on comments older than the cutoff (honor legal hold). */
export async function anonymizeAgedComments(
  tx: Bun.SQL,
  tenantId: string,
  legalHoldGuard: LegalHoldGuardPort,
  options: { retentionDays: number; now?: Date; batchLimit?: number }
): Promise<AnonymizeResult> {
  const now = options.now ?? new Date();
  const cutoff = resolveCommentsRetentionCutoff(now, options.retentionDays);

  const held = await legalHoldGuard.isDescriptorHeld(
    tx,
    tenantId,
    COMMENTS_CONTENT_LIFECYCLE_KEY
  );
  if (held) {
    return { anonymizedCount: 0, skippedForLegalHold: true, cutoff };
  }

  const batchLimit = Math.min(Math.max(1, options.batchLimit ?? 1000), 5000);
  const rows = (await tx`
    WITH candidates AS (
      SELECT id FROM awcms_comments_comments
      WHERE tenant_id = ${tenantId}
        AND created_at < ${cutoff}
        AND (author_email_hash IS NOT NULL
             OR author_ip_hash IS NOT NULL
             OR author_display_name IS NOT NULL)
      ORDER BY created_at
      LIMIT ${batchLimit}
    )
    UPDATE awcms_comments_comments c
    SET author_display_name = NULL,
        author_email_hash = NULL,
        author_email_masked = NULL,
        author_ip_hash = NULL,
        user_agent_hash = NULL,
        content_fingerprint = NULL,
        updated_at = now()
    FROM candidates
    WHERE c.id = candidates.id AND c.tenant_id = ${tenantId}
    RETURNING c.id
  `) as { id: string }[];

  // Append-only provenance for the anonymization. Without it, a reader of the
  // moderation history sees identity fields that are simply blank, with nothing
  // distinguishing "never supplied" from "erased by retention". The `anonymize`
  // action exists in the sql/066 CHECK for exactly this row, and it is why the
  // worker holds INSERT on this table in `WORKER_ROLE_GRANTS`.
  if (rows.length > 0) {
    const anonymizedIds = rows.map((row) => row.id);
    await tx`
      INSERT INTO awcms_comments_moderation_events
        (tenant_id, comment_id, action, actor_kind, note)
      SELECT ${tenantId}, unnest(${tx.array(anonymizedIds, "uuid")}::uuid[]),
             'anonymize', 'system', 'Author identity anonymized by the retention sweep'
    `;
  }

  return {
    anonymizedCount: rows.length,
    skippedForLegalHold: false,
    cutoff
  };
}

export type PurgeSubscriptionsResult = { purgedCount: number; cutoff: Date };

/** Delete unconfirmed reply subscriptions older than the confirmation window. */
export async function purgeUnconfirmedReplySubscriptions(
  tx: Bun.SQL,
  tenantId: string,
  options: { unconfirmedDays?: number; now?: Date; batchLimit?: number } = {}
): Promise<PurgeSubscriptionsResult> {
  const now = options.now ?? new Date();
  const days =
    options.unconfirmedDays ?? COMMENTS_UNCONFIRMED_SUBSCRIPTION_DAYS;
  const cutoff = resolveCommentsRetentionCutoff(now, days);
  const batchLimit = Math.min(Math.max(1, options.batchLimit ?? 1000), 5000);

  const rows = (await tx`
    WITH candidates AS (
      SELECT id FROM awcms_comments_reply_subscriptions
      WHERE tenant_id = ${tenantId}
        AND confirmed = false
        AND created_at < ${cutoff}
      ORDER BY created_at
      LIMIT ${batchLimit}
    )
    DELETE FROM awcms_comments_reply_subscriptions s
    USING candidates
    WHERE s.id = candidates.id AND s.tenant_id = ${tenantId}
    RETURNING s.id
  `) as { id: string }[];

  return { purgedCount: rows.length, cutoff };
}

export type CommentsRetentionPreview = {
  wouldAnonymize: number;
  skippedForLegalHold: boolean;
  wouldPurgeSubscriptions: number;
  anonymizeCutoff: Date;
  subscriptionCutoff: Date;
};

/**
 * Read-only preview for `--dry-run`. Counts what each pass would touch and
 * changes nothing — no UPDATE, no DELETE, and no `anonymize` moderation event.
 *
 * Asks the SAME legal-hold guard the real sweep asks, and reports the answer:
 * a held descriptor makes a real run anonymize nothing, so a preview that
 * ignored the hold would report a backlog no run would ever act on. Unbounded
 * by `batchLimit` on purpose — an operator wants the backlog, not one batch.
 */
export async function previewCommentsRetention(
  tx: Bun.SQL,
  tenantId: string,
  legalHoldGuard: LegalHoldGuardPort,
  options: { retentionDays: number; unconfirmedDays?: number; now?: Date }
): Promise<CommentsRetentionPreview> {
  const now = options.now ?? new Date();
  const anonymizeCutoff = resolveCommentsRetentionCutoff(
    now,
    options.retentionDays
  );
  const subscriptionCutoff = resolveCommentsRetentionCutoff(
    now,
    options.unconfirmedDays ?? COMMENTS_UNCONFIRMED_SUBSCRIPTION_DAYS
  );

  const held = await legalHoldGuard.isDescriptorHeld(
    tx,
    tenantId,
    COMMENTS_CONTENT_LIFECYCLE_KEY
  );

  const anonymizeRows = held
    ? [{ count: 0 }]
    : ((await tx`
        SELECT count(*)::int AS count
        FROM awcms_comments_comments
        WHERE tenant_id = ${tenantId}
          AND created_at < ${anonymizeCutoff}
          AND (author_email_hash IS NOT NULL
               OR author_ip_hash IS NOT NULL
               OR author_display_name IS NOT NULL)
      `) as { count: number }[]);

  const subscriptionRows = (await tx`
    SELECT count(*)::int AS count
    FROM awcms_comments_reply_subscriptions
    WHERE tenant_id = ${tenantId}
      AND confirmed = false
      AND created_at < ${subscriptionCutoff}
  `) as { count: number }[];

  return {
    wouldAnonymize: anonymizeRows[0]?.count ?? 0,
    skippedForLegalHold: held,
    wouldPurgeSubscriptions: subscriptionRows[0]?.count ?? 0,
    anonymizeCutoff,
    subscriptionCutoff
  };
}
