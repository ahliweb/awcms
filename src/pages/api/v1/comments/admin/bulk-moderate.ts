import type { APIRoute } from "astro";

import { hashSessionToken } from "../../../../../lib/auth/session-token";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import { recordCounter } from "../../../../../lib/observability/metrics-port";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import {
  fail,
  jsonResponse,
  ok
} from "../../../../../modules/_shared/api-response";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../../modules/_shared/idempotency";
import { bulkModerateComments } from "../../../../../modules/comments/application/comment-moderation";
import {
  COMMENTS_MODERATION_ACTIVITY_CODE,
  COMMENTS_MODULE_KEY
} from "../../../../../modules/comments/domain/comments-permissions";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";

/**
 * `POST /api/v1/comments/admin/bulk-moderate` — apply one moderation decision to
 * many comments (ADR-0041, ported from awcms-micro Issue #271). Tenant-bounded, ABAC-guarded per action,
 * Idempotency-Key'd, and audited per applied item. Bounded to 100 ids per call.
 */
type Decision = "approve" | "reject" | "spam";
const MAX_IDS = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const POST: APIRoute = async ({ request, cookies, locals }) => {
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
  if (!decision)
    return fail(
      400,
      "VALIDATION_ERROR",
      "`decision` must be approve|reject|spam."
    );

  const ids =
    isRecord(body) && Array.isArray(body.commentIds)
      ? body.commentIds.filter((v): v is string => typeof v === "string")
      : [];
  if (ids.length === 0)
    return fail(
      400,
      "VALIDATION_ERROR",
      "`commentIds` must be a non-empty array."
    );
  if (ids.length > MAX_IDS)
    return fail(
      400,
      "VALIDATION_ERROR",
      `At most ${MAX_IDS} comments per call.`
    );

  const reasonCode =
    isRecord(body) && typeof body.reasonCode === "string"
      ? body.reasonCode.slice(0, 64)
      : null;
  if ((decision === "reject" || decision === "spam") && !reasonCode) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "A `reasonCode` is required to reject or mark spam."
    );
  }

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
  const uniqueIds = [...new Set(ids)];
  const requestHash = computeRequestHash({
    decision,
    reasonCode,
    ids: uniqueIds
  });

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
      "comments_bulk_moderate",
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

    const result = await bulkModerateComments(
      tx,
      tenantId,
      uniqueIds,
      decision,
      {
        reasonCode,
        actorUserId: auth.context.tenantUserId,
        note: null,
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
          message: `Comment ${decision} by moderator (bulk).`,
          attributes: {
            fromStatus: detail.fromStatus,
            toStatus: detail.toStatus,
            reasonCode: detail.reasonCode,
            bulk: true
          },
          correlationId
        });
      }
    );

    for (let i = 0; i < result.applied.length; i += 1) {
      recordCounter("comments_moderation_actions_total", {
        action: decision,
        result: "applied"
      });
    }
    // Skipped items are counted too — a bulk action that silently drops half its
    // targets should be visible in the same counter as the successes, not only
    // in the response body the caller may never look at.
    for (const skip of result.skipped) {
      recordCounter("comments_moderation_actions_total", {
        action: decision,
        result: skip.reason
      });
    }

    const successResponse = ok({
      applied: result.applied,
      appliedCount: result.applied.length,
      skipped: result.skipped
    });
    const successBody = await successResponse.clone().json();
    await saveIdempotencyRecord(
      tx,
      tenantId,
      "comments_bulk_moderate",
      idempotencyKey,
      requestHash,
      200,
      successBody
    );
    return successResponse;
  });
};
