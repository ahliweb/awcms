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
 * `POST /api/v1/comments/admin/{id}/archive` — archive an approved comment (remove
 * from public view, retain for history) (ADR-0041, ported from awcms-micro Issue #271). ABAC-guarded
 * (moderation.archive), Idempotency-Key'd, audited.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const GUARD = {
  moduleKey: COMMENTS_MODULE_KEY,
  activityCode: COMMENTS_MODERATION_ACTIVITY_CODE,
  action: "archive" as const
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
  const requestHash = computeRequestHash({ commentId, action: "archive" });

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(
      tx,
      tenantId,
      tokenHash,
      now,
      GUARD
    );
    if (!auth.allowed) return auth.denied;

    // Allowed — so the caller is entitled to hear what is actually wrong, and
    // the decision log now carries the row saying they were here.
    if (!idempotencyKey) {
      return fail(
        400,
        "IDEMPOTENCY_REQUIRED",
        "Idempotency-Key header is required."
      );
    }

    const existing = await findIdempotencyRecord(
      tx,
      tenantId,
      "comments_archive",
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
      "archive",
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
          action: "comments.moderation.archive",
          resourceType: "comments_comment",
          resourceId: detail.commentId,
          severity: "info",
          message: "Comment archived by moderator.",
          attributes: {
            fromStatus: detail.fromStatus,
            toStatus: detail.toStatus
          },
          correlationId
        });
      }
    );

    recordCounter("comments_moderation_actions_total", {
      action: "archive",
      result: result.ok ? "applied" : result.reason
    });

    if (!result.ok) {
      if (result.reason === "not_found")
        return fail(404, "NOT_FOUND", "Comment not found.");
      return fail(
        409,
        "ILLEGAL_TRANSITION",
        "Only an approved comment can be archived."
      );
    }

    const successResponse = ok({ commentId, status: result.toStatus });
    const successBody = await successResponse.clone().json();
    await saveIdempotencyRecord(
      tx,
      tenantId,
      "comments_archive",
      idempotencyKey,
      requestHash,
      200,
      successBody
    );
    return successResponse;
  });
};
