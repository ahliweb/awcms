import { enqueueModuleContentPurge } from "../../../../../../lib/edge-cache/content-purge";
import {
  fail,
  jsonResponse,
  ok
} from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../../../modules/_shared/idempotency";
import { log } from "../../../../../../lib/logging/logger";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";
import {
  fetchBlogPageById,
  transitionBlogPageStatus
} from "../../../../../../modules/blog-content/application/blog-page-directory";
import { isValidPageStatusTransition } from "../../../../../../modules/blog-content/domain/page-status";
import { fetchBlogSettings } from "../../../../../../modules/blog-content/application/blog-settings-directory";
import {
  checklistBlockersToErrorDetails,
  evaluateContentQualityChecklistForContent
} from "../../../../../../modules/blog-content/application/content-quality-checklist-gate";
import { mediaLibraryPortAdapter } from "../../../../../../modules/media-library/application/media-library-port-adapter";

/**
 * `POST /api/v1/blog/pages/{id}/publish` (ADR-0057 §A).
 *
 * `pages.publish` has been seeded since `sql/036` and gated by nothing, and the
 * consequence was not a spare permission: `createBlogPage` writes a literal
 * `'draft'` and `updateBlogPage` never touches `status`, so until this route
 * existed **no code path could publish a page at all**. This is the one that
 * makes `awcms_blog_pages.status` reachable.
 *
 * Deliberately NOT a copy of `posts/{id}/publish.ts`, in three ways:
 *
 * - the transition table is the page one (`isValidPageStatusTransition`) — a
 *   page has no `review` or `scheduled` state to come from;
 * - `termIds` is the constant `0`, not a lookup. Pages have no taxonomy
 *   assignment table, which is why `taxonomy_exists` is always reported
 *   non-applicable for them — the same constant
 *   `pages/{id}/quality-checklist.ts` already passes;
 * - no social-publishing port call. That port's trigger is `post_published`,
 *   and a page is not an article; inventing a page trigger would write a
 *   contract into a no-op adapter that the real module has never agreed to.
 *
 * The content quality checklist runs BEFORE the transition, server-side, the
 * same gate posts use. `pages/{id}/quality-checklist.ts` has been reporting
 * that checklist as preview-only, its header explaining that "nothing currently
 * blocks a page transition server-side because no such transition exists to
 * gate". That sentence stops being true here.
 *
 * High-risk mutation: `Idempotency-Key` required.
 */
const IDEMPOTENCY_SCOPE = "blog_page_publish";

type Prepared = { idempotencyKey: string };

export const POST = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: ({ request }) => {
    const idempotencyKey = request.headers.get("idempotency-key");

    if (!idempotencyKey) {
      return fail(
        400,
        "IDEMPOTENCY_REQUIRED",
        "Idempotency-Key header is required."
      );
    }

    return { idempotencyKey };
  },
  authorize: {
    moduleKey: "blog_content",
    activityCode: "pages",
    action: "publish"
  },
  handler: async ({ tx, auth, prepared, params, tenantId, locals }) => {
    const pageId = params.id;

    if (!pageId) {
      return fail(400, "VALIDATION_ERROR", "Page id is required.");
    }

    const correlationId = locals.correlationId;
    const requestHash = computeRequestHash({ pageId, action: "publish" });

    const existing = await findIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey
    );

    if (existing) {
      if (existing.requestHash !== requestHash) {
        return fail(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Idempotency-Key was already used with a different request."
        );
      }
      return jsonResponse(existing.responseBody, {
        status: existing.responseStatus
      });
    }

    const page = await fetchBlogPageById(tx, tenantId, pageId);

    if (!page) {
      return fail(404, "RESOURCE_NOT_FOUND", "Blog page not found.");
    }

    if (!isValidPageStatusTransition(page.status, "published")) {
      return fail(
        409,
        "INVALID_STATUS_TRANSITION",
        `Cannot publish a page in status "${page.status}".`
      );
    }

    const blogSettings = await fetchBlogSettings(tx, tenantId);
    const checklist = await evaluateContentQualityChecklistForContent(
      tx,
      tenantId,
      "page",
      page,
      0,
      mediaLibraryPortAdapter,
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

    if (!checklist.passed) {
      await recordAuditEvent(tx, {
        tenantId,
        actorTenantUserId: auth.context.tenantUserId,
        moduleKey: "blog_content",
        action: "blog.page.publish_blocked_by_checklist",
        resourceType: "blog_page",
        resourceId: pageId,
        severity: "warning",
        message: `Blog page publish blocked by content quality checklist: ${page.slug}.`,
        attributes: {
          blockedRuleIds: checklist.blockers.map((blocker) => blocker.ruleId)
        },
        correlationId
      });

      return fail(
        422,
        "CONTENT_QUALITY_CHECKLIST_BLOCKED",
        "Publish is blocked by the content quality checklist.",
        {},
        checklistBlockersToErrorDetails(checklist)
      );
    }

    const updated = await transitionBlogPageStatus(
      tx,
      tenantId,
      pageId,
      "published"
    );

    if (!updated) {
      return fail(404, "RESOURCE_NOT_FOUND", "Blog page not found.");
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "blog_content",
      action: "blog.page.published",
      resourceType: "blog_page",
      resourceId: pageId,
      severity: "info",
      message: `Blog page published: ${updated.slug}.`,
      correlationId
    });

    log("info", "blog-content.page.published", {
      correlationId,
      tenantId,
      moduleKey: "blog_content",
      pageId,
      slug: updated.slug
    });

    // ADR-0042 — the transition that makes this page reachable is the one a
    // stale cache would hide, so the purge belongs here and not only on the
    // PATCH path. Same transaction, no-op when the cache is off.
    await enqueueModuleContentPurge(
      tx,
      tenantId,
      "blog_content",
      "blog.page.published"
    );

    const response = ok({ ...updated, qualityChecklist: checklist });
    const body = await response.clone().json();

    await saveIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey,
      requestHash,
      200,
      body
    );

    return response;
  }
});
