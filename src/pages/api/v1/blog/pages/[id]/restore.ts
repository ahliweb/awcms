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
  restoreBlogPage
} from "../../../../../../modules/blog-content/application/blog-page-directory";
import { canRestorePage } from "../../../../../../modules/blog-content/domain/page-status";

/**
 * `POST /api/v1/blog/pages/{id}/restore` (ADR-0057 §A).
 *
 * This undoes SOFT DELETE, not archiving — the two are different axes on a
 * page, exactly as on a post. `deleted_at` says the row is in the bin;
 * `status` says where in the lifecycle it sits. Restoring returns the row from
 * the bin and leaves its status untouched, so a page soft-deleted while
 * published comes back published. To bring an ARCHIVED page back, publish it.
 *
 * The lookup passes `includeDeleted: true` for a reason the default hides: the
 * default read filters `deleted_at IS NULL`, so without it every restore
 * target would answer 404 — the row it is looking for is by definition deleted.
 *
 * High-risk mutation: `Idempotency-Key` required.
 */
const IDEMPOTENCY_SCOPE = "blog_page_restore";

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
    action: "restore"
  },
  handler: async ({ tx, auth, prepared, params, tenantId, locals }) => {
    const pageId = params.id;

    if (!pageId) {
      return fail(400, "VALIDATION_ERROR", "Page id is required.");
    }

    const correlationId = locals.correlationId;
    const requestHash = computeRequestHash({ pageId, action: "restore" });

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

    // One shape for "no such page" and "that page is not deleted". A
    // distinguishable answer would let a caller probe which ids exist by
    // watching restore fail differently.
    if (!page || !canRestorePage(page.deletedAt)) {
      return fail(
        404,
        "RESOURCE_NOT_FOUND",
        "Blog page not found, or is not soft-deleted."
      );
    }

    const restored = await restoreBlogPage(
      tx,
      tenantId,
      auth.context.tenantUserId,
      pageId
    );

    if (!restored) {
      return fail(
        404,
        "RESOURCE_NOT_FOUND",
        "Blog page not found, or is not soft-deleted."
      );
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "blog_content",
      action: "blog.page.restored",
      resourceType: "blog_page",
      resourceId: pageId,
      severity: "info",
      message: `Blog page restored: ${restored.slug}.`,
      correlationId
    });

    log("info", "blog-content.page.restored", {
      correlationId,
      tenantId,
      moduleKey: "blog_content",
      pageId,
      slug: restored.slug
    });

    // ADR-0042 — a restore can put a page back under a slug the edge is still
    // holding a 404 for.
    await enqueueModuleContentPurge(
      tx,
      tenantId,
      "blog_content",
      "blog.page.restored"
    );

    const response = ok(restored);
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
