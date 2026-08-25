import { enqueueModuleContentPurge } from "../../../lib/edge-cache/content-purge";
import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import { log } from "../../../lib/logging/logger";
import {
  recordAuditEvent,
  recordAuditEvents,
  type AuditEventInput
} from "../../logging/application/audit-log";
import { fetchPostTermIdsForPosts } from "./blog-taxonomy-directory";
import { fetchBlogSettings } from "./blog-settings-directory";
import { evaluateContentQualityChecklistForBatch } from "./content-quality-checklist-gate";
import type { MediaLibraryPort } from "../../_shared/ports/media-library-port";
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
  mediaPort: MediaLibraryPort,
  options: PublishDueScheduledPostsOptions = {},
  socialPublishingPort?: SocialPublishingPort
): Promise<PublishDueScheduledPostsResult> {
  const now = options.now ?? new Date();
  const correlationId = options.correlationId;

  return withTenantOrThrow(
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

      // One query for the whole batch, not one per post. The read side of this
      // relationship was batched long ago (`fetchPostTermIdsForPosts` — "three
      // round trips per page, not fifty-one"); this sweep was still asking per
      // post, which at the batch bound is two hundred round trips on the one
      // reserved `maintenance` connection the job holds for its duration. A
      // post with no assignments is absent from the map, not an error: the
      // checklist's term rule reads the count, and zero IS the count.
      const termIdsByPost = await fetchPostTermIdsForPosts(
        tx,
        tenantId,
        due.map((post) => post.id)
      );

      const checklistItems = due.map((post) => ({
        key: post.id,
        content: {
          title: post.title,
          slug: post.slug,
          excerpt: post.excerpt,
          metaDescription: post.meta_description,
          contentText: post.content_text,
          contentJson: post.content_json,
          featuredMediaId: post.featured_media_id,
          seoImageMediaId: post.seo_image_media_id
        },
        termCount: (termIdsByPost.get(post.id) ?? []).length
      }));

      const evaluateChecklists = (
        items: readonly (typeof checklistItems)[number][]
      ) =>
        evaluateContentQualityChecklistForBatch(
          tx,
          tenantId,
          "post",
          items,
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

      const firstPass = await evaluateChecklists(checklistItems);
      const candidates = checklistItems.filter(
        (item) => firstPass.get(item.key)!.passed
      );

      /**
       * TOCTOU mitigation (security-auditor Medium finding, PR #725): the
       * post rows themselves are protected by the batch's own `FOR UPDATE`
       * lock (above), but the R2 media objects they reference are NOT locked
       * — an editor could detach/invalidate the featured/gallery media
       * between the first evaluation and the `UPDATE` below. Re-evaluating
       * immediately before the write keeps that window at one query round
       * trip. It does not eliminate the race outright (that would need
       * locking the referenced media rows too, a bigger change touching the
       * shared `MediaLibraryPort` every read-only preview endpoint also
       * uses), but closes the realistic exposure at negligible cost.
       *
       * Batching made this window SMALLER, not larger, and that is the whole
       * reason the two passes are still two passes: the second pass re-reads
       * every candidate's media in one statement and the publish follows it
       * immediately, so the gap no longer grows with how far into the batch a
       * post happens to sit. Reusing the first pass's verdicts here would
       * have removed the mitigation entirely while looking like a tidy-up.
       */
      const secondPass = await evaluateChecklists(candidates);

      const publishedPosts: DuePostRow[] = [];
      const blockedPostIds: string[] = [];
      const auditEvents: AuditEventInput[] = [];

      // Iterated in due order (`scheduled_at ASC`, from the SELECT) so the
      // audit trail reads in the same sequence the per-post loop wrote it.
      for (const post of due) {
        const checklist = secondPass.get(post.id) ?? firstPass.get(post.id)!;

        if (!checklist.passed) {
          blockedPostIds.push(post.id);

          auditEvents.push({
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

        publishedPosts.push(post);

        auditEvents.push({
          tenantId,
          moduleKey: "blog_content",
          action: "blog.post.published",
          resourceType: "blog_post",
          resourceId: post.id,
          severity: "info",
          message: `Blog post published by scheduled publish: ${post.slug}.`,
          correlationId
        });
      }

      const publishedPostIds = publishedPosts.map((post) => post.id);

      if (publishedPostIds.length > 0) {
        await tx`
          UPDATE awcms_blog_posts
          SET status = 'published',
              published_at = COALESCE(published_at, ${now}),
              scheduled_at = NULL,
              version = version + 1,
              updated_at = ${now}
          WHERE tenant_id = ${tenantId}
            AND id = ANY(${tx.array(publishedPostIds, "uuid")})
        `;

        // AFTER the write, not while classifying: a log line saying a post
        // published is a claim about a statement that ran. Emitting it during
        // classification would report every candidate as published even when
        // the `UPDATE` below it threw.
        for (const post of publishedPosts) {
          log("info", "blog-content.post.published", {
            correlationId,
            tenantId,
            moduleKey: "blog_content",
            postId: post.id,
            slug: post.slug,
            trigger: "scheduled_publish"
          });
        }

        // ADR-0042: invalidate this tenant's cached blog surfaces in the SAME
        // transaction as the publish, so a rolled-back publish leaves no stray
        // purge and a committed one can never lose its invalidation. No-op when
        // the edge cache is disabled. ONE enqueue for the batch: the scope is
        // the tenant's `blog_content` surfaces, so enqueueing it per post
        // produced identical duplicate rows for the purge worker to collapse.
        await enqueueModuleContentPurge(
          tx,
          tenantId,
          "blog_content",
          "blog.post.published"
        );

        if (socialPublishingPort) {
          // Per article by contract — `onArticlePublished` takes one. Kept
          // after the publish `UPDATE`, as before, so a port that reads the
          // row back sees it published.
          for (const post of publishedPosts) {
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
      }

      // The per-post rows and the run summary in ONE statement, the summary
      // last so the trail reads in the order the sweep decided things.
      auditEvents.push({
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

      await recordAuditEvents(tx, auditEvents);

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

/** Same per-run bound and the same reasoning as `SCHEDULED_PUBLISH_BATCH_LIMIT`. */
export const SCHEDULED_UNPUBLISH_BATCH_LIMIT = 200;

export type UnpublishDuePostsResult = {
  unpublishedCount: number;
  unpublishedPostIds: string[];
  /** `true` when this run filled the batch; the remainder is finished on the next run. */
  partial: boolean;
};

type DueUnpublishRow = {
  id: string;
  slug: string;
};

/**
 * Scheduled UNPUBLISHING (Issue #591) — the other half of `scheduled_at`.
 *
 * A post becomes due when `status = 'published' AND unpublish_at <= now()`, and
 * the transition is to `archived` rather than `draft`. That choice is not
 * cosmetic: `draft` says "unfinished work", and an embargoed article that ran
 * its course is the opposite — it was finished, it was live, and it is now
 * withdrawn. `archived` is also the status every public read path already
 * excludes, so nothing downstream needs a new case.
 *
 * ## Why this lives in the SAME job, not a second cron entry
 *
 * Two job descriptors mean two schedules, and two schedules drift: an operator
 * disables one, or a container ships with only one crontab line, and posts
 * publish forever while nothing ever withdraws them. That failure is invisible
 * — the site looks like it is working. One command doing both sweeps cannot
 * half-run.
 *
 * ## What it deliberately does NOT do
 *
 * No content quality checklist. The publish sweep gates on it because
 * publishing exposes content to readers and the checklist is what stands
 * between a reader and a broken article. Withdrawing content exposes nobody,
 * and a checklist that could BLOCK a withdrawal would hold an expired embargo
 * open on the strength of a missing alt text — the exact inversion of what the
 * gate is for.
 *
 * Idempotent by construction: the `WHERE` matches only `published` rows, so a
 * re-run finds the already-archived post gone from the batch. Nothing is
 * written twice and no audit event is duplicated.
 */
export async function unpublishDuePosts(
  sql: Bun.SQL,
  tenantId: string,
  options: PublishDueScheduledPostsOptions = {}
): Promise<UnpublishDuePostsResult> {
  const now = options.now ?? new Date();
  const correlationId = options.correlationId;

  return withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      const due = (await tx`
        SELECT id, slug
        FROM awcms_blog_posts
        WHERE tenant_id = ${tenantId} AND status = 'published'
          AND unpublish_at IS NOT NULL AND unpublish_at <= ${now}
          AND deleted_at IS NULL
        ORDER BY unpublish_at ASC
        LIMIT ${SCHEDULED_UNPUBLISH_BATCH_LIMIT}
        FOR UPDATE SKIP LOCKED
      `) as DueUnpublishRow[];

      const partial = due.length === SCHEDULED_UNPUBLISH_BATCH_LIMIT;
      const unpublishedPostIds = due.map((post) => post.id);
      const auditEvents: AuditEventInput[] = [];

      if (unpublishedPostIds.length > 0) {
        // One `UPDATE` and one audit `INSERT` for the batch, not two
        // statements per post. Nothing here is per-post CONDITIONAL — every
        // due row is archived, the checklist deliberately does not run (see
        // above) — so the per-post loop was only ever a way of writing the
        // same two statements two hundred times.
        //
        // `unpublish_at` is deliberately LEFT SET rather than nulled the way
        // `scheduled_at` is cleared on publish. The two are not symmetric:
        // `scheduled_at` describes an intent that has been carried out and
        // would re-fire if kept, whereas `unpublish_at` is the RECORD of why
        // this post is archived — clearing it would erase the only trace
        // distinguishing "withdrawn on schedule" from "an editor archived
        // it", and the CHECK keeps it consistent if the post is ever
        // republished with a new window.
        await tx`
          UPDATE awcms_blog_posts
          SET status = 'archived',
              version = version + 1,
              updated_at = ${now}
          WHERE tenant_id = ${tenantId}
            AND id = ANY(${tx.array(unpublishedPostIds, "uuid")})
        `;

        for (const post of due) {
          auditEvents.push({
            tenantId,
            moduleKey: "blog_content",
            action: "blog.post.unpublished",
            resourceType: "blog_post",
            resourceId: post.id,
            // `warning`, not `info`: content LEAVING the public surface
            // without a human in the loop is the kind of event an operator
            // should be able to find when a reader asks where an article went.
            severity: "warning",
            message: `Blog post unpublished by schedule: ${post.slug}.`,
            correlationId
          });

          log("info", "blog-content.post.unpublished", {
            correlationId,
            tenantId,
            moduleKey: "blog_content",
            postId: post.id,
            slug: post.slug,
            trigger: "scheduled_unpublish"
          });
        }

        // ADR-0042 — same transaction as the transition, so a rollback leaves
        // no stray purge and a commit cannot lose its invalidation. This is the
        // half that matters most: a withdrawn article still sitting in the edge
        // cache is the withdrawal not happening.
        await enqueueModuleContentPurge(
          tx,
          tenantId,
          "blog_content",
          "blog.post.unpublished"
        );
      }

      auditEvents.push({
        tenantId,
        moduleKey: "blog_content",
        action: "blog.post.scheduled_unpublish_executed",
        resourceType: "blog_post",
        severity: "info",
        message: `Scheduled unpublish ran: ${unpublishedPostIds.length} post(s) withdrawn.`,
        attributes: { unpublishedCount: unpublishedPostIds.length },
        correlationId
      });

      await recordAuditEvents(tx, auditEvents);

      return {
        unpublishedCount: unpublishedPostIds.length,
        unpublishedPostIds,
        partial
      };
    },
    { workClass: "maintenance" }
  );
}
