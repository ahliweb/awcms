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
  purgeBlogPage
} from "../../../../../../modules/blog-content/application/blog-page-directory";
import { canPurgePage } from "../../../../../../modules/blog-content/domain/page-status";

/**
 * `POST /api/v1/blog/pages/{id}/purge` (ADR-0057 §A/§C). Irreversible hard
 * delete, `409 PURGE_NOT_ALLOWED` unless the page is archived or already
 * soft-deleted (`canPurgePage`, the same precondition posts use).
 *
 * ADR-0057 §C — ad placements that target this page neither block the purge
 * nor are deleted with it. The first draft of that ADR made this a 409, and
 * reading `ad-placement-reference-validation.ts` refuted it: that module has
 * already decided a target deleted later "is not an error and never becomes
 * one", and `listActiveAdPlacementsForRendering` matches `target_id` against
 * the page BEING RENDERED — a purged page is never rendered, so its placements
 * are never matched. They go inert, precisely as they already do for a
 * soft-deleted page, so purge introduces no failure mode that soft delete has
 * not carried unremarked all along.
 *
 * What it does instead is REPORT: `adPlacementsNowInert`, in the response body
 * and on the audit event. A slot that quietly stops filling three weeks later,
 * with nothing connecting it to a page someone purged, is the "vanishes with no
 * record" ADR-0044 §4 refuses.
 *
 * High-risk mutation: `Idempotency-Key` required. Audited at `critical`.
 */
const IDEMPOTENCY_SCOPE = "blog_page_purge";

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
    action: "purge"
  },
  handler: async ({ tx, auth, prepared, params, tenantId, locals }) => {
    const pageId = params.id;

    if (!pageId) {
      return fail(400, "VALIDATION_ERROR", "Page id is required.");
    }

    const correlationId = locals.correlationId;
    const requestHash = computeRequestHash({ pageId, action: "purge" });

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

    const page = await fetchBlogPageById(tx, tenantId, pageId, {
      includeDeleted: true
    });

    if (!page) {
      return fail(404, "RESOURCE_NOT_FOUND", "Blog page not found.");
    }

    if (!canPurgePage(page.status, page.deletedAt)) {
      return fail(
        409,
        "PURGE_NOT_ALLOWED",
        "Page must be archived or soft-deleted before it can be purged."
      );
    }

    const result = await purgeBlogPage(tx, tenantId, pageId);

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "blog_content",
      action: "blog.page.purged",
      resourceType: "blog_page",
      resourceId: pageId,
      severity: "critical",
      message: "Blog page purged.",
      attributes: { adPlacementsNowInert: result.adPlacementsNowInert },
      correlationId
    });

    log("info", "blog-content.page.purged", {
      correlationId,
      tenantId,
      moduleKey: "blog_content",
      pageId,
      adPlacementsNowInert: result.adPlacementsNowInert
    });

    // ADR-0042 — the row is gone for good; an edge object outliving it would be
    // the only copy left, which is the opposite of what a purge is for.
    await enqueueModuleContentPurge(
      tx,
      tenantId,
      "blog_content",
      "blog.page.purged"
    );

    const response = ok({
      id: pageId,
      status: "purged",
      adPlacementsNowInert: result.adPlacementsNowInert
    });
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
