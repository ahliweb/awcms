import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import { log } from "../../../../../lib/logging/logger";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import {
  fetchAdById,
  softDeleteAd
} from "../../../../../modules/blog-content/application/ads-directory";
import { validateDeleteReasonInput } from "../../../../../modules/blog-content/domain/content-validation";

const CONFIGURE_GUARD = {
  moduleKey: "blog_content",
  activityCode: "ads",
  action: "configure" as const
};

/**
 * `PATCH /api/v1/blog/ads/{id}` — **retired** (ADR-0044 §4 Fase 2, step three),
 * for the same reason as `POST` on the collection: see that handler's comment.
 *
 * Closing `POST` alone would not have been enough. This endpoint could rewrite
 * `imageUrl` on an existing ad, so it was a second, quieter route to the same
 * free-URL bypass — and one that produces no new row for anyone to notice.
 */
export const PATCH: APIRoute = async () =>
  fail(
    410,
    "ENDPOINT_RETIRED",
    "Free-URL advertisements are retired (ADR-0044). Upload the image through the media library, then manage the advertisement via PATCH /api/v1/news-portal/ad-placements/{id}, which requires a verified media object instead of an arbitrary URL."
  );

/** `DELETE /api/v1/blog/ads/{id}` (Issue #542) — soft-delete. `reason` required. */
export const DELETE: APIRoute = async ({
  request,
  params,
  cookies,
  locals
}) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const id = params.id;

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!id) {
    return fail(400, "VALIDATION_ERROR", "Ad id is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const bodyRead = await readJsonBody(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const validation = validateDeleteReasonInput(bodyRead.value);

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "reason is required.",
      {},
      validation.errors
    );
  }

  const { reason } = validation.value;
  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const correlationId = locals.correlationId;

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(
      tx,
      tenantId,
      tokenHash,
      now,
      CONFIGURE_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    const existing = await fetchAdById(tx, tenantId, id);

    if (!existing) {
      return fail(404, "RESOURCE_NOT_FOUND", "Ad not found.");
    }

    await softDeleteAd(tx, tenantId, auth.context.tenantUserId, id, reason);

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "blog_content",
      action: "blog.ad.deleted",
      resourceType: "blog_ad",
      resourceId: id,
      severity: "warning",
      message: "Blog ad deleted.",
      attributes: { reason },
      correlationId
    });

    log("info", "blog-content.ad.deleted", {
      correlationId,
      tenantId,
      moduleKey: "blog_content",
      adId: id
    });

    return ok({ id, deleted: true });
  });
};
