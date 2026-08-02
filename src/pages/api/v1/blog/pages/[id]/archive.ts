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

/**
 * `POST /api/v1/blog/pages/{id}/archive` (ADR-0057 §A).
 *
 * Archiving removes the page from the public site without destroying it, and
 * is reversible in both directions the page lifecycle allows: back to `draft`,
 * or on to purge — archive is in fact the only route to purge for a page that
 * was never soft-deleted (`canPurgePage` accepts archived OR soft-deleted).
 *
 * `published_at` is NOT cleared by the transition. An archived page later
 * returned to draft and re-published keeps the date it first went live, which
 * is what the public search filter and the SEO facts adapter read.
 *
 * No content quality checklist here, unlike publish: the checklist guards what
 * becomes PUBLIC, and this is the transition away from public. Gating it would
 * mean a page that fails the checklist cannot be taken down.
 *
 * High-risk mutation: `Idempotency-Key` required.
 */
const IDEMPOTENCY_SCOPE = "blog_page_archive";

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
    action: "archive"
  },
  handler: async ({ tx, auth, prepared, params, tenantId, locals }) => {
    const pageId = params.id;

    if (!pageId) {
      return fail(400, "VALIDATION_ERROR", "Page id is required.");
    }

    const correlationId = locals.correlationId;
    const requestHash = computeRequestHash({ pageId, action: "archive" });

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

    if (!isValidPageStatusTransition(page.status, "archived")) {
      return fail(
        409,
        "INVALID_STATUS_TRANSITION",
        `Cannot archive a page in status "${page.status}".`
      );
    }

    const updated = await transitionBlogPageStatus(
      tx,
      tenantId,
      pageId,
      "archived"
    );

    if (!updated) {
      return fail(404, "RESOURCE_NOT_FOUND", "Blog page not found.");
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "blog_content",
      action: "blog.page.archived",
      resourceType: "blog_page",
      resourceId: pageId,
      severity: "info",
      message: `Blog page archived: ${updated.slug}.`,
      correlationId
    });

    log("info", "blog-content.page.archived", {
      correlationId,
      tenantId,
      moduleKey: "blog_content",
      pageId,
      slug: updated.slug
    });

    const response = ok(updated);
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
