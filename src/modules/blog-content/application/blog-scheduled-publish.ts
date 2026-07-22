import { withTenant } from "../../../lib/database/tenant-context";
import { log } from "../../../lib/logging/logger";
import { recordAuditEvent } from "../../logging/application/audit-log";
import { fetchPostTermIds } from "./blog-taxonomy-directory";
import { fetchBlogSettings } from "./blog-settings-directory";
import { evaluateContentQualityChecklistForContent } from "./content-quality-checklist-gate";
import type { NewsMediaPort } from "../../_shared/ports/news-media-port";
import type { SocialPublishingPort } from "../../_shared/ports/social-publishing-port";

/**
 * Scheduled publishing (Issue #541, doc issue #541 §Scheduled Publishing
 * Rules). A post becomes due when `status = 'scheduled' AND scheduled_at <=
 * now()` — the same `awcms_blog_posts` predicate every other lifecycle
 * transition in this module already checks (`isValidStatusTransition`
 * governs the *legality* of scheduled -> published; this job is the thing
 * that actually performs it once due, since there is no external
 * cron/provider integration in scope for #541).
 *
 * Issue #640 restructured this from a single set-based `UPDATE` into a
 * per-post loop: the content quality checklist must gate this transition
 * too, not just the interactive `POST .../publish`/`.../schedule` endpoints
 * — otherwise a tenant could bypass the checklist entirely by scheduling a
 * post BEFORE the tenant applied full-online R2-only mode (or before an
 * editor fixed a since-flagged problem) and simply waiting for it to become
 * due, the exact class of gap Issue #636's "restore revision" bypass
 * already taught this epic to close for every new write/transition path.
 * A post whose checklist fails at due-time is left `scheduled` (not
 * silently published, not silently un-scheduled) and reported via a
 * dedicated audit event — an operator/editor can inspect and fix it, then
 * either re-schedule or publish manually once ready. Still idempotent: a
 * post already `published`, still in the future, or left `scheduled` due to
 * a prior blocked attempt simply doesn't match the `WHERE`/isn't re-blocked
 * twice in a way that changes anything on a re-run. `mediaPort` is supplied
 * by the caller (`scripts/blog-scheduled-publish.ts`, the composition root,
 * per ADR-0011) — this file itself never imports `news_portal`.
 *
 * Issue #643 (epic `social_publishing`): `socialPublishingPort`, when
 * supplied by the caller, is invoked right after each individual post
 * publish succeeds — `SocialPublishingPort.onArticlePublished(...)` with
 * `trigger: "scheduled_published"`. Plain DB outbox-row writes inside the
 * SAME transaction as the publish `UPDATE` above (ADR-0006 compliant — no
 * external provider call happens here); optional and defaults to a no-op
 * so a deployment that never wires a social-publishing port (the default;
 * see `social-publishing/domain/social-publishing-config.ts`) behaves
 * exactly as before this issue.
 */
/**
 * Per-run safety bound for the due-post selection (Issue #835 §6). The
 * previous query took `FOR UPDATE` on EVERY matching row with no `LIMIT`,
 * so a large backlog (job paused, a bulk campaign) locked and loaded the
 * whole set into one transaction and, worse, made a second concurrent runner
 * BLOCK on those locks. This bound + `FOR UPDATE SKIP LOCKED` (below) caps
 * the work/locks per run and lets a concurrent runner pick up a disjoint
 * batch instead of waiting. A backlog larger than this is finished on
 * subsequent scheduled runs (the job is periodic and idempotent) — reported
 * via `result.partial`, the same "partial this run, remainder next run"
 * convention `audit-log-purge.ts`/news-media reconciliation already use.
 * Ordered `scheduled_at ASC` so the longest-overdue posts publish first.
 */
export const SCHEDULED_PUBLISH_BATCH_LIMIT = 200;

export type PublishDueScheduledPostsOptions = {
  now?: Date;
  correlationId?: string;
};

export type PublishDueScheduledPostsResult = {
  publishedCount: number;
  publishedPostIds: string[];
  blockedCount: number;
  blockedPostIds: string[];
  /**
   * `true` when this run selected a full `SCHEDULED_PUBLISH_BATCH_LIMIT`
   * batch, i.e. there may be more due posts a later run will pick up. Callers
   * that must drain the whole backlog immediately can loop until this is
   * `false`; the periodic worker (`scripts/blog-scheduled-publish.ts`) does
   * not need to, since it runs again on a schedule.
   */
  partial: boolean;
};

type DuePostRow = {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  content_json: Record<string, unknown>;
  content_text: string;
  featured_media_id: string | null;
  seo_image_media_id: string | null;
  meta_description: string | null;
};

export async function publishDueScheduledPosts(
  sql: Bun.SQL,
  tenantId: string,
  mediaPort: NewsMediaPort,
  options: PublishDueScheduledPostsOptions = {},
  socialPublishingPort?: SocialPublishingPort
): Promise<PublishDueScheduledPostsResult> {
  const now = options.now ?? new Date();
  const correlationId = options.correlationId;

  return withTenant(
    sql,
    tenantId,
    async (tx) => {
      const due = (await tx`
        SELECT id, slug, title, excerpt, content_json, content_text,
               featured_media_id, seo_image_media_id, meta_description
        FROM awcms_blog_posts
        WHERE tenant_id = ${tenantId} AND status = 'scheduled'
          AND scheduled_at IS NOT NULL AND scheduled_at <= ${now}
          AND deleted_at IS NULL
        ORDER BY scheduled_at ASC
        LIMIT ${SCHEDULED_PUBLISH_BATCH_LIMIT}
        FOR UPDATE SKIP LOCKED
      `) as DuePostRow[];

      const partial = due.length === SCHEDULED_PUBLISH_BATCH_LIMIT;

      if (due.length === 0) {
        await recordAuditEvent(tx, {
          tenantId,
          moduleKey: "blog_content",
          action: "blog.post.scheduled_publish_skipped",
          resourceType: "blog_post",
          severity: "info",
          message: "Scheduled publish ran: no due posts.",
          correlationId
        });

        return {
          publishedCount: 0,
          publishedPostIds: [],
          blockedCount: 0,
          blockedPostIds: [],
          partial: false
        };
      }

      const blogSettings = await fetchBlogSettings(tx, tenantId);
      const publishedPostIds: string[] = [];
      const blockedPostIds: string[] = [];

      for (const post of due) {
        const termIds = await fetchPostTermIds(tx, tenantId, post.id);
        const evaluateChecklist = () =>
          evaluateContentQualityChecklistForContent(
            tx,
            tenantId,
            "post",
            {
              title: post.title,
              slug: post.slug,
              excerpt: post.excerpt,
              metaDescription: post.meta_description,
              contentText: post.content_text,
              contentJson: post.content_json,
              featuredMediaId: post.featured_media_id,
              seoImageMediaId: post.seo_image_media_id
            },
            termIds.length,
            mediaPort,
            blogSettings.contentQualityChecklistPolicy,
            {
              socialPreviewFallback: {
                tenantFallbackImageMediaId:
                  blogSettings.socialPreviewFallbackImageMediaId,
                contentImageFallbackEnabled:
                  blogSettings.socialPreviewContentImageFallbackEnabled
              }
            }
          );

        let checklist = await evaluateChecklist();

        /**
         * TOCTOU mitigation (security-auditor Medium finding, PR #725): the
         * post row itself is protected by the batch's own `FOR UPDATE` lock
         * (above), but the R2 media objects it references are NOT locked —
         * an editor could detach/invalidate the featured/gallery media
         * between this first evaluation and the `UPDATE` below, especially
         * for a large due-batch where earlier posts' evaluations/updates
         * push that gap out further. Re-running the evaluation immediately
         * before the `UPDATE` shrinks that window from "the rest of this
         * tenant's whole batch" down to one query round-trip — it doesn't
         * eliminate the race outright (that would need locking the
         * referenced media rows too, a bigger change touching the shared
         * `NewsMediaPort` every read-only preview endpoint also uses), but
         * closes the realistic exposure at negligible cost.
         */
        if (checklist.passed) {
          checklist = await evaluateChecklist();
        }

        if (!checklist.passed) {
          blockedPostIds.push(post.id);

          await recordAuditEvent(tx, {
            tenantId,
            moduleKey: "blog_content",
            action: "blog.post.scheduled_publish_blocked",
            resourceType: "blog_post",
            resourceId: post.id,
            severity: "warning",
            message: `Scheduled publish blocked by content quality checklist: ${post.slug}.`,
            attributes: {
              blockedRuleIds: checklist.blockers.map(
                (blocker) => blocker.ruleId
              )
            },
            correlationId
          });

          log("warning", "blog-content.post.scheduled_publish_blocked", {
            correlationId,
            tenantId,
            moduleKey: "blog_content",
            postId: post.id,
            slug: post.slug
          });

          continue;
        }

        await tx`
          UPDATE awcms_blog_posts
          SET status = 'published',
              published_at = COALESCE(published_at, ${now}),
              scheduled_at = NULL,
              version = version + 1,
              updated_at = ${now}
          WHERE tenant_id = ${tenantId} AND id = ${post.id}
        `;

        publishedPostIds.push(post.id);

        await recordAuditEvent(tx, {
          tenantId,
          moduleKey: "blog_content",
          action: "blog.post.published",
          resourceType: "blog_post",
          resourceId: post.id,
          severity: "info",
          message: `Blog post published by scheduled publish: ${post.slug}.`,
          correlationId
        });

        log("info", "blog-content.post.published", {
          correlationId,
          tenantId,
          moduleKey: "blog_content",
          postId: post.id,
          slug: post.slug,
          trigger: "scheduled_publish"
        });

        if (socialPublishingPort) {
          await socialPublishingPort.onArticlePublished(
            tx,
            tenantId,
            {
              articleId: post.id,
              title: post.title,
              slug: post.slug,
              excerpt: post.excerpt,
              featuredMediaId: post.featured_media_id,
              trigger: "scheduled_published"
            },
            correlationId
          );
        }
      }

      await recordAuditEvent(tx, {
        tenantId,
        moduleKey: "blog_content",
        action: "blog.post.scheduled_publish_executed",
        resourceType: "blog_post",
        severity: "info",
        message: `Scheduled publish ran: ${publishedPostIds.length} post(s) published, ${blockedPostIds.length} blocked.`,
        attributes: {
          publishedCount: publishedPostIds.length,
          blockedCount: blockedPostIds.length
        },
        correlationId
      });

      return {
        publishedCount: publishedPostIds.length,
        publishedPostIds,
        blockedCount: blockedPostIds.length,
        blockedPostIds,
        partial
      };
    },
    { workClass: "maintenance" }
  );
}
