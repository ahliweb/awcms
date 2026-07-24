import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../../../lib/database/client";
import { withTenant } from "../../../../../../../lib/database/tenant-context";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../../../../lib/auth/session-token";
import { recordAuditEvent } from "../../../../../../../modules/logging/application/audit-log";
import {
  fetchNewsMediaObjectById,
  markNewsMediaObjectFailed
} from "../../../../../../../modules/media-library/application/media-object-directory";

const CANCEL_GUARD = {
  moduleKey: "media_library",
  activityCode: "media",
  action: "cancel" as const
};

/**
 * `POST /api/v1/media/news-images/upload-sessions/{id}/cancel` (Issue
 * #634) — aborts a still-`pending_upload` session (nothing was ever
 * verified/attached). Not high-risk enough to require `Idempotency-Key`:
 * it never touches R2, and a repeated call after the first naturally
 * resolves to a clean `409` (row is no longer `pending_upload`), matching
 * this repo's existing `verify`/`set_primary` precedent for actions
 * excluded from `HIGH_RISK_ACTIONS` (`identity-access/domain/access-control.ts`).
 */
export const POST: APIRoute = async ({ request, params, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const objectId = params.id;

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!objectId) {
    return fail(400, "VALIDATION_ERROR", "Upload session id is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

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
      CANCEL_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    const row = await fetchNewsMediaObjectById(tx, tenantId, objectId);

    if (!row) {
      return fail(404, "RESOURCE_NOT_FOUND", "Upload session not found.");
    }

    if (row.status !== "pending_upload") {
      return fail(
        409,
        "INVALID_STATUS_TRANSITION",
        `Cannot cancel an upload session in status "${row.status}".`
      );
    }

    const cancelled = await markNewsMediaObjectFailed(tx, tenantId, objectId);

    if (!cancelled) {
      return fail(
        409,
        "INVALID_STATUS_TRANSITION",
        "Upload session state changed concurrently; retry."
      );
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "media_library",
      action: "news_media.object.upload_cancelled",
      resourceType: "news_media_object",
      resourceId: objectId,
      severity: "info",
      message: `News media upload session cancelled: ${row.objectKey}.`,
      attributes: { objectKey: row.objectKey },
      correlationId
    });

    return ok(cancelled);
  });
};
