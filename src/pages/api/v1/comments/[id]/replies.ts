import type { APIRoute } from "astro";

import { hashSessionToken } from "../../../../../lib/auth/session-token";
import { SESSION_COOKIE_NAME } from "../../../../../lib/auth/ssr-session";
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
import { resolveOptionalRegisteredAuthor } from "../../../../../modules/comments/application/author-resolution";
import { getRegisteredCommentableResources } from "../../../../../modules/comments/presentation/commentable-resources";
import { resolvePublishedCommentableResource } from "../../../../../modules/comments/application/commentable-resource-engine";
import { submitComment } from "../../../../../modules/comments/application/comment-service";
import { findThreadByComment } from "../../../../../modules/comments/application/comment-thread-directory";
import { withCommentsTenant } from "../../../../../modules/comments/application/public-comments-tenant-resolution";
import { hashRequestSignal } from "../../../../../modules/comments/domain/request-hashing";
import { verifyTimingToken } from "../../../../../modules/comments/domain/timing-token";

/**
 * `POST /api/v1/comments/{id}/replies` — a bounded-depth reply to an existing
 * comment (ADR-0041, ported from awcms-micro Issue #271). Same anti-abuse + policy gate as a top-level
 * submission; the parent is `{id}` and depth is derived from the parent + capped.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const POST: APIRoute = async ({
  request,
  cookies,
  clientAddress,
  params,
  locals
}) => {
  const parentId = params.id;
  if (!parentId)
    return fail(400, "VALIDATION_ERROR", "Comment id is required.");

  const clientIp = resolveClientIp(request, clientAddress);
  const rate = checkRateLimit(`comments:reply:${clientIp}`, {
    maxAttempts: 20,
    windowMs: 60 * 60 * 1000
  });
  if (!rate.allowed) {
    recordCounter("comments_abuse_blocks_total", { reason: "rate_limited" });
    return fail(
      429,
      "RATE_LIMITED",
      "Too many comments from this source.",
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
  if (!isRecord(body))
    return fail(400, "VALIDATION_ERROR", "Body must be a JSON object.");

  const sql = getDatabaseClient();
  const now = new Date();
  const sessionToken = cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
  const tokenHash = sessionToken ? hashSessionToken(sessionToken) : null;
  const userAgent = request.headers.get("user-agent");
  const correlationId = locals.correlationId;

  const outcome = await withCommentsTenant(
    sql,
    request,
    async (tx, tenant, settings) => {
      const thread = await findThreadByComment(tx, tenant.tenantId, parentId);
      if (!thread) return { kind: "neutral" as const };

      // Re-confirm the resource is still published/public before accepting a reply.
      const resolved = await resolvePublishedCommentableResource(
        tx,
        tenant.tenantId,
        {
          resourceType: thread.resourceType,
          resourceId: thread.resourceId,
          locale: thread.locale,
          tenantCode: tenant.tenantCode
        },
        getRegisteredCommentableResources()
      );
      if (!resolved) return { kind: "neutral" as const };

      const author = await resolveOptionalRegisteredAuthor(
        tx,
        tenant.tenantId,
        tokenHash,
        now
      );
      const timing = verifyTimingToken(body.timingToken, now.getTime());

      const submit = await submitComment(
        tx,
        tenant.tenantId,
        resolved,
        thread,
        settings,
        {
          body: typeof body.body === "string" ? body.body : "",
          parentId,
          authorKind: author.authorKind,
          authorUserId: author.authorUserId,
          authorDisplayName:
            typeof body.authorDisplayName === "string"
              ? body.authorDisplayName.slice(0, 120)
              : null,
          authorEmail:
            typeof body.authorEmail === "string" ? body.authorEmail : null,
          honeypot: typeof body.website === "string" ? body.website : null,
          elapsedMs: timing.valid ? timing.elapsedMs : null,
          ipHash: hashRequestSignal(tenant.tenantId, clientIp),
          userAgentHash: hashRequestSignal(tenant.tenantId, userAgent)
        },
        { correlationId }
      );

      recordCounter("comments_submissions_total", {
        outcome: submit.accepted ? "accepted" : "rejected",
        policyMode: thread.policyMode
      });
      if (!submit.accepted) {
        if (
          submit.reason === "honeypot" ||
          submit.reason === "too_fast" ||
          submit.reason === "blocked_term" ||
          submit.reason === "duplicate"
        ) {
          recordCounter("comments_abuse_blocks_total", {
            reason: submit.reason
          });
        }
        return { kind: "rejected" as const };
      }
      return {
        kind: "accepted" as const,
        status: submit.status,
        publiclyVisible: submit.publiclyVisible,
        commentId: submit.commentId
      };
    }
  );

  if (
    outcome === null ||
    (isRecord(outcome) &&
      (outcome.kind === "neutral" || outcome.kind === "rejected"))
  ) {
    return ok({ status: "received" });
  }
  const accepted = outcome as {
    status: string;
    publiclyVisible: boolean;
    commentId: string;
  };
  // Oracle-free accept: a held-for-moderation reply returns the SAME neutral
  // body as a block / unresolved case; only a publicly-visible reply reveals its
  // id + status (mirrors POST /api/v1/comments).
  if (!accepted.publiclyVisible) {
    return ok({ status: "received" });
  }
  return ok({
    status: accepted.status,
    publiclyVisible: true,
    commentId: accepted.commentId
  });
};
