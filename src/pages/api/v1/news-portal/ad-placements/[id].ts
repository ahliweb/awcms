import { enqueueModuleContentPurge } from "../../../../../lib/edge-cache/content-purge";
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
import {
  fetchAdPlacementById,
  softDeleteAdPlacement,
  updateAdPlacement
} from "../../../../../modules/blog-content/application/ad-placement-directory";
import {
  validateAdPlacementMediaReference,
  validateAdPlacementTargetReference
} from "../../../../../modules/blog-content/application/ad-placement-reference-validation";
import { validateUpdateAdPlacementInput } from "../../../../../modules/blog-content/domain/ad-placement-policy";
import { validateDeleteReasonInput } from "../../../../../modules/blog-content/domain/content-validation";

const CONFIGURE_GUARD = {
  moduleKey: "blog_content",
  activityCode: "ad_placements",
  action: "configure" as const
};

/** `PATCH /api/v1/news-portal/ad-placements/{id}` (Issue #638) — partial update. `placementKey` may be changed (every placement preset shares the same row shape — see `ad-placement-policy.ts`'s header comment for why this is NOT immutable like `homepage-section-policy.ts`'s `sectionType`). When `mediaObjectId` (or a `placementKey` change) is present, the media reference is re-validated against the (possibly new) target placement's allowed mime types. */
export const PATCH: APIRoute = async ({ request, params, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const id = params.id;

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!id) {
    return fail(400, "VALIDATION_ERROR", "Ad placement id is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const bodyRead = await readJsonBody<Record<string, unknown>>(
    request,
    "default"
  );

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const body = bodyRead.value;
  const validation = validateUpdateAdPlacementInput(body);

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Ad placement update is invalid.",
      {},
      validation.errors
    );
  }

  const input = validation.value;
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

    const existing = await fetchAdPlacementById(tx, tenantId, id);

    if (!existing) {
      return fail(404, "RESOURCE_NOT_FOUND", "Ad placement not found.");
    }

    if (input.mediaObjectId !== undefined || input.placementKey !== undefined) {
      const referenceValidation = await validateAdPlacementMediaReference(
        tx,
        tenantId,
        input.mediaObjectId ?? existing.mediaObjectId,
        input.placementKey ?? existing.placementKey
      );

      if (!referenceValidation.valid) {
        return fail(
          422,
          "AD_PLACEMENT_REFERENCE_INVALID",
          "Ad placement references an invalid or inaccessible media object.",
          {},
          referenceValidation.errors
        );
      }
    }

    // Only when the patch actually moves the target. The domain validator
    // guarantees `targetType` and `targetId` arrive together, so this needs no
    // fallback to the stored row the way the media check above does — an
    // untouched target was already validated when it was written.
    if (input.targetType !== undefined) {
      const targetValidation = await validateAdPlacementTargetReference(
        tx,
        tenantId,
        input.targetType,
        input.targetId ?? null
      );

      if (!targetValidation.valid) {
        return fail(
          422,
          "AD_PLACEMENT_TARGET_INVALID",
          "Ad placement targets a resource that does not exist in this tenant.",
          {},
          targetValidation.errors
        );
      }
    }

    const updated = await updateAdPlacement(
      tx,
      tenantId,
      auth.context.tenantUserId,
      id,
      input,
      correlationId
    );

    if (!updated) {
      return fail(404, "RESOURCE_NOT_FOUND", "Ad placement not found.");
    }

    log("info", "news-portal.ad_placement.updated", {
      correlationId,
      tenantId,
      moduleKey: "blog_content",
      adPlacementId: id
    });

    // ADR-0042 §Rule 21 (Issue #628) — a creative or schedule change reaches the
    // reader only once the cached pages carrying that slot are evicted.
    await enqueueModuleContentPurge(
      tx,
      tenantId,
      "blog_content",
      "news_portal.ad_placement.updated"
    );

    return ok(updated);
  });
};

/** `DELETE /api/v1/news-portal/ad-placements/{id}` (Issue #638) — soft-delete. `reason` required, same convention every other soft-deletable resource in this repo uses. */
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
    return fail(400, "VALIDATION_ERROR", "Ad placement id is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const bodyRead = await readJsonBody(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const validation = validateDeleteReasonInput(bodyRead.value);

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

    const existing = await fetchAdPlacementById(tx, tenantId, id);

    if (!existing) {
      return fail(404, "RESOURCE_NOT_FOUND", "Ad placement not found.");
    }

    await softDeleteAdPlacement(
      tx,
      tenantId,
      auth.context.tenantUserId,
      id,
      reason,
      correlationId
    );

    log("info", "news-portal.ad_placement.deleted", {
      correlationId,
      tenantId,
      moduleKey: "blog_content",
      adPlacementId: id
    });

    // ADR-0042 §Rule 21 (Issue #628) — the serious direction: a withdrawn ad
    // still being served is a campaign running past its end date.
    await enqueueModuleContentPurge(
      tx,
      tenantId,
      "blog_content",
      "news_portal.ad_placement.deleted"
    );

    return ok({ id, deleted: true });
  });
};
