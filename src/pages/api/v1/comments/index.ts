import type { APIRoute } from "astro";

import { hashSessionToken } from "../../../../lib/auth/session-token";
import { SESSION_COOKIE_NAME } from "../../../../lib/auth/ssr-session";
import { getDatabaseClient } from "../../../../lib/database/client";
import { recordCounter } from "../../../../lib/observability/metrics-port";
import {
  checkRateLimit,
  resolveClientIp
} from "../../../../lib/security/rate-limit";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../lib/security/request-body-limit";
import { fail, ok } from "../../../../modules/_shared/api-response";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../modules/_shared/idempotency";
import { getRegisteredCommentableResources } from "../../../../lib/comments/commentable-resources";
import { resolveOptionalRegisteredAuthor } from "../../../../modules/comments/application/author-resolution";
import { resolvePublishedCommentableResource } from "../../../../modules/comments/application/commentable-resource-engine";
import { submitComment } from "../../../../modules/comments/application/comment-service";
import { getOrCreateThread } from "../../../../modules/comments/application/comment-thread-directory";
import { createReplySubscription } from "../../../../modules/comments/application/reply-notifications";
import { withCommentsTenant } from "../../../../modules/comments/application/public-comments-tenant-resolution";
import { listApprovedComments } from "../../../../modules/comments/application/comment-service";
import { findThread } from "../../../../modules/comments/application/comment-thread-directory";
import { hashRequestSignal } from "../../../../modules/comments/domain/request-hashing";
import { verifyTimingToken } from "../../../../modules/comments/domain/timing-token";

/**
 * `POST /api/v1/comments` (submit) + `GET /api/v1/comments` (list) — the PUBLIC,
 * host-resolved comment surface (ADR-0041 §5, ported from awcms-micro Issue #271). Tenant is resolved from
 * the request host (never a session/header); the commentable resource is
 * re-resolved through its owning module's declarative descriptor and must be
 * PUBLISHED & PUBLIC. Every non-resolving/disabled/short outcome returns a neutral
 * response — never leak WHY. Submit is anti-abuse-gated (honeypot, timing floor,
 * blocked terms, duplicate, per-IP rate limit) and Idempotency-Key'd.
 */
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const GET: APIRoute = async ({ request, url, clientAddress }) => {
  const clientIp = resolveClientIp(request, clientAddress);
  const rate = checkRateLimit(`comments:list:${clientIp}`, {
    maxAttempts: 120,
    windowMs: 60 * 1000
  });
  if (!rate.allowed) {
    return fail(429, "RATE_LIMITED", "Too many requests.", {}, undefined, {
      "retry-after": String(rate.retryAfterSec)
    });
  }

  const sql = getDatabaseClient();
  const resourceType = url.searchParams.get("resourceType") ?? "";
  const resourceId = url.searchParams.get("resourceId") ?? "";
  const locale = url.searchParams.get("locale") ?? "";
  // Full-precision cursor pair — see `listApprovedComments` on why the
  // timestamp travels as text rather than as a Date.
  const cursorCreatedAt = url.searchParams.get("cursor");
  const cursorId = url.searchParams.get("cursorId");

  const result = await withCommentsTenant(sql, request, async (tx, tenant) => {
    const effectiveLocale = locale || tenant.defaultLocale;
    const resolved = await resolvePublishedCommentableResource(
      tx,
      tenant.tenantId,
      {
        resourceType,
        resourceId,
        locale: effectiveLocale,
        tenantCode: tenant.tenantCode
      },
      getRegisteredCommentableResources()
    );
    if (!resolved) return { items: [], nextCursor: null };

    const thread = await findThread(tx, tenant.tenantId, {
      resourceType: resolved.resourceType,
      resourceId: resolved.resourceId,
      locale: resolved.locale
    });
    if (!thread) return { items: [], nextCursor: null };

    return listApprovedComments(tx, tenant.tenantId, thread.id, {
      limit: 50,
      beforeCreatedAt: cursorCreatedAt,
      beforeId: cursorId
    });
  });

  // Neutral empty payload for every unresolved/disabled case.
  return ok(result ?? { items: [], nextCursor: null });
};

export const POST: APIRoute = async ({
  request,
  cookies,
  clientAddress,
  locals
}) => {
  const clientIp = resolveClientIp(request, clientAddress);
  const rate = checkRateLimit(`comments:submit:${clientIp}`, {
    maxAttempts: 20,
    windowMs: RATE_LIMIT_WINDOW_MS
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

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey) {
    return fail(
      400,
      "IDEMPOTENCY_REQUIRED",
      "Idempotency-Key header is required."
    );
  }

  const bodyRead = await readJsonBody(request);
  if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);
  const body = bodyRead.value;
  if (!isRecord(body)) {
    return fail(400, "VALIDATION_ERROR", "Body must be a JSON object.");
  }

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
      const effectiveLocale =
        typeof body.locale === "string" && body.locale
          ? body.locale
          : tenant.defaultLocale;
      const resolved = await resolvePublishedCommentableResource(
        tx,
        tenant.tenantId,
        {
          resourceType:
            typeof body.resourceType === "string" ? body.resourceType : "",
          resourceId:
            typeof body.resourceId === "string" ? body.resourceId : "",
          locale: effectiveLocale,
          tenantCode: tenant.tenantCode
        },
        getRegisteredCommentableResources()
      );
      if (!resolved) return { kind: "neutral" as const };

      const requestHash = computeRequestHash({
        r: resolved.resourceType,
        i: resolved.resourceId,
        l: resolved.locale,
        b: typeof body.body === "string" ? body.body : "",
        p: typeof body.parentId === "string" ? body.parentId : null
      });
      const existing = await findIdempotencyRecord(
        tx,
        tenant.tenantId,
        "comments_submit",
        idempotencyKey
      );
      if (existing) {
        if (existing.requestHash !== requestHash) {
          return { kind: "conflict" as const };
        }
        return {
          kind: "replay" as const,
          status: existing.responseStatus,
          bodyJson: existing.responseBody
        };
      }

      const thread = await getOrCreateThread(
        tx,
        tenant.tenantId,
        resolved,
        settings
      );
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
          parentId: typeof body.parentId === "string" ? body.parentId : null,
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

      // Opt-in reply subscription (double-opt-in; recipient minimized/encrypted).
      if (
        settings.notifyOnReply &&
        body.subscribeToReplies === true &&
        typeof body.authorEmail === "string" &&
        body.authorEmail
      ) {
        await createReplySubscription(tx, tenant.tenantId, {
          threadId: thread.id,
          commentId: null,
          normalizedEmail: body.authorEmail.trim().toLowerCase()
        });
      }

      // Oracle-free accept: a held-for-moderation (not publicly visible) comment
      // returns the SAME neutral body as an anti-abuse block / unresolved
      // resource, so a caller cannot distinguish accepted-pending from rejected
      // (no blocked_term / honeypot / timing evasion oracle). Only a
      // publicly-visible (approved) comment reveals its id + status.
      const successBody: {
        success: true;
        data: Record<string, unknown>;
        meta: Record<string, unknown>;
      } = submit.publiclyVisible
        ? {
            success: true,
            data: {
              status: submit.status,
              publiclyVisible: true,
              commentId: submit.commentId
            },
            meta: {}
          }
        : { success: true, data: { status: "received" }, meta: {} };
      await saveIdempotencyRecord(
        tx,
        tenant.tenantId,
        "comments_submit",
        idempotencyKey,
        requestHash,
        200,
        successBody
      );
      return { kind: "accepted" as const, bodyJson: successBody };
    }
  );

  // Unresolved host/resource/disabled OR held-for-moderation → neutral response.
  // A rejected submission also returns the SAME neutral shape so an anti-abuse
  // block is indistinguishable from an accepted-but-pending one (no oracle).
  if (
    outcome === null ||
    (isRecord(outcome) &&
      (outcome.kind === "neutral" || outcome.kind === "rejected"))
  ) {
    return ok({ status: "received" });
  }
  if (isRecord(outcome) && outcome.kind === "conflict") {
    return fail(
      409,
      "IDEMPOTENCY_CONFLICT",
      "Idempotency-Key was already used with a different request."
    );
  }
  const finalBody =
    isRecord(outcome) && "bodyJson" in outcome
      ? outcome.bodyJson
      : { status: "received" };
  return new Response(JSON.stringify(finalBody), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
};
