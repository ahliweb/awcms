import type { APIRoute } from "astro";

import { getDatabaseClient } from "../../../../../lib/database/client";
import { recordCounter } from "../../../../../lib/observability/metrics-port";
import {
  checkRateLimit,
  resolveClientIp
} from "../../../../../lib/security/rate-limit";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import { fail, ok } from "../../../../../modules/_shared/api-response";
import {
  reportComment,
  type ReportReason
} from "../../../../../modules/comments/application/comment-service";
import { withCommentsTenant } from "../../../../../modules/comments/application/public-comments-tenant-resolution";
import { hashRequestSignal } from "../../../../../modules/comments/domain/request-hashing";

/**
 * `POST /api/v1/comments/{id}/report` — flag a comment for moderator review
 * (ADR-0041, ported from awcms-micro Issue #271). Rate-bounded per IP and dedup-bounded by the DB unique
 * index (one open flag per comment + reporter IP + reason). Always returns a
 * neutral acknowledgement — never reveals whether the comment exists.
 */
const VALID_REASONS: readonly ReportReason[] = [
  "spam",
  "abuse",
  "offensive",
  "other"
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const POST: APIRoute = async ({ request, clientAddress, params }) => {
  const commentId = params.id;
  if (!commentId)
    return fail(400, "VALIDATION_ERROR", "Comment id is required.");

  const clientIp = resolveClientIp(request, clientAddress);
  const rate = checkRateLimit(`comments:report:${clientIp}`, {
    maxAttempts: 30,
    windowMs: 60 * 60 * 1000
  });
  if (!rate.allowed) {
    return fail(
      429,
      "RATE_LIMITED",
      "Too many reports from this source.",
      {},
      undefined,
      {
        "retry-after": String(rate.retryAfterSec)
      }
    );
  }

  const bodyRead = await readJsonBody(request);
  if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);
  const body = bodyRead.value;
  const reason =
    isRecord(body) &&
    typeof body.reason === "string" &&
    VALID_REASONS.includes(body.reason as ReportReason)
      ? (body.reason as ReportReason)
      : "other";
  const detail =
    isRecord(body) && typeof body.detail === "string"
      ? body.detail.slice(0, 1000)
      : null;

  const sql = getDatabaseClient();
  await withCommentsTenant(sql, request, async (tx, tenant) => {
    const result = await reportComment(tx, tenant.tenantId, commentId, {
      reporterIpHash: hashRequestSignal(tenant.tenantId, clientIp) ?? "unknown",
      reporterEmailHash: null,
      reason,
      detail
    });
    if (result.ok) recordCounter("comments_reports_total", { reason });
    return result;
  });

  // Neutral acknowledgement regardless of outcome — no existence oracle.
  return ok({ status: "received" });
};
