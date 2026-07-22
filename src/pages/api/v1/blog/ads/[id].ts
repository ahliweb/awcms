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
  fetchAdPlacements,
  softDeleteAd,
  syncAdPlacements,
  updateAd
} from "../../../../../modules/blog-content/application/ads-directory";
import {
  validateAdPlacementsInput,
  validateUpdateAdInput,
  type AdPlacementInput
} from "../../../../../modules/blog-content/domain/ad-policy";
import { validateDeleteReasonInput } from "../../../../../modules/blog-content/domain/content-validation";

const CONFIGURE_GUARD = {
  moduleKey: "blog_content",
  activityCode: "ads",
  action: "configure" as const
};

/** `PATCH /api/v1/blog/ads/{id}` (Issue #542). `placements` (full replace) may be sent independently of the other ad fields. */
export const PATCH: APIRoute = async ({ request, params, cookies, locals }) => {
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

  const bodyRead = await readJsonBody<Record<string, unknown>>(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const body = bodyRead.value;
  const validation = validateUpdateAdInput(body);

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Ad update is invalid.",
      {},
      validation.errors
    );
  }

  let placements: AdPlacementInput[] | undefined;

  if (body && body.placements !== undefined) {
    const placementsResult = validateAdPlacementsInput(body.placements);

    if (!placementsResult.valid) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "Ad placements are invalid.",
        {},
        placementsResult.errors
      );
    }

    placements = placementsResult.value;
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

    const updated = await updateAd(tx, tenantId, id, input);

    if (!updated) {
      return fail(404, "RESOURCE_NOT_FOUND", "Ad not found.");
    }

    const currentPlacements = placements
      ? await syncAdPlacements(tx, tenantId, id, placements)
      : await fetchAdPlacements(tx, tenantId, id);

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "blog_content",
      action: "blog.ad.updated",
      resourceType: "blog_ad",
      resourceId: id,
      severity: "info",
      message: `Blog ad updated: ${updated.name}.`,
      correlationId
    });

    log("info", "blog-content.ad.updated", {
      correlationId,
      tenantId,
      moduleKey: "blog_content",
      adId: id
    });

    return ok({ ...updated, placements: currentPlacements });
  });
};

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
