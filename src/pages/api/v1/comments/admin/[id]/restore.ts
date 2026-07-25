import type { APIRoute } from "astro";

import { hashSessionToken } from "../../../../../../lib/auth/session-token";
import { getDatabaseClient } from "../../../../../../lib/database/client";
import { withTenant } from "../../../../../../lib/database/tenant-context";
import { recordCounter } from "../../../../../../lib/observability/metrics-port";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../../lib/security/request-body-limit";
import {
  fail,
  jsonResponse,
  ok
} from "../../../../../../modules/_shared/api-response";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../../../modules/_shared/idempotency";
import { moderateComment } from "../../../../../../modules/comments/application/comment-moderation";
import {
  COMMENTS_MODERATION_ACTIVITY_CODE,
  COMMENTS_MODULE_KEY
} from "../../../../../../modules/comments/domain/comments-permissions";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../../modules/identity-access/application/access-guard";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";

/**
 * `POST /api/v1/comments/admin/{id}/restore` — restore a rejected/spam/archived
 * comment back to pending review (ADR-0041, ported from awcms-micro Issue #271). High-risk, ABAC-guarded
 * (moderation.restore), Idempotency-Key'd, audited.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const GUARD = {
  moduleKey: COMMENTS_MODULE_KEY,
  activityCode: COMMENTS_MODERATION_ACTIVITY_CODE,
  action: "restore" as const
};

export const POST: APIRoute = async ({ request, cookies, params, locals }) => {
  const commentId = params.id;
  if (!commentId)
    return fail(400, "VALIDATION_ERROR", "Comment id is required.");

  const { tenantId, token } = resolveAuthInputs(request, cookies);
  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey)
    return fail(
      400,
      "IDEMPOTENCY_REQUIRED",
      "Idempotency-Key header is required."
    );

  const bodyRead = await readJsonBody(request);
  if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);
  const body = bodyRead.value;
  const note =
    isRecord(body) && typeof body.note === "string"
      ? body.note.slice(0, 2000)
      : null;

  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const correlationId = locals.correlationId;
  const requestHash = computeRequestHash({ commentId, action: "restore" });

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(
      tx,
      tenantId,
      tokenHash,
      now,
      GUARD
    );
    if (!auth.allowed) return auth.denied;

    const existing = await findIdempotencyRecord(
      tx,
      tenantId,
      "comments_restore",
      idempotencyKey
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

    const result = await moderateComment(
      tx,
      tenantId,
      commentId,
      "restore",
      {
        reasonCode: null,
        actorUserId: auth.context.tenantUserId,
        note,
        correlationId
      },
      async (auditTx, detail) => {
        await recordAuditEvent(auditTx, {
          tenantId,
          actorTenantUserId: auth.context.tenantUserId,
          moduleKey: COMMENTS_MODULE_KEY,
          action: "comments.moderation.restore",
          resourceType: "comments_comment",
          resourceId: detail.commentId,
          severity: "info",
          message: "Comment restored to pending by moderator.",
          attributes: {
            fromStatus: detail.fromStatus,
            toStatus: detail.toStatus
          },
          correlationId
        });
      }
    );

    recordCounter("comments_moderation_actions_total", {
      action: "restore",
      result: result.ok ? "applied" : result.reason
    });

    if (!result.ok) {
      if (result.reason === "not_found")
        return fail(404, "NOT_FOUND", "Comment not found.");
      return fail(
        409,
        "ILLEGAL_TRANSITION",
        "This comment cannot be restored from its current status."
      );
    }

    const successResponse = ok({ commentId, status: result.toStatus });
    const successBody = await successResponse.clone().json();
    await saveIdempotencyRecord(
      tx,
      tenantId,
      "comments_restore",
      idempotencyKey,
      requestHash,
      200,
      successBody
    );
    return successResponse;
  });
};
