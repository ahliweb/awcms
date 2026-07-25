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
 * `POST /api/v1/comments/admin/{id}/moderate` — approve | reject | spam a comment
 * (ADR-0041, ported from awcms-micro Issue #271). Reason code required for reject/spam. ABAC-guarded per
 * decision (`approve` → moderation.approve; `reject`/`spam` → moderation.reject),
 * Idempotency-Key'd, and audited with the reason code.
 */
type Decision = "approve" | "reject" | "spam";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
  const decision =
    isRecord(body) &&
    (body.decision === "approve" ||
      body.decision === "reject" ||
      body.decision === "spam")
      ? (body.decision as Decision)
      : null;
  if (!decision) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "`decision` must be one of approve|reject|spam."
    );
  }
  const reasonCode =
    isRecord(body) && typeof body.reasonCode === "string"
      ? body.reasonCode.slice(0, 64)
      : null;
  const note =
    isRecord(body) && typeof body.note === "string"
      ? body.note.slice(0, 2000)
      : null;
  if ((decision === "reject" || decision === "spam") && !reasonCode) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "A `reasonCode` is required to reject or mark spam."
    );
  }

  // ABAC: approve needs moderation.approve; reject/spam need moderation.reject.
  const guard = {
    moduleKey: COMMENTS_MODULE_KEY,
    activityCode: COMMENTS_MODERATION_ACTIVITY_CODE,
    action: (decision === "approve" ? "approve" : "reject") as
      "approve" | "reject"
  };

  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const correlationId = locals.correlationId;
  const requestHash = computeRequestHash({ commentId, decision, reasonCode });

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(
      tx,
      tenantId,
      tokenHash,
      now,
      guard
    );
    if (!auth.allowed) return auth.denied;

    const existing = await findIdempotencyRecord(
      tx,
      tenantId,
      "comments_moderate",
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
      decision,
      {
        reasonCode,
        actorUserId: auth.context.tenantUserId,
        note,
        correlationId
      },
      async (auditTx, detail) => {
        await recordAuditEvent(auditTx, {
          tenantId,
          actorTenantUserId: auth.context.tenantUserId,
          moduleKey: COMMENTS_MODULE_KEY,
          action: `comments.moderation.${decision}`,
          resourceType: "comments_comment",
          resourceId: detail.commentId,
          severity: "info",
          message: `Comment ${decision} by moderator.`,
          attributes: {
            fromStatus: detail.fromStatus,
            toStatus: detail.toStatus,
            reasonCode: detail.reasonCode
          },
          correlationId
        });
      }
    );

    recordCounter("comments_moderation_actions_total", {
      action: decision,
      result: result.ok ? "applied" : result.reason
    });

    if (!result.ok) {
      if (result.reason === "not_found")
        return fail(404, "NOT_FOUND", "Comment not found.");
      return fail(
        409,
        "ILLEGAL_TRANSITION",
        "This moderation action is not legal from the comment's current status."
      );
    }

    const successResponse = ok({ commentId, status: result.toStatus });
    const successBody = await successResponse.clone().json();
    await saveIdempotencyRecord(
      tx,
      tenantId,
      "comments_moderate",
      idempotencyKey,
      requestHash,
      200,
      successBody
    );
    return successResponse;
  });
};
